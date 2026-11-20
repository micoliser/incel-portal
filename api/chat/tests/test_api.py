import base64
import os
import uuid
from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.utils import timezone

from accounts.models import StaffProfile
from audit.actions import AuditAction
from applications.models import AuditLog
from chat.models import ChatAccount, Conversation, ConversationKey, HiddenMessage, Message, MessageAttachment
from common.test_utils import BaseAPITestCase
from notifications.models import Notification

User = get_user_model()


def b64(n):
    return base64.b64encode(os.urandom(n)).decode()


def backup():
    return {'box': b64(48), 'nonce': b64(24), 'salt': b64(16), 'ops': 3, 'mem': 64 * 1024 * 1024}


def pin_backup():
    return {**backup(), 'box': b64(64), 'inner_nonce': b64(24)}


def setup_payload():
    return {'public_key': b64(32), 'pin': pin_backup(), 'recovery': backup()}


class ChatTestCase(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        from django.core.cache import cache

        cache.clear()  # the in-memory test cache: presence, reset codes
        self.other = User.objects.create_user(
            username='ada@example.com', email='ada@example.com', password='x', first_name='Ada', last_name='Obi'
        )
        StaffProfile.objects.create(user=self.other, role=self.role_staff, department=self.dep_hr)
        self.outsider = User.objects.create_user(username='out@example.com', email='out@example.com', password='x')
        StaffProfile.objects.create(user=self.outsider, role=self.role_staff, department=self.dep_hr)

    def as_user(self, user):
        self.client.credentials(**self.auth_headers_for(user))

    def set_up_chat(self, user):
        self.as_user(user)
        response = self.client.post('/api/v1/chat/account', setup_payload(), format='json')
        self.assertEqual(response.status_code, 201, response.content)
        return ChatAccount.objects.get(user=user)

    def wrapped_for(self, *users):
        return [
            {
                'recipient_id': u.pk,
                'recipient_key_id': str(ChatAccount.objects.get(user=u).key_id),
                'wrapped_key': b64(48),
                'nonce': b64(24),
            }
            for u in users
        ]

    def start(self, user, other):
        self.as_user(user)
        response = self.client.post(
            '/api/v1/chat/conversations', {'user_id': other.pk, 'keys': self.wrapped_for(user, other)}, format='json'
        )
        self.assertIn(response.status_code, (200, 201), response.content)
        return response.json()

    def send(self, user, conversation_id, **overrides):
        self.as_user(user)
        payload = {
            'id': str(uuid.uuid4()),
            'kind': 'text',
            'key_version': 1,
            'nonce': b64(24),
            'ciphertext': b64(40),
            **overrides,
        }
        return self.client.post(f'/api/v1/chat/conversations/{conversation_id}/messages', payload, format='json')


class AccountTests(ChatTestCase):
    def test_setup_once_and_audit(self):
        self.as_user(self.staff_user)
        self.assertFalse(self.client.get('/api/v1/chat/account').json()['set_up'])
        self.set_up_chat(self.staff_user)
        body = self.client.get('/api/v1/chat/account').json()
        self.assertTrue(body['set_up'])
        self.assertEqual(body['account']['pin']['ops'], 3)
        self.assertIn('inner_nonce', body['account']['pin'])
        self.assertEqual(self.client.post('/api/v1/chat/account', setup_payload(), format='json').status_code, 409)
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.CHAT_SETUP, actor_user=self.staff_user).exists())

    def test_rejects_bad_key_material(self):
        self.as_user(self.staff_user)
        payload = setup_payload()
        payload['public_key'] = b64(31)
        self.assertEqual(self.client.post('/api/v1/chat/account', payload, format='json').status_code, 400)
        payload = setup_payload()
        payload['pin']['mem'] = 1024
        self.assertEqual(self.client.post('/api/v1/chat/account', payload, format='json').status_code, 400)
        payload = setup_payload()
        payload['pin']['box'] = b64(48)  # one layer only
        self.assertEqual(self.client.post('/api/v1/chat/account', payload, format='json').status_code, 400)

    def test_update_pin_copy(self):
        account = self.set_up_chat(self.staff_user)
        new = pin_backup()
        response = self.client.patch('/api/v1/chat/account', {'pin': new}, format='json')
        self.assertEqual(response.status_code, 200)
        account.refresh_from_db()
        self.assertEqual(account.pin_box, new['box'])
        self.assertEqual(account.pin_inner_nonce, new['inner_nonce'])

    def test_check_password(self):
        self.as_user(self.staff_user)
        url = '/api/v1/chat/account/check-password'
        self.assertEqual(self.client.post(url, {'password': 'StaffStrongPass123!'}, format='json').status_code, 204)
        self.assertEqual(self.client.post(url, {'password': 'wrong'}, format='json').status_code, 400)

    def test_reset_needs_the_emailed_code(self):
        from django.core import mail

        from chat import services

        account = self.set_up_chat(self.other)
        reset = '/api/v1/chat/account/reset'
        check = '/api/v1/chat/account/reset/code/check'

        # No code sent yet: refused, nothing changes.
        response = self.client.post(reset, {**setup_payload(), 'code': 'AB23CD45'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(ChatAccount.objects.get(pk=account.pk).key_id, account.key_id)

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post('/api/v1/chat/account/reset/code')
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['sent_to'], self.other.email)
        self.assertEqual(len(mail.outbox), 1)
        email = mail.outbox[0]
        code = email.subject.rsplit(' ', 1)[-1]
        self.assertRegex(code, r'^[2-9A-HJKMNP-Z]{8}$')
        self.assertRegex(code, r'[0-9]')
        self.assertRegex(code, r'[A-Z]')
        self.assertIn('cannot be undone', email.alternatives[0][0] if email.alternatives else email.body)
        self.assertTrue(AuditLog.objects.filter(action=AuditAction.CHAT_RESET_CODE_SENT, actor_user=self.other).exists())

        # A second code straight away is refused.
        self.assertEqual(self.client.post('/api/v1/chat/account/reset/code').status_code, 409)

        wrong = 'Z' * 8 if code != 'Z' * 8 else 'Y' * 8
        response = self.client.post(check, {'code': wrong}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertIn('4 tries left', response.content.decode())
        # Checking does not use the code up; lower case and spaces are fine.
        self.assertEqual(self.client.post(check, {'code': f'{code[:4].lower()} {code[4:]}'}, format='json').status_code, 204)
        self.assertEqual(self.client.post(reset, {**setup_payload(), 'code': code}, format='json').status_code, 200)
        self.assertNotEqual(ChatAccount.objects.get(pk=account.pk).key_id, account.key_id)
        # Used once only.
        self.assertEqual(self.client.post(check, {'code': code}, format='json').status_code, 400)

        # Five wrong tries cancel a code.
        services.cache.delete(f'chat:reset-code-sent:{self.other.pk}')
        with patch('chat.services.new_reset_code', return_value='AB23CD45'):
            self.client.post('/api/v1/chat/account/reset/code')
        for _ in range(5):
            response = self.client.post(check, {'code': 'ZZZZ9999'}, format='json')
        self.assertIn('Too many wrong tries', response.content.decode())
        self.assertEqual(self.client.post(check, {'code': 'AB23CD45'}, format='json').status_code, 400)

    def test_reset_changes_key_and_announces(self):
        self.set_up_chat(self.staff_user)
        self.set_up_chat(self.other)
        conversation = self.start(self.staff_user, self.other)
        old_key = ChatAccount.objects.get(user=self.other).key_id
        self.as_user(self.other)
        with patch('chat.services.new_reset_code', return_value='AB23CD45'):
            self.assertEqual(self.client.post('/api/v1/chat/account/reset/code').status_code, 201)
        response = self.client.post('/api/v1/chat/account/reset', {**setup_payload(), 'code': 'ab23-cd45'}, format='json')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotEqual(ChatAccount.objects.get(user=self.other).key_id, old_key)
        system = Message.objects.get(conversation_id=conversation['id'], kind='system')
        self.assertEqual(system.system_event, 'key_reset')
        # The old key no longer covers everyone, so sending needs a new version.
        response = self.send(self.staff_user, conversation['id'])
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['error']['type'], 'key_outdated')
        self.as_user(self.staff_user)
        response = self.client.post(
            f'/api/v1/chat/conversations/{conversation["id"]}/keys',
            {'version': 2, 'keys': self.wrapped_for(self.staff_user, self.other)},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(self.send(self.staff_user, conversation['id'], key_version=2).status_code, 201)

    def test_session_secret_lifecycle(self):
        # Available before chat is set up (sealing the password secret at sign-in).
        self.as_user(self.staff_user)
        created = self.client.post('/api/v1/chat/session-secrets').json()
        url = f'/api/v1/chat/session-secrets/{created["id"]}'
        self.assertEqual(self.client.get(url).json()['secret'], created['secret'])
        self.as_user(self.other)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.as_user(self.staff_user)
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_ticket_requires_setup(self):
        self.as_user(self.staff_user)
        response = self.client.post('/api/v1/chat/ws-ticket')
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error']['type'], 'chat_not_set_up')
        self.set_up_chat(self.staff_user)
        self.assertTrue(self.client.post('/api/v1/chat/ws-ticket').json()['ticket'])


class ConversationTests(ChatTestCase):
    def setUp(self):
        super().setUp()
        self.set_up_chat(self.staff_user)
        self.set_up_chat(self.other)

    def test_people_lists_active_users_with_readiness(self):
        self.as_user(self.staff_user)
        results = self.client.get('/api/v1/chat/people', {'search': 'ada'}).json()['results']
        self.assertEqual([p['id'] for p in results], [self.other.pk])
        self.assertTrue(results[0]['chat_ready'])
        everyone = {p['id']: p for p in self.client.get('/api/v1/chat/people').json()['results']}
        self.assertNotIn(self.staff_user.pk, everyone)
        self.assertFalse(everyone[self.outsider.pk]['chat_ready'])

    def test_cannot_start_with_someone_not_set_up(self):
        self.as_user(self.staff_user)
        response = self.client.post(
            '/api/v1/chat/conversations', {'user_id': self.outsider.pk, 'keys': self.wrapped_for(self.staff_user)},
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_start_is_unique_per_pair(self):
        first = self.start(self.staff_user, self.other)
        second = self.start(self.other, self.staff_user)
        self.assertEqual(first['id'], second['id'])
        self.assertEqual(Conversation.objects.count(), 1)
        self.assertEqual(ConversationKey.objects.filter(conversation_id=first['id']).count(), 2)

    def test_keys_must_cover_both_people(self):
        self.as_user(self.staff_user)
        response = self.client.post(
            '/api/v1/chat/conversations', {'user_id': self.other.pk, 'keys': self.wrapped_for(self.staff_user)},
            format='json',
        )
        self.assertEqual(response.status_code, 409)

    def test_outsider_cannot_see_conversation(self):
        conversation = self.start(self.staff_user, self.other)
        self.set_up_chat(self.outsider)
        self.as_user(self.outsider)
        for url in (
            f'/api/v1/chat/conversations/{conversation["id"]}',
            f'/api/v1/chat/conversations/{conversation["id"]}/messages',
            f'/api/v1/chat/conversations/{conversation["id"]}/keys',
        ):
            self.assertEqual(self.client.get(url).status_code, 404, url)
        self.assertEqual(self.send(self.outsider, conversation['id']).status_code, 404)

    def test_send_list_unread_and_read(self):
        conversation = self.start(self.staff_user, self.other)
        response = self.send(self.staff_user, conversation['id'])
        self.assertEqual(response.status_code, 201, response.content)
        message = response.json()
        self.assertEqual(message['seq'], 1)

        self.as_user(self.other)
        self.assertEqual(self.client.get('/api/v1/chat/unread-count').json()['unread_count'], 1)
        listed = self.client.get('/api/v1/chat/conversations').json()['results'][0]
        self.assertEqual(listed['unread_count'], 1)
        messages = self.client.get(f'/api/v1/chat/conversations/{conversation["id"]}/messages').json()
        self.assertEqual([m['id'] for m in messages['results']], [message['id']])

        self.client.post(f'/api/v1/chat/conversations/{conversation["id"]}/read', {'seq': 1}, format='json')
        self.assertEqual(self.client.get('/api/v1/chat/unread-count').json()['unread_count'], 0)
        receipts = self.client.get(f'/api/v1/chat/conversations/{conversation["id"]}').json()['participants']
        self.assertEqual({p['id']: p['last_read_seq'] for p in receipts}[self.other.pk], 1)

    def test_resend_is_idempotent(self):
        conversation = self.start(self.staff_user, self.other)
        message_id = str(uuid.uuid4())
        self.assertEqual(self.send(self.staff_user, conversation['id'], id=message_id).status_code, 201)
        self.assertEqual(self.send(self.staff_user, conversation['id'], id=message_id).status_code, 200)
        self.assertEqual(Message.objects.count(), 1)

    def test_paging(self):
        conversation = self.start(self.staff_user, self.other)
        for _ in range(5):
            self.send(self.staff_user, conversation['id'])
        page = self.client.get(f'/api/v1/chat/conversations/{conversation["id"]}/messages', {'limit': 2}).json()
        self.assertEqual([m['seq'] for m in page['results']], [4, 5])
        self.assertTrue(page['has_more'])
        older = self.client.get(
            f'/api/v1/chat/conversations/{conversation["id"]}/messages', {'limit': 2, 'before_seq': 4}
        ).json()
        self.assertEqual([m['seq'] for m in older['results']], [2, 3])
        newer = self.client.get(f'/api/v1/chat/conversations/{conversation["id"]}/messages', {'after_seq': 3}).json()
        self.assertEqual([m['seq'] for m in newer['results']], [4, 5])

    def test_cannot_message_deactivated_user_but_history_stays(self):
        conversation = self.start(self.staff_user, self.other)
        self.send(self.staff_user, conversation['id'])
        self.other.is_active = False
        self.other.save()
        self.assertEqual(self.send(self.staff_user, conversation['id']).status_code, 403)
        self.as_user(self.staff_user)
        messages = self.client.get(f'/api/v1/chat/conversations/{conversation["id"]}/messages').json()['results']
        self.assertEqual(len(messages), 1)
        people = self.client.get(f'/api/v1/chat/conversations/{conversation["id"]}').json()['participants']
        self.assertFalse({p['id']: p for p in people}[self.other.pk]['is_active'])

    def test_invite_opens_a_waiting_conversation_and_emails(self):
        from django.core import mail

        self.as_user(self.staff_user)
        url = f'/api/v1/chat/people/{self.outsider.pk}/invite'
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(url)
        self.assertEqual(response.status_code, 200, response.content)
        conversation = response.json()
        self.assertEqual(conversation['last_message']['system_event'], 'invite_sent')
        self.assertEqual(conversation['latest_key_version'], 0)
        self.assertTrue(
            Notification.objects.filter(recipient=self.outsider, notification_type='chat_nudge').exists()
        )
        self.assertEqual([m.to for m in mail.outbox], [[self.outsider.email]])
        self.assertIn('wants to chat with you', mail.outbox[0].subject)

        # Shown in the inviter's list; nothing can be sent yet.
        listed = self.client.get('/api/v1/chat/conversations').json()['results']
        self.assertIn(conversation['id'], [c['id'] for c in listed])
        response = self.send(self.staff_user, conversation['id'], key_version=1)
        self.assertEqual(response.status_code, 403)
        self.assertIn('has not set up chat yet', response.json()['error']['message'])

        # A second invite the same day is a reminder, and only one is allowed.
        self.assertEqual(self.client.post(url).status_code, 409)
        self.assertEqual(Message.objects.filter(system_event='invite_sent').count(), 1)

        # Accepting: setting up chat adds a note to the conversation.
        self.set_up_chat(self.outsider)
        events = list(
            Message.objects.filter(conversation_id=conversation['id']).order_by('seq').values_list('system_event', flat=True)
        )
        self.assertEqual(events, ['invite_sent', 'invite_accepted'])
        self.as_user(self.outsider)
        theirs = self.client.get('/api/v1/chat/conversations').json()['results']
        self.assertEqual([c['id'] for c in theirs], [conversation['id']])

        # The first key version is made by whoever sends first.
        self.as_user(self.staff_user)
        response = self.client.post(
            f'/api/v1/chat/conversations/{conversation["id"]}/keys',
            {'version': 1, 'keys': self.wrapped_for(self.staff_user, self.outsider)},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(self.send(self.staff_user, conversation['id'], key_version=1).status_code, 201)

    def test_cannot_invite_someone_already_set_up(self):
        self.as_user(self.staff_user)
        self.assertEqual(self.client.post(f'/api/v1/chat/people/{self.other.pk}/invite').status_code, 409)


class EditDeleteTests(ChatTestCase):
    def setUp(self):
        super().setUp()
        self.set_up_chat(self.staff_user)
        self.set_up_chat(self.other)
        self.conversation = self.start(self.staff_user, self.other)
        self.message = self.send(self.staff_user, self.conversation['id']).json()
        self.url = f'/api/v1/chat/messages/{self.message["id"]}'

    def edit(self, user, revision=1):
        self.as_user(user)
        return self.client.patch(
            self.url, {'revision': revision, 'nonce': b64(24), 'ciphertext': b64(50)}, format='json'
        )

    def age_message(self, minutes):
        Message.objects.filter(pk=self.message['id']).update(created_at=timezone.now() - timedelta(minutes=minutes))

    def test_sender_can_edit_within_window(self):
        response = self.edit(self.staff_user)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['revision'], 1)
        self.assertIsNotNone(response.json()['edited_at'])
        self.assertEqual(self.edit(self.staff_user, revision=1).status_code, 409)

    def test_others_cannot_edit(self):
        self.assertEqual(self.edit(self.other).status_code, 403)

    def test_edit_window_closes(self):
        self.age_message(31)
        self.assertEqual(self.edit(self.staff_user).status_code, 403)
        self.as_user(self.staff_user)
        self.assertEqual(self.client.delete(self.url + '?scope=everyone').status_code, 403)

    def test_delete_for_everyone(self):
        MessageAttachment.objects.create(
            conversation_id=self.conversation['id'], message_id=self.message['id'], file_key='k', encrypted_size=1
        )
        self.as_user(self.staff_user)
        with patch('chat.tasks.queue_object_deletion') as deletion:
            with self.captureOnCommitCallbacks(execute=True):
                self.assertEqual(self.client.delete(self.url + '?scope=everyone').status_code, 204)
        deletion.assert_called_once_with(['k'])
        stored = Message.objects.get(pk=self.message['id'])
        self.assertIsNone(stored.ciphertext)
        self.assertIsNotNone(stored.deleted_at)
        self.as_user(self.other)
        listed = self.client.get(f'/api/v1/chat/conversations/{self.conversation["id"]}/messages').json()['results']
        self.assertTrue(listed[0]['deleted'])
        self.assertIsNone(listed[0]['ciphertext'])
        self.assertEqual(self.edit(self.staff_user).status_code, 409)

    def test_delete_for_me_hides_only_for_me(self):
        self.age_message(120)  # no time limit
        self.as_user(self.other)
        self.assertEqual(self.client.delete(self.url + '?scope=me').status_code, 204)
        self.assertEqual(HiddenMessage.objects.count(), 1)
        mine = self.client.get(f'/api/v1/chat/conversations/{self.conversation["id"]}/messages').json()['results']
        self.assertEqual(mine, [])
        self.assertEqual(self.client.get('/api/v1/chat/unread-count').json()['unread_count'], 0)
        self.as_user(self.staff_user)
        theirs = self.client.get(f'/api/v1/chat/conversations/{self.conversation["id"]}/messages').json()['results']
        self.assertEqual(len(theirs), 1)


class AttachmentTests(ChatTestCase):
    def setUp(self):
        super().setUp()
        self.set_up_chat(self.staff_user)
        self.set_up_chat(self.other)
        self.conversation = self.start(self.staff_user, self.other)

    def reserve(self, **data):
        self.as_user(self.staff_user)
        with patch('chat.storage.upload_url', return_value='https://upload.example/x'):
            return self.client.post(
                f'/api/v1/chat/conversations/{self.conversation["id"]}/attachments', data, format='json'
            )

    def test_size_limit(self):
        self.assertEqual(self.reserve(size=26 * 1024 * 1024 + 100 * 1024).status_code, 400)
        response = self.reserve(size=25 * 1024 * 1024, thumb_size=10_000)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['content_type'], 'application/octet-stream')

    def test_send_with_attachment_and_download_rules(self):
        attachment_id = self.reserve(size=1000, thumb_size=100).json()['id']
        self.assertEqual(self.send(self.staff_user, self.conversation['id'], kind='text', attachment_ids=[attachment_id]).status_code, 400)
        response = self.send(self.staff_user, self.conversation['id'], kind='attachment', attachment_ids=[attachment_id])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['attachments'], [{'id': attachment_id, 'size': 1000, 'has_thumb': True}])
        # Cannot be sent twice.
        again = self.send(self.staff_user, self.conversation['id'], kind='attachment', attachment_ids=[attachment_id])
        self.assertEqual(again.status_code, 400)

        self.as_user(self.other)
        with patch('chat.storage.download_url', return_value='https://download.example/x'):
            url = f'/api/v1/chat/attachments/{attachment_id}/download'
            self.assertEqual(self.client.get(url, {'part': 'thumb'}).json()['url'], 'https://download.example/x')
            self.set_up_chat(self.outsider)
            self.as_user(self.outsider)
            self.assertEqual(self.client.get(url).status_code, 404)

    def test_only_uploader_can_send_a_reserved_file(self):
        attachment_id = self.reserve(size=1000).json()['id']
        response = self.send(self.other, self.conversation['id'], kind='attachment', attachment_ids=[attachment_id])
        self.assertEqual(response.status_code, 400)

    def test_unsent_files_are_removed(self):
        attachment_id = self.reserve(size=1000).json()['id']
        MessageAttachment.objects.filter(pk=attachment_id).update(created_at=timezone.now() - timedelta(days=2))
        from chat.tasks import remove_unsent_attachments

        with patch('chat.tasks.delete_objects') as delete_objects:
            remove_unsent_attachments()
        self.assertFalse(MessageAttachment.objects.filter(pk=attachment_id).exists())
        delete_objects.assert_called_once()


class PushTests(ChatTestCase):
    @override_settings(WEB_PUSH_VAPID_PUBLIC_KEY='p', WEB_PUSH_VAPID_PRIVATE_KEY='k', WEB_PUSH_VAPID_SUBJECT='mailto:x@y')
    def test_offline_recipient_gets_push_without_content(self):
        self.set_up_chat(self.staff_user)
        self.set_up_chat(self.other)
        conversation = self.start(self.staff_user, self.other)
        with patch('notifications.services.push_to_user') as push:
            with self.captureOnCommitCallbacks(execute=True):
                self.send(self.staff_user, conversation['id'])
        push.assert_called_once()
        user_id, payload = push.call_args.args
        self.assertEqual(user_id, self.other.pk)
        self.assertEqual(payload['body'], 'New message')
        self.assertEqual(payload['url'], f'/chat/{conversation["id"]}')


@override_settings(
    STORAGES={
        'staticfiles': {'BACKEND': 'django.contrib.staticfiles.storage.StaticFilesStorage'},
    }
)
class ChatAdminTests(ChatTestCase):
    def test_admin_is_read_only_superuser_only_and_audited(self):
        from django.test import Client

        self.set_up_chat(self.staff_user)
        self.set_up_chat(self.other)
        conversation = self.start(self.staff_user, self.other)
        self.send(self.staff_user, conversation['id'])

        root = User.objects.create_superuser(username='root@example.com', email='root@example.com', password='x')
        staff_admin = User.objects.create_user(username='st@example.com', email='st@example.com', password='x', is_staff=True)
        browser = Client()

        browser.force_login(staff_admin)
        self.assertEqual(browser.get('/admin/chat/message/').status_code, 403)

        browser.force_login(root)
        listing = browser.get('/admin/chat/conversation/')
        self.assertEqual(listing.status_code, 200)
        self.assertContains(listing, 'Ada Obi')
        message = Message.objects.get(conversation_id=conversation['id'], kind='text')
        detail = browser.get(f'/admin/chat/message/{message.pk}/change/')
        self.assertEqual(detail.status_code, 200)
        self.assertContains(detail, 'encrypted')
        self.assertNotContains(detail, 'name="_save"')
        self.assertEqual(browser.get(f'/admin/chat/message/{message.pk}/delete/').status_code, 403)
        self.assertEqual(browser.get('/admin/chat/chataccount/add/').status_code, 403)
        self.assertEqual(
            AuditLog.objects.filter(action=AuditAction.CHAT_ADMIN_VIEWED, actor_user=root).count(), 2
        )
