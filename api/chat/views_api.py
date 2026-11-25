"""Chat endpoints. Rules live in chat/services.py; see docs/CHAT_SPEC.md."""

import logging

from rest_framework import permissions, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from audit import log_audit
from audit.actions import AuditAction
from accounts.services import check_signed_in_password, tries_left_text
from chat import realtime, services
from chat.serializers import (
    AccountBackupUpdateSerializer,
    AccountResetSerializer,
    AccountSetupSerializer,
    AddMembersSerializer,
    CreateGroupSerializer,
    GroupInfoUpdateSerializer,
    GroupPhotoSerializer,
    LinkPreviewSerializer,
    MemberRoleSerializer,
    TransferOwnerSerializer,
    ConversationSettingsSerializer,
    EditMessageSerializer,
    ForwardAttachmentSerializer,
    KeyVersionSerializer,
    PasswordCheckSerializer,
    ReactionSerializer,
    ReadSerializer,
    ResetCodeSerializer,
    ReserveAttachmentSerializer,
    SendMessageSerializer,
    StartConversationSerializer,
    account_of,
    account_payload,
    key_payload,
    message_payload,
    reaction_payload,
)


logger = logging.getLogger(__name__)


def _int_param(request, name, *, minimum=0, maximum=None):
    raw = request.query_params.get(name)
    if raw in (None, ''):
        return None
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise ValidationError({name: ['Must be a whole number.']})
    if value < minimum or (maximum is not None and value > maximum):
        raise ValidationError({name: ['Out of range.']})
    return value


class ChatView(APIView):
    permission_classes = [permissions.IsAuthenticated]


class ThrottledChatView(ChatView):
    throttle_classes = [ScopedRateThrottle]


class AccountView(ThrottledChatView):
    """The signed-in user's chat key: public key plus the two encrypted copies
    of the private key (PIN and portal password together, or the recovery code)."""

    throttle_scope = 'chat_keys'

    def get_throttles(self):
        return [] if self.request.method == 'GET' else super().get_throttles()

    def get(self, request):
        account = account_of(request.user)
        return Response({'set_up': account is not None, 'account': account_payload(account) if account else None})

    def post(self, request):
        serializer = AccountSetupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = services.set_up_account(request.user, **serializer.validated_data)
        log_audit(action=AuditAction.CHAT_SETUP, request=request, target_type='User', target_id=request.user.id)
        return Response({'set_up': True, 'account': account_payload(account)}, status=status.HTTP_201_CREATED)

    def patch(self, request):
        serializer = AccountBackupUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        account = services.require_account(request.user)
        account = services.update_backups(
            account,
            pin=serializer.validated_data.get('pin'),
            recovery=serializer.validated_data.get('recovery'),
        )
        log_audit(
            action=AuditAction.CHAT_KEY_BACKUP_UPDATED,
            request=request,
            target_type='User',
            target_id=request.user.id,
            metadata={'parts': sorted(serializer.validated_data)},
        )
        return Response({'set_up': True, 'account': account_payload(account)})


class AccountResetCodeView(ThrottledChatView):
    """Emails the code that confirms a chat reset."""

    throttle_scope = 'chat_keys'

    def post(self, request):
        expires_in = services.send_reset_code(request.user)
        log_audit(action=AuditAction.CHAT_RESET_CODE_SENT, request=request, target_type='User', target_id=request.user.id)
        return Response({'sent_to': request.user.email, 'expires_in': expires_in}, status=status.HTTP_201_CREATED)


class AccountResetCodeCheckView(ThrottledChatView):
    """Checks the emailed code before a new PIN is chosen (the code still has
    to be sent with the reset itself)."""

    throttle_scope = 'chat_keys'

    def post(self, request):
        serializer = ResetCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.check_reset_code(request.user, serializer.validated_data['code'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class AccountResetView(ThrottledChatView):
    """Start over with a new key (PIN and recovery code both lost), confirmed
    with the code emailed by AccountResetCodeView."""

    throttle_scope = 'chat_keys'

    def post(self, request):
        serializer = AccountResetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        code = data.pop('code')
        services.require_account(request.user)
        services.check_reset_code(request.user, code, use=True)
        account = services.reset_account(request.user, **data)
        log_audit(action=AuditAction.CHAT_KEY_RESET, request=request, target_type='User', target_id=request.user.id)
        return Response({'set_up': True, 'account': account_payload(account)})


class SessionSecretsView(ThrottledChatView):
    """A per-browser secret that seals the unlocked key kept in that browser,
    so the copy left on a shared computer is useless after sign-out. Each one
    is kept for hours, so making them is rate limited."""

    throttle_scope = 'chat_session_secrets'

    def post(self, request):
        # Also used straight after sign-in, before chat is set up, to seal the
        # password-derived secret until the user first opens chat.
        secret_id, secret = realtime.create_session_secret(request.user.pk)
        return Response({'id': secret_id, 'secret': secret}, status=status.HTTP_201_CREATED)


class SessionSecretView(ChatView):
    def get(self, request, secret_id):
        secret = realtime.get_session_secret(request.user.pk, secret_id)
        if secret is None:
            raise NotFound('This browser needs to unlock chat again.')
        return Response({'id': secret_id, 'secret': secret})

    def delete(self, request, secret_id):
        realtime.delete_session_secret(request.user.pk, secret_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class PasswordCheckView(ThrottledChatView):
    """Confirms the portal password before chat is locked with it, so a typo
    does not lock someone out of their own messages."""

    throttle_scope = 'chat_keys'

    def post(self, request):
        serializer = PasswordCheckSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        left = check_signed_in_password(
            request,
            serializer.validated_data['password'],
            audit_action=AuditAction.AUTH_PASSWORD_CHECK_FAILED,
            where='chat',
        )
        if left is not None:
            raise ValidationError({'password': [f'That is not your portal password. {tries_left_text(left)}']})
        return Response(status=status.HTTP_204_NO_CONTENT)


class TicketView(ThrottledChatView):
    throttle_scope = 'chat_tickets'

    def post(self, request):
        services.require_account(request.user)
        return Response({'ticket': realtime.issue_ticket(request.user.pk), 'expires_in': realtime.TICKET_TTL})


class PeopleView(ChatView):
    def get(self, request):
        search = (request.query_params.get('search') or '').strip()[:100]
        return Response({'results': services.people(request.user, search)})


class InviteView(ChatView):
    """Invite someone who has not set up chat (again: a reminder, once a day)."""

    def post(self, request, user_id):
        conversation = services.invite(request.user, user_id)
        participant = services.get_membership(request.user, conversation.id)
        return Response(services.conversation_payload(request.user, participant))


class UnreadCountView(ChatView):
    def get(self, request):
        return Response({'unread_count': services.total_unread(request.user)})


class ConversationsView(ChatView):
    def get(self, request):
        results, next_cursor = services.list_conversations(
            request.user,
            before=request.query_params.get('before') or None,
            limit=_int_param(request, 'limit', minimum=1, maximum=100) or services.CONVERSATION_PAGE_SIZE,
        )
        return Response(
            {
                'results': results,
                'has_more': next_cursor is not None,
                'next': next_cursor,
                # The sidebar badge counts every conversation, loaded or not.
                'unread_total': services.total_unread(request.user),
            }
        )

    def post(self, request):
        serializer = StartConversationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        conversation, created = services.start_direct(
            request.user, other_id=serializer.validated_data['user_id'], keys=serializer.validated_data['keys']
        )
        participant = services.get_membership(request.user, conversation.id)
        return Response(
            services.conversation_payload(request.user, participant),
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ConversationView(ChatView):
    def get(self, request, conversation_id):
        participant = services.get_membership(request.user, conversation_id)
        return Response(services.conversation_payload(request.user, participant))

    def patch(self, request, conversation_id):
        serializer = ConversationSettingsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        participant = services.update_settings(request.user, conversation_id, data=serializer.validated_data)
        return Response(services.conversation_payload(request.user, participant))


class GroupsView(ThrottledChatView):
    """Create a group (you become its admin)."""

    throttle_scope = 'chat_keys'

    def post(self, request):
        serializer = CreateGroupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        conversation = services.create_group(request.user, **serializer.validated_data)
        participant = services.get_membership(request.user, conversation.id)
        return Response(services.conversation_payload(request.user, participant), status=status.HTTP_201_CREATED)


class GroupInfoView(ThrottledChatView):
    """Admins change the group name, description or photo (all encrypted)."""

    throttle_scope = 'chat_keys'

    def patch(self, request, conversation_id):
        serializer = GroupInfoUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        if 'photo_object_key' not in request.data:
            data.pop('photo_object_key', None)
        conversation = services.update_group_info(request.user, conversation_id, **data)
        participant = services.get_membership(request.user, conversation.id)
        return Response(services.conversation_payload(request.user, participant))


class GroupPhotoView(ThrottledChatView):
    """POST: an upload link for a new (encrypted) group photo. GET: a short download link."""

    throttle_scope = 'chat_uploads'

    def get_throttles(self):
        return [] if self.request.method == 'GET' else super().get_throttles()

    def get(self, request, conversation_id):
        return Response({'url': services.group_photo_download(request.user, conversation_id)})

    def post(self, request, conversation_id):
        serializer = GroupPhotoSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(services.reserve_group_photo(request.user, conversation_id, **serializer.validated_data))


class GroupMembersView(ThrottledChatView):
    """Admins add people (with a new key version for everyone)."""

    throttle_scope = 'chat_keys'

    def post(self, request, conversation_id):
        serializer = AddMembersSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        conversation = services.add_group_members(request.user, conversation_id, **serializer.validated_data)
        participant = services.get_membership(request.user, conversation.id)
        return Response(services.conversation_payload(request.user, participant), status=status.HTTP_201_CREATED)


class GroupMemberView(ThrottledChatView):
    """PATCH: make someone an admin or not (admins). DELETE: remove someone (admins), or leave (yourself)."""

    throttle_scope = 'chat_keys'

    def patch(self, request, conversation_id, user_id):
        serializer = MemberRoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.set_group_admin(request.user, conversation_id, user_id, admin=serializer.validated_data['admin'])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def delete(self, request, conversation_id, user_id):
        services.remove_group_member(request.user, conversation_id, user_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class LinkPreviewView(ThrottledChatView):
    """The title, description and a small picture for a link about to be sent.
    The server fetches the page (browsers cannot) and keeps nothing; the
    sender's browser encrypts the preview into the message."""

    throttle_scope = 'chat_link_preview'

    def post(self, request):
        from chat.link_preview import PreviewUnavailable, fetch_preview, preview_slot

        services.require_account(request.user)
        serializer = LinkPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        preview = None
        with preview_slot() as free:
            # All slots busy: the message simply goes without a preview.
            if free:
                try:
                    preview = fetch_preview(serializer.validated_data['url'])
                except PreviewUnavailable:
                    pass
                except Exception:
                    # Never log the link itself: it can be private.
                    logger.warning('Link preview failed unexpectedly', exc_info=True)
        return Response({'preview': preview})


class GroupOwnerView(ThrottledChatView):
    """The owner hands the group over to another member."""

    throttle_scope = 'chat_keys'

    def post(self, request, conversation_id):
        serializer = TransferOwnerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.transfer_ownership(request.user, conversation_id, serializer.validated_data['user_id'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ConversationKeysView(ThrottledChatView):
    throttle_scope = 'chat_keys'

    def get_throttles(self):
        return [] if self.request.method == 'GET' else super().get_throttles()

    def get(self, request, conversation_id):
        rows = services.my_keys(request.user, conversation_id)
        return Response({'results': [key_payload(row) for row in rows]})

    def post(self, request, conversation_id):
        serializer = KeyVersionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        version = services.add_key_version(request.user, conversation_id, **serializer.validated_data)
        return Response({'version': version}, status=status.HTTP_201_CREATED)


class MessagesView(ThrottledChatView):
    throttle_scope = 'chat_messages'

    def get_throttles(self):
        return [] if self.request.method == 'GET' else super().get_throttles()

    def get(self, request, conversation_id):
        rows, has_more = services.list_messages(
            request.user,
            conversation_id,
            before_seq=_int_param(request, 'before_seq', minimum=1),
            after_seq=_int_param(request, 'after_seq'),
            limit=_int_param(request, 'limit', minimum=1, maximum=100) or 50,
        )
        return Response({'results': [message_payload(m) for m in rows], 'has_more': has_more})

    def post(self, request, conversation_id):
        serializer = SendMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message, created = services.send_message(request.user, conversation_id, data=serializer.validated_data)
        return Response(message_payload(message), status=status.HTTP_201_CREATED if created else status.HTTP_200_OK)


class MessageView(ChatView):
    def patch(self, request, message_id):
        serializer = EditMessageSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        message = services.edit_message(request.user, message_id, data=serializer.validated_data)
        return Response(message_payload(message))

    def delete(self, request, message_id):
        scope = request.query_params.get('scope', 'me')
        if scope == 'everyone':
            services.delete_for_everyone(request.user, message_id)
        elif scope == 'me':
            services.hide_for_me(request.user, message_id)
        else:
            raise ValidationError({'scope': ['Use "everyone" or "me".']})
        return Response(status=status.HTTP_204_NO_CONTENT)


class MessageReactionView(ThrottledChatView):
    """Your reaction to a message: PUT to add or change it, DELETE to remove it."""

    throttle_scope = 'chat_messages'

    def put(self, request, message_id):
        serializer = ReactionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reaction = services.set_reaction(request.user, message_id, data=serializer.validated_data)
        return Response(reaction_payload(reaction))

    def delete(self, request, message_id):
        services.remove_reaction(request.user, message_id)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ReadView(ChatView):
    def post(self, request, conversation_id):
        serializer = ReadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        seq = services.mark_read(request.user, conversation_id, seq=serializer.validated_data['seq'])
        return Response({'last_read_seq': seq})


class AttachmentsView(ThrottledChatView):
    throttle_scope = 'chat_uploads'

    def post(self, request, conversation_id):
        serializer = ReserveAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reserved = services.reserve_attachment(
            request.user,
            conversation_id,
            size=serializer.validated_data['size'],
            thumb_size=serializer.validated_data.get('thumb_size'),
        )
        return Response(reserved, status=status.HTTP_201_CREATED)


class ForwardAttachmentView(ThrottledChatView):
    """Copy a file from one of your chats into this one, to forward it."""

    throttle_scope = 'chat_uploads'

    def post(self, request, conversation_id):
        serializer = ForwardAttachmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = services.forward_attachment(
            request.user, conversation_id, source_id=serializer.validated_data['attachment_id']
        )
        return Response(result, status=status.HTTP_201_CREATED)


class AttachmentDownloadView(ChatView):
    def get(self, request, attachment_id):
        part = request.query_params.get('part', 'file')
        if part not in ('file', 'thumb'):
            raise ValidationError({'part': ['Use "file" or "thumb".']})
        return Response({'url': services.attachment_download(request.user, attachment_id, part=part)})

