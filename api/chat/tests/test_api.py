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
from chat.models import (
    ChatAccount,
    Conversation,
    ConversationKey,
    HiddenMessage,
    Message,
    MessageAttachment,
    MessageReaction,
    Participant,
)
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

    def test_making_session_secrets_is_rate_limited_but_reading_them_is_not(self):
        # Each one is kept for hours, so a user cannot fill the cache with them;
        # the service worker reads one for every push, so reads are not limited.
        from django.core.cache import cache

        # The test base switches rate limits off; this test needs them.
        self.throttle_patcher.stop()
        self.addCleanup(self.throttle_patcher.start)
        cache.clear()
        self.as_user(self.staff_user)
        responses = [self.client.post('/api/v1/chat/session-secrets') for _ in range(31)]
        self.assertTrue(all(r.status_code == 201 for r in responses[:30]))
        self.assertEqual(responses[30].status_code, 429)
        url = f'/api/v1/chat/session-secrets/{responses[0].json()["id"]}'
        self.assertTrue(all(self.client.get(url).status_code == 200 for _ in range(40)))

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


class ConversationSettingsTests(ChatTestCase):
    def test_mute_archive_and_hide_are_personal(self):
        self.set_up_chat(self.staff_user)
        self.set_up_chat(self.other)
        conversation = self.start(self.staff_user, self.other)
        self.send(self.other, conversation['id'])
        url = f'/api/v1/chat/conversations/{conversation["id"]}'
        listed = lambda: [c['id'] for c in self.client.get('/api/v1/chat/conversations').json()['results']]  # noqa: E731

        self.as_user(self.staff_user)
        muted = self.client.patch(url, {'muted_until': '9999-12-31T00:00:00Z', 'archived': True}, format='json').json()
        self.assertTrue(muted['muted_until'].startswith('9999'))
        self.assertTrue(muted['archived'])
        # A muted chat does not count towards the sidebar badge.
        self.assertEqual(self.client.get('/api/v1/chat/unread-count').json()['unread_count'], 0)
        # Only for this person.
        self.as_user(self.other)
        theirs = self.client.get(url).json()
        self.assertIsNone(theirs['muted_until'])
        self.assertFalse(theirs['archived'])

        # Hidden: gone from the list until a new message arrives.
        self.as_user(self.staff_user)
        self.assertEqual(self.client.patch(url, {'hidden': True}, format='json').status_code, 200)
        self.assertNotIn(conversation['id'], listed())
        self.send(self.other, conversation['id'])
        self.as_user(self.staff_user)
        self.assertIn(conversation['id'], listed())
        # It can still be opened directly while hidden.
        self.client.patch(url, {'hidden': True}, format='json')
        self.assertEqual(self.client.get(url).status_code, 200)
        self.client.patch(url, {'hidden': False}, format='json')
        self.assertIn(conversation['id'], listed())


class ConversationListPagingTests(ChatTestCase):
    def test_pages_follow_recent_activity_without_overlap_and_count_all_unread(self):
        self.set_up_chat(self.staff_user)
        people = []
        for index in range(5):
            person = User.objects.create_user(
                username=f'p{index}@example.com', email=f'p{index}@example.com', password='x', first_name=f'P{index}'
            )
            StaffProfile.objects.create(user=person, role=self.role_staff, department=self.dep_hr)
            self.set_up_chat(person)
            people.append(person)
        ids = []
        for person in people:
            conversation = self.start(self.staff_user, person)
            ids.append(conversation['id'])
            self.assertEqual(self.send(person, conversation['id']).status_code, 201)
        # The newest activity is the last chat started: expected order is reversed.
        expected = list(reversed(ids))

        self.as_user(self.staff_user)
        url = '/api/v1/chat/conversations'
        first = self.client.get(url, {'limit': 2}).json()
        self.assertEqual([c['id'] for c in first['results']], expected[:2])
        self.assertTrue(first['has_more'])
        self.assertEqual(first['unread_total'], 5)  # all five chats, not just this page

        second = self.client.get(url, {'limit': 2, 'before': first['next']}).json()
        self.assertEqual([c['id'] for c in second['results']], expected[2:4])
        third = self.client.get(url, {'limit': 2, 'before': second['next']}).json()
        self.assertEqual([c['id'] for c in third['results']], expected[4:])
        self.assertFalse(third['has_more'])
        self.assertIsNone(third['next'])

        # A new message moves an old chat back to the top of page one.
        self.send(people[0], ids[0])
        self.assertEqual(self.client.get(url, {'limit': 2}).json()['results'][0]['id'], ids[0])

        self.assertEqual(self.client.get(url, {'before': 'nonsense'}).status_code, 400)


class ReactionTests(ChatTestCase):
    def setUp(self):
        super().setUp()
        self.set_up_chat(self.staff_user)
        self.set_up_chat(self.other)
        self.conversation = self.start(self.staff_user, self.other)
        self.message = self.send(self.staff_user, self.conversation['id']).json()
        self.url = f'/api/v1/chat/messages/{self.message["id"]}/reaction'

    def react(self, user, **overrides):
        self.as_user(user)
        return self.client.put(self.url, {'key_version': 1, 'nonce': b64(24), 'ciphertext': b64(40), **overrides}, format='json')

    def reactions(self, user):
        self.as_user(user)
        rows = self.client.get(f'/api/v1/chat/conversations/{self.conversation["id"]}/messages').json()['results']
        return next(m for m in rows if m['id'] == self.message['id'])['reactions']

    def test_one_encrypted_reaction_per_person_that_can_be_changed_and_removed(self):
        self.assertEqual(self.react(self.other).status_code, 200)
        changed = self.react(self.other, ciphertext=b64(41))
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(self.react(self.staff_user).status_code, 200)
        listed = self.reactions(self.staff_user)
        self.assertEqual(sorted(r['user_id'] for r in listed), sorted([self.staff_user.pk, self.other.pk]))
        self.assertEqual(MessageReaction.objects.filter(user=self.other).count(), 1)
        # Only an encrypted value is stored: no emoji field exists to read.
        self.assertEqual(next(r for r in listed if r['user_id'] == self.other.pk)['ciphertext'], changed.json()['ciphertext'])

        # The list preview carries the newest reaction and its message.
        self.as_user(self.staff_user)
        listed_conversation = self.client.get('/api/v1/chat/conversations').json()['results'][0]
        self.assertEqual(listed_conversation['last_reaction']['user_id'], self.staff_user.pk)
        self.assertEqual(listed_conversation['last_reaction']['message']['id'], self.message['id'])

        self.as_user(self.other)
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        self.assertEqual([r['user_id'] for r in self.reactions(self.other)], [self.staff_user.pk])

    def test_rules(self):
        self.assertEqual(self.react(self.other, key_version=2).status_code, 409)  # not the newest key
        self.set_up_chat(self.outsider)
        self.assertEqual(self.react(self.outsider).status_code, 404)  # not in the chat
        self.assertEqual(self.react(self.other, ciphertext=b64(400)).status_code, 400)

        # Deleting a message for everyone removes its reactions, and it can no longer get any.
        self.react(self.other)
        self.as_user(self.staff_user)
        self.client.delete(f'/api/v1/chat/messages/{self.message["id"]}?scope=everyone')
        self.assertFalse(MessageReaction.objects.exists())
        self.assertEqual(self.react(self.other).status_code, 409)


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

    def test_voice_message_is_exactly_one_recording(self):
        first = self.reserve(size=4000).json()['id']
        second = self.reserve(size=4000).json()['id']
        conversation = self.conversation['id']
        self.assertEqual(self.send(self.staff_user, conversation, kind='voice').status_code, 400)
        self.assertEqual(
            self.send(self.staff_user, conversation, kind='voice', attachment_ids=[first, second]).status_code, 400
        )
        response = self.send(self.staff_user, conversation, kind='voice', attachment_ids=[first])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()['kind'], 'voice')

    @override_settings(CHAT_STORAGE_COPY=True, AWS_S3_BUCKET_NAME='bucket')
    def test_forwarding_copies_the_encrypted_file_into_another_chat(self):
        attachment_id = self.reserve(size=1000, thumb_size=100).json()['id']
        self.send(self.staff_user, self.conversation['id'], kind='attachment', attachment_ids=[attachment_id])
        self.set_up_chat(self.outsider)
        second = self.start(self.staff_user, self.outsider)
        url = f'/api/v1/chat/conversations/{second["id"]}/attachments/forward'

        self.as_user(self.staff_user)
        with patch('chat.storage.s3_client') as client:
            response = self.client.post(url, {'attachment_id': attachment_id}, format='json')
        self.assertEqual(response.status_code, 201, response.content)
        source = MessageAttachment.objects.get(pk=attachment_id)
        copy = MessageAttachment.objects.get(pk=response.json()['id'])
        self.assertEqual(str(copy.conversation_id), second['id'])
        self.assertIsNone(copy.message_id)  # reserved, sent with the forwarded message
        self.assertEqual((copy.encrypted_size, copy.thumb_size), (1000, 100))
        copies = [call.kwargs for call in client.return_value.copy_object.call_args_list]
        self.assertEqual(
            [(c['CopySource']['Key'], c['Key']) for c in copies],
            [(source.file_key, copy.file_key), (source.thumb_key, copy.thumb_key)],
        )
        sent = self.send(self.staff_user, second['id'], kind='attachment', attachment_ids=[copy.pk])
        self.assertEqual(sent.status_code, 201, sent.content)

        # Only from chats you are in, into chats you are in, and not from deleted messages.
        self.as_user(self.outsider)
        with patch('chat.storage.s3_client'):
            self.assertEqual(self.client.post(url, {'attachment_id': attachment_id}, format='json').status_code, 404)
        self.as_user(self.other)
        with patch('chat.storage.s3_client'):
            self.assertEqual(self.client.post(url, {'attachment_id': attachment_id}, format='json').status_code, 404)
        message_id = str(source.message_id)
        self.as_user(self.staff_user)
        self.client.delete(f'/api/v1/chat/messages/{message_id}?scope=everyone')
        with patch('chat.storage.s3_client'):
            self.assertEqual(self.client.post(url, {'attachment_id': attachment_id}, format='json').status_code, 404)

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
        # The push carries the message only encrypted, for the service worker to open.
        chat = payload['chat']
        message = Message.objects.get(conversation_id=conversation['id'], kind='text')
        self.assertEqual(chat['ciphertext'], message.ciphertext)
        self.assertEqual(chat['message_id'], str(message.id))
        self.assertEqual(chat['conversation_kind'], 'direct')
        self.assertNotIn('text', chat)

    @override_settings(WEB_PUSH_VAPID_PUBLIC_KEY='p', WEB_PUSH_VAPID_PRIVATE_KEY='k', WEB_PUSH_VAPID_SUBJECT='mailto:x@y')
    def test_push_is_sent_even_with_the_portal_open(self):
        from chat import realtime

        self.set_up_chat(self.staff_user)
        self.set_up_chat(self.other)
        conversation = self.start(self.staff_user, self.other)
        realtime.mark_online(self.other.pk)  # a portal tab open
        with patch('notifications.services.push_to_user') as push:
            with self.captureOnCommitCallbacks(execute=True):
                self.send(self.staff_user, conversation['id'])
        push.assert_called_once()
        self.assertEqual(push.call_args.args[0], self.other.pk)

    @override_settings(WEB_PUSH_VAPID_PUBLIC_KEY='p', WEB_PUSH_VAPID_PRIVATE_KEY='k', WEB_PUSH_VAPID_SUBJECT='mailto:x@y')
    def test_large_messages_are_fetched_not_pushed(self):
        self.set_up_chat(self.staff_user)
        self.set_up_chat(self.other)
        conversation = self.start(self.staff_user, self.other)
        with patch('notifications.services.push_to_user') as push:
            with self.captureOnCommitCallbacks(execute=True):
                self.send(self.staff_user, conversation['id'], ciphertext=b64(3000))
        chat = push.call_args.args[1]['chat']
        self.assertNotIn('ciphertext', chat)
        self.assertEqual(chat['key_version'], 1)


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


def info(version=1, digest='a' * 64):
    """Encrypted group details. `digest`: the fingerprint an admin sends with new
    details (None: leave it out, as a member re-locking does)."""
    return {
        'key_version': version,
        'nonce': b64(24),
        'ciphertext': b64(80),
        **({'digest': digest} if digest else {}),
    }


class GroupTests(ChatTestCase):
    def setUp(self):
        super().setUp()
        self.set_up_chat(self.staff_user)
        self.set_up_chat(self.other)
        self.fourth = User.objects.create_user(username='f@example.com', email='f@example.com', password='x', first_name='Fola')
        StaffProfile.objects.create(user=self.fourth, role=self.role_staff, department=self.dep_hr)

    def create(self, member_ids=None, keys=None):
        self.as_user(self.staff_user)
        from django.core import mail

        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                '/api/v1/chat/groups',
                {
                    'id': str(uuid.uuid4()),
                    'member_ids': member_ids or [self.other.pk, self.outsider.pk],
                    'keys': keys or self.wrapped_for(self.staff_user, self.other),
                    'info': info(),
                },
                format='json',
            )
        self.mail = mail.outbox
        return response

    def test_create_with_a_pending_member_and_message(self):
        response = self.create()
        self.assertEqual(response.status_code, 201, response.content)
        group = response.json()
        self.assertEqual(group['kind'], 'group')
        self.assertEqual(group['role'], 'owner')
        self.assertIsNotNone(group['info'])
        people = {p['id']: p for p in group['participants']}
        self.assertTrue(people[self.outsider.pk]['pending'])
        self.assertEqual(people[self.staff_user.pk]['role'], 'owner')
        self.assertEqual([m.to for m in self.mail], [[self.outsider.email]])
        self.assertTrue(Notification.objects.filter(recipient=self.outsider).exists())
        notes = list(Message.objects.filter(conversation_id=group['id'], kind='system').values_list('system_event', flat=True))
        self.assertEqual(notes, ['group_created'])

        # Messages need keys for the members who have chat; pending ones are skipped.
        self.assertEqual(self.send(self.other, group['id']).status_code, 201)

        # When the pending member sets up chat they join, and the key must include them.
        self.set_up_chat(self.outsider)
        participant = Participant.objects.get(conversation_id=group['id'], user=self.outsider)
        self.assertFalse(participant.pending)
        self.assertTrue(Message.objects.filter(conversation_id=group['id'], system_event='member_joined').exists())
        self.assertEqual(self.send(self.staff_user, group['id']).status_code, 409)
        self.as_user(self.staff_user)
        response = self.client.post(
            f'/api/v1/chat/conversations/{group["id"]}/keys',
            {'version': 2, 'keys': self.wrapped_for(self.staff_user, self.other, self.outsider), 'info': info(2)},
            format='json',
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(Conversation.objects.get(pk=group['id']).info_key_version, 2)
        self.assertEqual(self.send(self.staff_user, group['id'], key_version=2).status_code, 201)

    def test_any_member_can_relock_the_details_with_the_newest_key(self):
        group = self.create().json()
        base = f'/api/v1/chat/conversations/{group["id"]}'
        # A key made without the details (by someone who could not read them).
        self.as_user(self.other)
        self.client.post(f'{base}/keys', {'version': 2, 'keys': self.wrapped_for(self.staff_user, self.other)}, format='json')
        self.assertEqual(Conversation.objects.get(pk=group['id']).info_key_version, 1)
        # A plain member re-locks them: no note; changing them still needs an admin.
        relocked = self.client.patch(f'{base}/info', {'info': info(2), 'changed': []}, format='json')
        self.assertEqual(relocked.status_code, 200, relocked.content)
        self.assertEqual(Conversation.objects.get(pk=group['id']).info_key_version, 2)
        self.assertFalse(Message.objects.filter(conversation_id=group['id'], system_event='info_changed').exists())
        self.assertEqual(
            self.client.patch(f'{base}/info', {'info': info(2), 'changed': ['name']}, format='json').status_code, 403
        )

    def test_only_admins_set_the_details_fingerprint(self):
        """Members re-lock the details with new keys, but only an admin's change
        sets the fingerprint browsers check, so a member cannot rename the group."""
        created = self.create(member_ids=[self.other.pk])
        group = created.json()
        self.assertEqual(group['info']['digest'], 'a' * 64)
        base = f'/api/v1/chat/conversations/{group["id"]}'
        digest = lambda: Conversation.objects.get(pk=group['id']).info_digest  # noqa: E731

        # A plain member makes a new key and sends other details with it: the fingerprint stays.
        self.as_user(self.other)
        rotated = self.client.post(
            f'{base}/keys',
            {'version': 2, 'keys': self.wrapped_for(self.staff_user, self.other), 'info': info(2, digest='b' * 64)},
            format='json',
        )
        self.assertEqual(rotated.status_code, 201, rotated.content)
        self.assertEqual(digest(), 'a' * 64)
        # Nor through a re-lock.
        self.client.post(f'{base}/keys', {'version': 3, 'keys': self.wrapped_for(self.staff_user, self.other)}, format='json')
        relocked = self.client.patch(f'{base}/info', {'info': info(3, digest='c' * 64), 'changed': []}, format='json')
        self.assertEqual(relocked.status_code, 200, relocked.content)
        self.assertEqual(digest(), 'a' * 64)

        # The admin changes the details: the new fingerprint is kept, and it is required.
        self.as_user(self.staff_user)
        missing = self.client.patch(f'{base}/info', {'info': info(3, digest=None), 'changed': ['name']}, format='json')
        self.assertEqual(missing.status_code, 400)
        changed = self.client.patch(f'{base}/info', {'info': info(3, digest='d' * 64), 'changed': ['name']}, format='json')
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(digest(), 'd' * 64)

    def test_a_group_needs_the_details_fingerprint(self):
        self.as_user(self.staff_user)
        response = self.client.post(
            '/api/v1/chat/groups',
            {
                'id': str(uuid.uuid4()),
                'member_ids': [self.other.pk],
                'keys': self.wrapped_for(self.staff_user, self.other),
                'info': info(digest=None),
            },
            format='json',
        )
        self.assertEqual(response.status_code, 400)

    def test_keys_must_cover_every_member_with_chat(self):
        response = self.create(keys=self.wrapped_for(self.staff_user))
        self.assertEqual(response.status_code, 409)
        self.assertFalse(Conversation.objects.filter(kind='group').exists())

    def test_admins_manage_members_and_removed_people_lose_access(self):
        group = self.create().json()
        base = f'/api/v1/chat/conversations/{group["id"]}'

        # Members cannot manage the group.
        self.as_user(self.other)
        self.assertEqual(self.client.delete(f'{base}/members/{self.outsider.pk}').status_code, 403)
        self.assertEqual(
            self.client.patch(f'{base}/info', {'info': info(), 'changed': ['name']}, format='json').status_code, 403
        )

        # The admin adds someone with a new key covering everyone.
        self.set_up_chat(self.fourth)
        self.as_user(self.staff_user)
        added = self.client.post(
            f'{base}/members',
            {
                'member_ids': [self.fourth.pk],
                'version': 2,
                'keys': self.wrapped_for(self.staff_user, self.other, self.fourth),
                'info': info(2),
            },
            format='json',
        )
        self.assertEqual(added.status_code, 201, added.content)
        self.assertTrue(Message.objects.filter(conversation_id=group['id'], system_event='member_added').exists())

        # Removing someone: they lose access, and the old key no longer covers the group.
        self.assertEqual(self.client.delete(f'{base}/members/{self.other.pk}').status_code, 204)
        self.as_user(self.other)
        self.assertEqual(self.client.get(base).status_code, 404)
        self.assertEqual(self.send(self.staff_user, group['id'], key_version=2).status_code, 409)

        # Making an admin, then the owner leaving: the longest-standing admin becomes owner.
        self.as_user(self.staff_user)
        self.assertEqual(self.client.patch(f'{base}/members/{self.fourth.pk}', {'admin': True}, format='json').status_code, 204)
        self.assertEqual(self.client.delete(f'{base}/members/{self.staff_user.pk}').status_code, 204)
        roles = dict(Participant.objects.filter(conversation_id=group['id'], left_at__isnull=True).values_list('user_id', 'role'))
        self.assertEqual(roles[self.fourth.pk], 'owner')
        note = Message.objects.filter(conversation_id=group['id'], system_event='owner_transferred').get()
        self.assertTrue(note.system_data['automatic'])

    def test_owner_leaving_without_admins_hands_over_to_the_longest_standing_member(self):
        group = self.create().json()
        self.as_user(self.staff_user)
        self.client.delete(f'/api/v1/chat/conversations/{group["id"]}/members/{self.staff_user.pk}')
        self.assertEqual(Participant.objects.get(conversation_id=group['id'], user=self.other).role, 'owner')

    def test_only_the_owner_manages_admins_and_nobody_removes_the_owner(self):
        self.set_up_chat(self.fourth)
        group = self.create(
            member_ids=[self.other.pk, self.fourth.pk],
            keys=self.wrapped_for(self.staff_user, self.other, self.fourth),
        ).json()
        base = f'/api/v1/chat/conversations/{group["id"]}'
        self.as_user(self.staff_user)
        self.client.patch(f'{base}/members/{self.other.pk}', {'admin': True}, format='json')
        self.client.patch(f'{base}/members/{self.fourth.pk}', {'admin': True}, format='json')

        # An admin cannot demote or remove another admin, or touch the owner.
        self.as_user(self.other)
        self.assertEqual(self.client.patch(f'{base}/members/{self.fourth.pk}', {'admin': False}, format='json').status_code, 403)
        self.assertEqual(self.client.delete(f'{base}/members/{self.fourth.pk}').status_code, 403)
        self.assertEqual(self.client.delete(f'{base}/members/{self.staff_user.pk}').status_code, 403)
        self.assertEqual(self.client.patch(f'{base}/members/{self.staff_user.pk}', {'admin': False}, format='json').status_code, 403)
        self.assertEqual(self.client.post(f'{base}/owner', {'user_id': self.other.pk}, format='json').status_code, 403)

        # The owner can demote an admin and hand the group over, becoming an admin.
        self.as_user(self.staff_user)
        self.assertEqual(self.client.patch(f'{base}/members/{self.fourth.pk}', {'admin': False}, format='json').status_code, 204)
        self.assertEqual(self.client.post(f'{base}/owner', {'user_id': self.other.pk}, format='json').status_code, 204)
        roles = dict(Participant.objects.filter(conversation_id=group['id']).values_list('user_id', 'role'))
        self.assertEqual((roles[self.other.pk], roles[self.staff_user.pk]), ('owner', 'admin'))
        self.assertTrue(Message.objects.filter(conversation_id=group['id'], system_event='owner_transferred').exists())

    def test_group_details_and_photo(self):
        group = self.create().json()
        base = f'/api/v1/chat/conversations/{group["id"]}'
        self.as_user(self.staff_user)
        self.assertEqual(
            self.client.patch(f'{base}/info', {'info': info(2), 'changed': ['name']}, format='json').status_code, 409
        )  # must use the newest key
        self.assertEqual(
            self.client.patch(
                f'{base}/info', {'info': info(), 'changed': ['photo'], 'photo_object_key': 'elsewhere/x.bin'}, format='json'
            ).status_code,
            400,
        )
        with patch('chat.storage.upload_url', return_value='https://upload.example/x'):
            reserved = self.client.post(f'{base}/photo', {'size': 30_000}, format='json').json()
        saved = self.client.patch(
            f'{base}/info',
            {'info': info(), 'changed': ['name', 'photo'], 'photo_object_key': reserved['object_key']},
            format='json',
        )
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertTrue(saved.json()['has_photo'])
        note = Message.objects.filter(conversation_id=group['id'], system_event='info_changed').get()
        self.assertEqual(note.system_data['fields'], ['name', 'photo'])
