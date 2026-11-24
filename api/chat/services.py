"""Chat rules. Views validate input and call these; these enforce who may do
what and keep conversations, keys and messages consistent.

The server never sees plaintext: it checks membership, ordering, timing and
sizes, and routes opaque encrypted values between participants.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
import time
import uuid
from datetime import datetime, timedelta

from django.conf import settings
from django.core.cache import cache
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import F, Max, OuterRef, Q, Subquery
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from chat import realtime
from chat import storage as chat_storage
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
from chat.serializers import account_of, message_payload, person_payload, reaction_payload
from common.exceptions import Conflict, ServiceUnavailable
from common.storage import StorageUnavailable, UploadRejected, verify_upload
from common.users import display_name

User = get_user_model()


class KeyOutdated(Conflict):
    """The conversation key the client used is not the newest one, or the
    newest one was not made for every participant's current key."""

    default_detail = 'The conversation key has changed. Refresh the keys and try again.'
    error_type = 'key_outdated'


class ChatNotSetUp(PermissionDenied):
    default_detail = 'Set up chat first.'
    error_type = 'chat_not_set_up'


# --- Accounts --------------------------------------------------------------

def _backup_fields(prefix: str, backup: dict) -> dict:
    fields = {
        f'{prefix}_box': backup['box'],
        f'{prefix}_nonce': backup['nonce'],
        f'{prefix}_salt': backup['salt'],
        f'{prefix}_ops': backup['ops'],
        f'{prefix}_mem': backup['mem'],
    }
    if 'inner_nonce' in backup:
        fields[f'{prefix}_inner_nonce'] = backup['inner_nonce']
    return fields


def require_account(user) -> ChatAccount:
    account = account_of(user)
    if account is None:
        raise ChatNotSetUp()
    return account


def set_up_account(user, *, public_key: str, pin: dict, recovery: dict) -> ChatAccount:
    if account_of(user) is not None:
        raise Conflict('Chat is already set up. Use "Start over" to replace your key.')
    try:
        with transaction.atomic():
            account = ChatAccount.objects.create(
                user=user,
                public_key=public_key,
                **_backup_fields('pin', pin),
                **_backup_fields('recovery', recovery),
            )
            _accept_invitations(user)
            return account
    except IntegrityError:
        raise Conflict('Chat is already set up.')


def _accept_invitations(user):
    """Setting up chat accepts every invitation the user had: each of those
    conversations gets an "accepted" note, and the inviter is told."""
    invited = Message.objects.filter(
        kind=Message.Kind.SYSTEM,
        system_event=Message.SystemEvent.INVITE_SENT,
        system_data__invitee_id=user.pk,
    ).values_list('conversation_id', flat=True)
    for conversation in Conversation.objects.select_for_update().filter(id__in=list(invited)):
        message = _append_message(
            conversation,
            sender=None,
            kind=Message.Kind.SYSTEM,
            system_event=Message.SystemEvent.INVITE_ACCEPTED,
            system_data={'user_id': user.pk, 'name': display_name(user)},
        )
        members = _member_ids(conversation)
        realtime.broadcast(
            members, 'message.new', {'conversation_id': str(conversation.id), 'message': message_payload(message, [])}
        )
        # Clients re-read the conversation to pick up the new member's key.
        realtime.broadcast(members, 'key.changed', {'conversation_id': str(conversation.id), 'user_id': user.pk})

    # Groups they were added to while pending: they join now, and the next
    # message (from anyone) makes a key that includes them.
    pending = Participant.objects.select_related('conversation').filter(user=user, pending=True, left_at__isnull=True)
    for participant in pending:
        conversation = Conversation.objects.select_for_update().get(pk=participant.conversation_id)
        Participant.objects.filter(pk=participant.pk).update(pending=False)
        message = _append_message(
            conversation,
            sender=None,
            kind=Message.Kind.SYSTEM,
            system_event=Message.SystemEvent.MEMBER_JOINED,
            system_data={'user_id': user.pk},
        )
        members = _member_ids(conversation)
        realtime.broadcast(members, 'message.new', {'conversation_id': str(conversation.id), 'message': message_payload(message, [])})
        realtime.broadcast(members, 'key.changed', {'conversation_id': str(conversation.id), 'user_id': user.pk})


def update_backups(account: ChatAccount, *, pin: dict | None, recovery: dict | None) -> ChatAccount:
    fields = {}
    if pin:
        fields.update(_backup_fields('pin', pin))
    if recovery:
        fields.update(_backup_fields('recovery', recovery))
    for name, value in fields.items():
        setattr(account, name, value)
    account.save(update_fields=[*fields, 'updated_at'])
    return account


# --- Reset codes -----------------------------------------------------------
# Starting over is confirmed with a code sent by email, so someone who only
# knows the portal password (or finds a signed-in computer) cannot wipe a
# person's chat key. Only a hash of the code is kept, in the cache.

RESET_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'  # no 0/O, 1/I/L
RESET_CODE_LENGTH = 8
RESET_CODE_TTL = 15 * 60
RESET_CODE_MAX_TRIES = 5
RESET_CODE_RESEND_SECONDS = 60


class ResetCodeInvalid(ValidationError):
    pass


class ResetCodeTooSoon(Conflict):
    default_detail = 'A code was sent less than a minute ago. Check your email, or wait a moment to send another.'
    error_type = 'reset_code_too_soon'


def _reset_code_key(user_id) -> str:
    return f'chat:reset-code:{user_id}'


def _hash_reset_code(code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode(), f'chat-reset|{code}'.encode(), hashlib.sha256).hexdigest()


def new_reset_code() -> str:
    """Eight characters, always a mix of letters and digits."""
    digits = [c for c in RESET_CODE_ALPHABET if c.isdigit()]
    letters = [c for c in RESET_CODE_ALPHABET if c.isalpha()]
    chars = [secrets.choice(digits), secrets.choice(letters)]
    chars += [secrets.choice(RESET_CODE_ALPHABET) for _ in range(RESET_CODE_LENGTH - 2)]
    secrets.SystemRandom().shuffle(chars)
    return ''.join(chars)


def normalise_reset_code(code: str) -> str:
    return ''.join(ch for ch in str(code).upper() if ch.isalnum())


def send_reset_code(user) -> int:
    """Email a fresh reset code (replacing any earlier one). Returns its lifetime in seconds."""
    from emails.services.chat_emails import send_chat_reset_code_email

    require_account(user)
    if not cache.add(f'chat:reset-code-sent:{user.pk}', 1, RESET_CODE_RESEND_SECONDS):
        raise ResetCodeTooSoon()
    code = new_reset_code()
    cache.set(
        _reset_code_key(user.pk),
        {'hash': _hash_reset_code(code), 'tries': 0, 'expires': time.time() + RESET_CODE_TTL},
        RESET_CODE_TTL,
    )
    transaction.on_commit(lambda: send_chat_reset_code_email(user, code, RESET_CODE_TTL // 60))
    return RESET_CODE_TTL


def check_reset_code(user, code: str, *, use: bool = False) -> None:
    """Raises ResetCodeInvalid unless the code is right. Wrong tries are
    counted; after five the code is cancelled. `use` cancels it on success."""
    key = _reset_code_key(user.pk)
    entry = cache.get(key)
    if not entry:
        raise ResetCodeInvalid({'code': ['This code has expired. Send a new one.']})
    if not hmac.compare_digest(entry['hash'], _hash_reset_code(normalise_reset_code(code))):
        entry['tries'] += 1
        left = RESET_CODE_MAX_TRIES - entry['tries']
        if left <= 0:
            cache.delete(key)
            raise ResetCodeInvalid({'code': ['Too many wrong tries. Send a new code.']})
        cache.set(key, entry, max(1, int(entry['expires'] - time.time())))
        raise ResetCodeInvalid({'code': [f'That code is not right. {left} {"try" if left == 1 else "tries"} left.']})
    if use:
        cache.delete(key)


@transaction.atomic
def reset_account(user, *, public_key: str, pin: dict, recovery: dict) -> ChatAccount:
    """Replace the user's key pair. Their earlier messages become unreadable to
    them; everyone they chat with is told, and the next message from either
    side makes a new conversation key."""
    account = ChatAccount.objects.select_for_update().filter(user=user).first()
    if account is None:
        raise ChatNotSetUp()
    account.key_id = uuid.uuid4()
    account.public_key = public_key
    for name, value in {**_backup_fields('pin', pin), **_backup_fields('recovery', recovery)}.items():
        setattr(account, name, value)
    account.save()

    conversation_ids = list(
        Participant.objects.filter(user=user, left_at__isnull=True).values_list('conversation_id', flat=True)
    )
    for conversation in Conversation.objects.select_for_update().filter(id__in=conversation_ids):
        message = _append_message(
            conversation,
            sender=None,
            kind=Message.Kind.SYSTEM,
            system_event=Message.SystemEvent.KEY_RESET,
            system_data={'user_id': user.id, 'name': display_name(user)},
        )
        members = _member_ids(conversation)
        realtime.broadcast(members, 'message.new', {'conversation_id': str(conversation.id), 'message': message_payload(message, [])})
        realtime.broadcast(members, 'key.changed', {'conversation_id': str(conversation.id), 'user_id': user.id})
    return account


# --- People ----------------------------------------------------------------

def people(user, search: str = ''):
    queryset = (
        User.objects.filter(is_active=True)
        .exclude(pk=user.pk)
        .select_related('chat_account', 'staff_profile__department')
        .order_by('first_name', 'last_name', 'username')
    )
    if search:
        terms = [t for t in search.split() if t][:4]
        for term in terms:
            queryset = queryset.filter(
                Q(first_name__icontains=term) | Q(last_name__icontains=term) | Q(email__icontains=term)
            )
    rows = list(queryset[:50])
    online = realtime.online_user_ids([u.id for u in rows])
    return [person_payload(u, online=u.id in online) for u in rows]


def invite(user, target_id: int) -> Conversation:
    """Invite someone who has not set up chat. Opens (or reuses) the direct
    conversation with an "invitation sent" note, and tells them in the portal
    and by email. Nobody can send messages there until they set up chat.

    Inviting again is a reminder: allowed once per pair per 24 hours."""
    from django.core.cache import cache

    from emails.services.chat_emails import send_chat_invitation_email
    from notifications.models import Notification
    from notifications.services import create_notification

    require_account(user)
    target = User.objects.filter(pk=target_id, is_active=True).first()
    if target is None or target.pk == user.pk:
        raise NotFound('Person not found.')
    if account_of(target) is not None:
        raise Conflict(f'{display_name(target)} has already set up chat.')

    low, high = sorted([user.pk, target.pk])
    with transaction.atomic():
        conversation, created = Conversation.objects.select_for_update().get_or_create(
            direct_key=f'{low}:{high}', defaults={'kind': Conversation.Kind.DIRECT, 'created_by': user}
        )
        if created:
            Participant.objects.bulk_create(
                [Participant(conversation=conversation, user_id=uid) for uid in (user.pk, target.pk)]
            )
        already_invited = Message.objects.filter(
            conversation=conversation,
            system_event=Message.SystemEvent.INVITE_SENT,
            system_data__inviter_id=user.pk,
        ).exists()
        if already_invited and not cache.add(f'chat:nudge:{user.pk}:{target.pk}', 1, 24 * 60 * 60):
            raise Conflict(f'You have already reminded {display_name(target)} today.')
        if not already_invited:
            cache.set(f'chat:nudge:{user.pk}:{target.pk}', 1, 24 * 60 * 60)
            message = _append_message(
                conversation,
                sender=None,
                kind=Message.Kind.SYSTEM,
                system_event=Message.SystemEvent.INVITE_SENT,
                system_data={
                    'inviter_id': user.pk,
                    'inviter_name': display_name(user),
                    'invitee_id': target.pk,
                    'invitee_name': display_name(target),
                },
            )
            realtime.broadcast(
                [user.pk], 'message.new', {'conversation_id': str(conversation.id), 'message': message_payload(message, [])}
            )

        create_notification(
            target,
            actor=user,
            notification_type=Notification.TYPE_CHAT_NUDGE,
            title=f'{display_name(user)} wants to chat with you',
            body='Set up chat to reply.',
            link_url='/chat',
        )
        inviter_name = display_name(user)
        transaction.on_commit(lambda: send_chat_invitation_email(target, inviter_name))
    return conversation


# --- Conversations ---------------------------------------------------------

def _member_ids(conversation) -> list[int]:
    return list(
        Participant.objects.filter(conversation=conversation, left_at__isnull=True).values_list('user_id', flat=True)
    )


def _keyed_member_ids(conversation) -> list[int]:
    """Members the conversation key must be locked for: current, and not
    pending (a pending member has no chat key yet)."""
    return list(
        Participant.objects.filter(conversation=conversation, left_at__isnull=True, pending=False).values_list(
            'user_id', flat=True
        )
    )


def get_membership(user, conversation_id) -> Participant:
    participant = (
        Participant.objects.select_related('conversation')
        .filter(conversation_id=conversation_id, user=user, left_at__isnull=True)
        .first()
    )
    if participant is None:
        raise NotFound('Conversation not found.')
    return participant


def _latest_version(conversation) -> int:
    return ConversationKey.objects.filter(conversation=conversation).aggregate(v=Max('version'))['v'] or 0


def _check_wrapped_keys(keys: list[dict], members: dict[int, ChatAccount]):
    """Every current member gets exactly one wrapped key, made for their
    current public key."""
    by_recipient = {}
    for item in keys:
        if item['recipient_id'] in by_recipient:
            raise ValidationError({'keys': ['One key per person.']})
        by_recipient[item['recipient_id']] = item
    if set(by_recipient) != set(members):
        raise KeyOutdated('The keys must cover exactly the people in the conversation.')
    for user_id, account in members.items():
        if str(by_recipient[user_id]['recipient_key_id']) != str(account.key_id):
            raise KeyOutdated()
    return by_recipient


def _store_keys(conversation, version: int, wrapper, wrapper_account, by_recipient: dict, members: dict):
    ConversationKey.objects.bulk_create(
        [
            ConversationKey(
                conversation=conversation,
                version=version,
                recipient_id=user_id,
                recipient_key_id=members[user_id].key_id,
                wrapped_by=wrapper,
                wrapper_public_key=wrapper_account.public_key,
                wrapped_key=item['wrapped_key'],
                nonce=item['nonce'],
            )
            for user_id, item in by_recipient.items()
        ]
    )


def start_direct(user, *, other_id: int, keys: list[dict]):
    """Open the chat between two people, or return the one that exists
    (`created` False; the client then uses the existing keys)."""
    account = require_account(user)
    other = User.objects.filter(pk=other_id, is_active=True).first()
    if other is None or other.pk == user.pk:
        raise NotFound('Person not found.')
    other_account = account_of(other)
    if other_account is None:
        raise ValidationError({'user_id': [f'{display_name(other)} has not set up chat yet.']})

    low, high = sorted([user.pk, other.pk])
    direct_key = f'{low}:{high}'
    existing = Conversation.objects.filter(direct_key=direct_key).first()
    if existing is not None:
        return existing, False

    members = {user.pk: account, other.pk: other_account}
    by_recipient = _check_wrapped_keys(keys, members)
    try:
        with transaction.atomic():
            conversation = Conversation.objects.create(
                kind=Conversation.Kind.DIRECT, direct_key=direct_key, created_by=user
            )
            Participant.objects.bulk_create(
                [Participant(conversation=conversation, user_id=uid) for uid in (user.pk, other.pk)]
            )
            _store_keys(conversation, 1, user, account, by_recipient, members)
    except IntegrityError:
        # The other person opened it at the same moment.
        return Conversation.objects.get(direct_key=direct_key), False

    realtime.broadcast([other.pk], 'conversation.new', {'conversation_id': str(conversation.id)})
    return conversation, True


def add_key_version(user, conversation_id, *, version: int, keys: list[dict], info: dict | None = None) -> int:
    """A new conversation key for everyone currently in it. For a group, the
    browser also sends the group details re-encrypted with the new key, so
    anyone added later can read them."""
    account = require_account(user)
    with transaction.atomic():
        participant = get_membership(user, conversation_id)
        conversation = Conversation.objects.select_for_update().get(pk=participant.conversation_id)
        latest = _latest_version(conversation)
        if version != latest + 1:
            raise Conflict(f'The next key version is {latest + 1}.')
        member_ids = _keyed_member_ids(conversation)
        accounts = {a.user_id: a for a in ChatAccount.objects.filter(user_id__in=member_ids)}
        if set(accounts) != set(member_ids):
            raise ValidationError({'keys': ['Someone in this conversation has no chat key.']})
        by_recipient = _check_wrapped_keys(keys, accounts)
        _store_keys(conversation, version, user, account, by_recipient, accounts)
        if info and conversation.kind == Conversation.Kind.GROUP:
            _set_info(conversation, info, version=version)
    realtime.broadcast(
        _member_ids(conversation), 'key.changed', {'conversation_id': str(conversation.id), 'version': version}
    )
    return version


def my_keys(user, conversation_id):
    participant = get_membership(user, conversation_id)
    return ConversationKey.objects.filter(conversation_id=participant.conversation_id, recipient=user).order_by('version')


def _visible_messages(user, conversation_id):
    return Message.objects.filter(conversation_id=conversation_id).exclude(hidden_for__user=user)


CONVERSATION_PAGE_SIZE = 30


def conversation_cursor(activity, conversation_id) -> str:
    """Where the next page starts: the last row's activity time and id."""
    return f'{activity.isoformat()}|{conversation_id}'


def _parse_conversation_cursor(cursor: str):
    try:
        stamp, _, conversation_id = cursor.partition('|')
        # A "+" in the time zone can arrive as a space if the URL was not encoded.
        activity = datetime.fromisoformat(stamp.replace(' ', '+'))
        return activity, uuid.UUID(conversation_id)
    except (TypeError, ValueError):
        raise ValidationError({'before': ['Not a valid position in the list.']})


def list_conversations(user, *, before: str | None = None, limit: int = CONVERSATION_PAGE_SIZE):
    """The user's conversations, most recent activity first, one page at a
    time. Returns (payloads, next_cursor); next_cursor is None on the last page.

    Activity is the last message's time, or the creation time for a chat with
    no messages yet. Ties are broken by id, so pages never overlap or skip."""
    queryset = (
        Participant.objects.filter(user=user, left_at__isnull=True)
        .select_related('conversation')
        # A hidden chat comes back once a message newer than the hiding arrives.
        .filter(Q(hidden_at_seq__isnull=True) | Q(conversation__next_seq__gt=F('hidden_at_seq') + 1))
        .annotate(activity=Coalesce('conversation__last_message_at', 'conversation__created_at'))
        .order_by('-activity', '-conversation_id')
    )
    if before:
        activity, conversation_id = _parse_conversation_cursor(before)
        queryset = queryset.filter(
            Q(activity__lt=activity) | Q(activity=activity, conversation_id__lt=conversation_id)
        )
    rows = list(queryset[: limit + 1])
    page = rows[:limit]
    next_cursor = (
        conversation_cursor(page[-1].activity, page[-1].conversation_id) if len(rows) > limit and page else None
    )
    return [conversation_payload(user, p) for p in page], next_cursor


def conversation_payload(user, participant: Participant) -> dict:
    conversation = participant.conversation
    members = list(
        Participant.objects.filter(conversation=conversation)
        .select_related('user__chat_account', 'user__staff_profile__department')
        .order_by('joined_at')
    )
    online = realtime.online_user_ids([m.user_id for m in members if m.user_id != user.pk])
    visible = _visible_messages(user, conversation.id)
    last = visible.order_by('-seq').prefetch_related('attachments').first()
    unread = (
        visible.filter(seq__gt=participant.last_read_seq)
        .exclude(sender=user)
        .exclude(kind=Message.Kind.SYSTEM)
        .filter(deleted_at__isnull=True)
        .count()
    )
    latest_version = _latest_version(conversation)
    return {
        'id': str(conversation.id),
        'kind': conversation.kind,
        'created_at': conversation.created_at,
        'last_message_at': conversation.last_message_at,
        'latest_key_version': latest_version,
        'unread_count': unread,
        'last_message': message_payload(last) if last else None,
        'last_reaction': _last_reaction(user, conversation.id),
        'muted_until': participant.muted_until,
        'archived': participant.archived,
        # Hidden from your list until a newer message arrives (still openable directly).
        'hidden': participant.hidden_at_seq is not None and conversation.next_seq - 1 <= participant.hidden_at_seq,
        'last_read_seq': participant.last_read_seq,
        'role': participant.role,
        # Groups: encrypted name, description and photo key (null for direct chats).
        'info': (
            {
                'key_version': conversation.info_key_version,
                'nonce': conversation.info_nonce,
                'ciphertext': conversation.info_ciphertext,
            }
            if conversation.kind == Conversation.Kind.GROUP and conversation.info_ciphertext
            else None
        ),
        'has_photo': bool(conversation.photo_object_key),
        'created_by_id': conversation.created_by_id,
        'participants': [
            {
                **person_payload(m.user, online=(m.user_id in online) if m.user_id != user.pk else None),
                'last_read_seq': m.last_read_seq,
                'left': m.left_at is not None,
                'role': m.role,
                'pending': m.pending,
                'joined_at': m.joined_at,
            }
            for m in members
        ],
    }


def _last_reaction(user, conversation_id):
    """The newest reaction in the conversation with the message it is on, for
    the list preview ("Ada reacted ❤ to …"). The browser shows it only when it
    is newer than the last message."""
    reaction = (
        MessageReaction.objects.filter(
            message__conversation_id=conversation_id, message__deleted_at__isnull=True
        )
        .exclude(message__hidden_for__user=user)
        .select_related('message')
        .order_by('-updated_at')
        .first()
    )
    if reaction is None:
        return None
    return {**reaction_payload(reaction), 'message': message_payload(reaction.message)}


def total_unread(user) -> int:
    """Unread messages across the user's conversations (the sidebar badge).
    Muted chats do not count: muting means "do not nag me about this one"."""
    last_read = Participant.objects.filter(
        conversation=OuterRef('conversation_id'), user=user, left_at__isnull=True
    ).values('last_read_seq')[:1]
    muted = Participant.objects.filter(user=user, muted_until__gt=timezone.now()).values('conversation_id')
    return (
        Message.objects.filter(
            conversation__participants__user=user,
            conversation__participants__left_at__isnull=True,
            deleted_at__isnull=True,
        )
        .exclude(conversation_id__in=muted)
        .exclude(sender=user)
        .exclude(kind=Message.Kind.SYSTEM)
        .exclude(hidden_for__user=user)
        .annotate(read_upto=Subquery(last_read))
        .filter(seq__gt=F('read_upto'))
        .count()
    )


def update_settings(user, conversation_id, *, data: dict) -> Participant:
    """Mute, archive or hide a chat, for this person only."""
    participant = get_membership(user, conversation_id)
    fields = []
    for name in ('muted_until', 'archived'):
        if name in data:
            setattr(participant, name, data[name])
            fields.append(name)
    if 'hidden' in data:
        participant.hidden_at_seq = (participant.conversation.next_seq - 1) if data['hidden'] else None
        fields.append('hidden_at_seq')
    if fields:
        participant.save(update_fields=fields)
        # Your other open tabs follow.
        realtime.broadcast([user.pk], 'conversation.updated', {'conversation_id': str(participant.conversation_id)})
    return participant


# --- Messages --------------------------------------------------------------

def _append_message(conversation, *, sender, kind, **fields) -> Message:
    """Add a message at the end. The caller holds a row lock on the conversation."""
    seq = conversation.next_seq
    now = timezone.now()
    message = Message.objects.create(
        id=fields.pop('id', None) or uuid.uuid4(),
        conversation=conversation,
        sender=sender,
        seq=seq,
        kind=kind,
        **fields,
    )
    conversation.next_seq = seq + 1
    conversation.last_message_at = now
    conversation.save(update_fields=['next_seq', 'last_message_at'])
    return message


def list_messages(user, conversation_id, *, before_seq=None, after_seq=None, limit=50):
    participant = get_membership(user, conversation_id)
    queryset = _visible_messages(user, participant.conversation_id).prefetch_related('attachments', 'reactions')
    if after_seq is not None:
        rows = list(queryset.filter(seq__gt=after_seq).order_by('seq')[:limit])
        return rows, len(rows) == limit
    if before_seq is not None:
        queryset = queryset.filter(seq__lt=before_seq)
    rows = list(queryset.order_by('-seq')[: limit + 1])
    has_more = len(rows) > limit
    return list(reversed(rows[:limit])), has_more


def _attachments_for_send(user, conversation, attachment_ids) -> list[MessageAttachment]:
    if not attachment_ids:
        return []
    items = list(
        MessageAttachment.objects.select_for_update().filter(
            id__in=attachment_ids, conversation=conversation, uploaded_by=user, message__isnull=True
        )
    )
    if len(items) != len(attachment_ids):
        raise ValidationError({'attachment_ids': ['A file was not found or was already sent.']})
    limit = settings.CHAT_ATTACHMENT_MAX_SIZE + settings.CHAT_ATTACHMENT_ENCRYPTION_OVERHEAD
    for item in items:
        try:
            size, _ = verify_upload(
                item.file_key, max_size=limit, allowed_types=None, claimed_size=item.encrypted_size
            )
            item.encrypted_size = size
            if item.thumb_key:
                thumb, _ = verify_upload(
                    item.thumb_key,
                    max_size=settings.CHAT_THUMBNAIL_MAX_SIZE,
                    allowed_types=None,
                    claimed_size=item.thumb_size,
                )
                item.thumb_size = thumb
        except UploadRejected as exc:
            raise ValidationError({'attachment_ids': [str(exc)]})
        except StorageUnavailable as exc:
            raise ServiceUnavailable(str(exc))
    return items


def send_message(user, conversation_id, *, data: dict) -> tuple[Message, bool]:
    """Store an encrypted message and deliver it. Returns (message, created);
    resending the same id returns the stored message."""
    require_account(user)
    message_id = data['id']
    existing = Message.objects.filter(pk=message_id).first()
    if existing is not None:
        if existing.sender_id == user.pk and str(existing.conversation_id) == str(conversation_id):
            return existing, False
        raise Conflict('A message with this id already exists.')

    with transaction.atomic():
        participant = get_membership(user, conversation_id)
        conversation = Conversation.objects.select_for_update().get(pk=participant.conversation_id)

        member_ids = _member_ids(conversation)
        others = list(User.objects.filter(pk__in=member_ids).exclude(pk=user.pk))
        if conversation.kind == Conversation.Kind.DIRECT and not any(o.is_active for o in others):
            raise PermissionDenied('This person no longer has access to the portal.')

        if conversation.kind == Conversation.Kind.DIRECT:
            not_ready = [o for o in others if not ChatAccount.objects.filter(user=o).exists()]
            if not_ready:
                raise PermissionDenied(f'{display_name(not_ready[0])} has not set up chat yet.')
        # Pending group members have no key yet; everyone else must be covered.
        keyed_ids = _keyed_member_ids(conversation)

        latest = _latest_version(conversation)
        if data['key_version'] != latest:
            raise KeyOutdated()
        current = {
            row.recipient_id: row.recipient_key_id
            for row in ConversationKey.objects.filter(conversation=conversation, version=latest)
        }
        accounts = {a.user_id: a.key_id for a in ChatAccount.objects.filter(user_id__in=keyed_ids)}
        if set(current) != set(keyed_ids) or any(current.get(uid) != accounts.get(uid) for uid in keyed_ids):
            raise KeyOutdated()

        attachments = _attachments_for_send(user, conversation, data.get('attachment_ids'))
        message = _append_message(
            conversation,
            sender=user,
            id=message_id,
            kind=data['kind'],
            key_version=data['key_version'],
            nonce=data['nonce'],
            ciphertext=data['ciphertext'],
        )
        for item in attachments:
            item.message = message
        if attachments:
            MessageAttachment.objects.bulk_update(attachments, ['message', 'encrypted_size', 'thumb_size'])

        # Sending moves the sender's own read position to their message.
        Participant.objects.filter(pk=participant.pk).update(last_read_seq=message.seq)

        payload = message_payload(message, attachments)
        realtime.broadcast(member_ids, 'message.new', {'conversation_id': str(conversation.id), 'message': payload})
        realtime.broadcast(
            member_ids,
            'read.updated',
            {'conversation_id': str(conversation.id), 'user_id': user.pk, 'last_read_seq': message.seq},
        )
        transaction.on_commit(
            lambda: _push_to_offline(conversation, user, [o.pk for o in others if o.is_active], message)
        )
    return message, True


# Web push payloads are limited to about 4 KB; larger messages are fetched by
# the browser's service worker instead of travelling in the push.
PUSH_PREVIEW_MAX_CIPHERTEXT = 2400


def _push_to_offline(conversation, sender, recipient_ids, message=None):
    """Push to every other member, like other portal notifications (open
    portal tabs or not). The push carries the message still encrypted: the recipient's service worker decrypts it with the key
    unlocked in that browser to show a preview (or shows the plain fallback
    title and body when it cannot). The server never sends readable text."""
    from chat.tasks import queue_message_push

    conversation_id = conversation.id
    now = timezone.now()
    muted = set(
        Participant.objects.filter(conversation_id=conversation_id, user_id__in=recipient_ids, muted_until__gt=now)
        .values_list('user_id', flat=True)
    )
    pending = set(
        Participant.objects.filter(conversation_id=conversation_id, user_id__in=recipient_ids, pending=True)
        .values_list('user_id', flat=True)
    )
    is_group = conversation.kind == Conversation.Kind.GROUP
    preview = None
    if message is not None:
        preview = {
            'conversation_id': str(conversation_id),
            'message_id': str(message.id),
            'seq': message.seq,
            'conversation_kind': conversation.kind,
            'sender_id': sender.pk,
            'kind': message.kind,
            'key_version': message.key_version,
            'revision': message.revision,
        }
        if message.ciphertext and len(message.ciphertext) <= PUSH_PREVIEW_MAX_CIPHERTEXT:
            preview['nonce'] = message.nonce
            preview['ciphertext'] = message.ciphertext
    for user_id in recipient_ids:
        if user_id in muted or user_id in pending:
            continue
        queue_message_push(
            user_id,
            {
                'title': display_name(sender),
                'body': 'New message in a group' if is_group else 'New message',
                'url': f'/chat/{conversation_id}',
                'type': 'chat_message',
                'tag': f'chat-{conversation_id}',
                **({'chat': preview} if preview else {}),
            },
        )


def _own_recent_message(user, message_id, *, action: str) -> Message:
    message = (
        Message.objects.select_for_update(of=('self',))
        .filter(pk=message_id, conversation__participants__user=user, conversation__participants__left_at__isnull=True)
        .first()
    )
    if message is None:
        raise NotFound('Message not found.')
    if message.sender_id != user.pk or message.kind == Message.Kind.SYSTEM:
        raise PermissionDenied(f'You can only {action} your own messages.')
    if message.deleted_at is not None:
        raise Conflict('This message was deleted.')
    window = timedelta(minutes=settings.CHAT_EDIT_WINDOW_MINUTES)
    if timezone.now() - message.created_at > window:
        raise PermissionDenied(
            f'Messages can only be {action}ed within {settings.CHAT_EDIT_WINDOW_MINUTES} minutes of sending.'
            if action == 'edit'
            else f'Messages can only be deleted for everyone within {settings.CHAT_EDIT_WINDOW_MINUTES} minutes of sending.'
        )
    return message


@transaction.atomic
def edit_message(user, message_id, *, data: dict) -> Message:
    message = _own_recent_message(user, message_id, action='edit')
    if data['revision'] != message.revision + 1:
        raise Conflict('This message was changed elsewhere. Reload it and try again.')
    message.nonce = data['nonce']
    message.ciphertext = data['ciphertext']
    message.revision = data['revision']
    message.edited_at = timezone.now()
    message.save(update_fields=['nonce', 'ciphertext', 'revision', 'edited_at'])
    realtime.broadcast(
        _member_ids(message.conversation),
        'message.edited',
        {
            'conversation_id': str(message.conversation_id),
            'message_id': str(message.id),
            'revision': message.revision,
            'nonce': message.nonce,
            'ciphertext': message.ciphertext,
            'edited_at': message.edited_at.isoformat(),
        },
    )
    return message


@transaction.atomic
def delete_for_everyone(user, message_id) -> Message:
    message = _own_recent_message(user, message_id, action='delete')
    keys = []
    for item in MessageAttachment.objects.filter(message=message):
        keys.extend([k for k in (item.file_key, item.thumb_key) if k])
    MessageAttachment.objects.filter(message=message).delete()
    MessageReaction.objects.filter(message=message).delete()
    message.ciphertext = None
    message.nonce = None
    message.deleted_at = timezone.now()
    message.save(update_fields=['ciphertext', 'nonce', 'deleted_at'])
    if keys:
        from chat.tasks import queue_object_deletion

        transaction.on_commit(lambda: queue_object_deletion(keys))
    realtime.broadcast(
        _member_ids(message.conversation),
        'message.deleted',
        {'conversation_id': str(message.conversation_id), 'message_id': str(message.id)},
    )
    return message


def hide_for_me(user, message_id) -> None:
    message = Message.objects.filter(
        pk=message_id, conversation__participants__user=user, conversation__participants__left_at__isnull=True
    ).first()
    if message is None:
        raise NotFound('Message not found.')
    HiddenMessage.objects.get_or_create(user=user, message=message)
    realtime.broadcast(
        [user.pk], 'message.hidden', {'conversation_id': str(message.conversation_id), 'message_id': str(message.id)}
    )


def mark_read(user, conversation_id, *, seq: int) -> int:
    participant = get_membership(user, conversation_id)
    newest = participant.conversation.next_seq - 1
    seq = min(seq, newest)
    updated = Participant.objects.filter(pk=participant.pk, last_read_seq__lt=seq).update(last_read_seq=seq)
    if updated:
        realtime.broadcast(
            _member_ids(participant.conversation),
            'read.updated',
            {'conversation_id': str(participant.conversation_id), 'user_id': user.pk, 'last_read_seq': seq},
        )
        return seq
    return max(seq, Participant.objects.get(pk=participant.pk).last_read_seq)


# --- Attachments -----------------------------------------------------------

def reserve_attachment(user, conversation_id, *, size: int, thumb_size: int | None) -> dict:
    require_account(user)
    participant = get_membership(user, conversation_id)
    attachment = MessageAttachment(
        conversation_id=participant.conversation_id,
        uploaded_by=user,
        encrypted_size=size,
        thumb_size=thumb_size,
    )
    attachment.file_key = chat_storage.file_key(participant.conversation_id, attachment.id)
    if thumb_size:
        attachment.thumb_key = chat_storage.thumb_key(participant.conversation_id, attachment.id)
    try:
        upload = chat_storage.upload_url(attachment.file_key)
        thumb_upload = chat_storage.upload_url(attachment.thumb_key) if attachment.thumb_key else None
    except chat_storage.ChatStorageError as exc:
        raise ServiceUnavailable(str(exc))
    attachment.save()
    return {
        'id': str(attachment.id),
        'upload_url': upload,
        'thumb_upload_url': thumb_upload,
        'content_type': chat_storage.CONTENT_TYPE,
        'expires_in': settings.CHAT_UPLOAD_URL_EXPIRES_IN,
    }


def forward_attachment(user, conversation_id, *, source_id) -> dict:
    """Copy a file the user can see into another of their chats, for
    forwarding. The encrypted bytes are duplicated in storage; the file's key
    travels inside the forwarded (encrypted) message, never to the server.
    The copy is reserved like a fresh upload and is independent of the
    original (deleting one leaves the other)."""
    require_account(user)
    target = get_membership(user, conversation_id)
    source = (
        MessageAttachment.objects.filter(
            pk=source_id,
            message__isnull=False,
            message__deleted_at__isnull=True,
            conversation__participants__user=user,
            conversation__participants__left_at__isnull=True,
        )
        .exclude(message__hidden_for__user=user)
        .first()
    )
    if source is None:
        raise NotFound('File not found.')
    copy = MessageAttachment(
        conversation_id=target.conversation_id,
        uploaded_by=user,
        encrypted_size=source.encrypted_size,
        thumb_size=source.thumb_size if source.thumb_key else None,
    )
    copy.file_key = chat_storage.file_key(target.conversation_id, copy.id)
    if source.thumb_key:
        copy.thumb_key = chat_storage.thumb_key(target.conversation_id, copy.id)
    try:
        chat_storage.copy_object(source.file_key, copy.file_key)
        if source.thumb_key:
            chat_storage.copy_object(source.thumb_key, copy.thumb_key)
    except chat_storage.ChatStorageError as exc:
        raise ServiceUnavailable(str(exc))
    copy.save()
    return {'id': str(copy.id)}


def attachment_download(user, attachment_id, *, part: str) -> str:
    attachment = (
        MessageAttachment.objects.select_related('message')
        .filter(
            pk=attachment_id,
            message__isnull=False,
            message__deleted_at__isnull=True,
            conversation__participants__user=user,
            conversation__participants__left_at__isnull=True,
        )
        .first()
    )
    if attachment is None:
        raise NotFound('File not found.')
    key = attachment.thumb_key if part == 'thumb' else attachment.file_key
    if not key:
        raise NotFound('This file has no preview.')
    try:
        return chat_storage.download_url(key)
    except chat_storage.ChatStorageError as exc:
        raise ServiceUnavailable(str(exc))


# --- Reactions -------------------------------------------------------------

def _reactable_message(user, message_id) -> Message:
    message = (
        Message.objects.select_related('conversation')
        .filter(pk=message_id, conversation__participants__user=user, conversation__participants__left_at__isnull=True)
        .first()
    )
    if message is None:
        raise NotFound('Message not found.')
    if message.kind == Message.Kind.SYSTEM:
        raise ValidationError({'message': ['You cannot react to this.']})
    if message.deleted_at is not None:
        raise Conflict('This message was deleted.')
    return message


def set_reaction(user, message_id, *, data: dict) -> MessageReaction:
    """Add or replace the user's reaction (one per person per message)."""
    require_account(user)
    message = _reactable_message(user, message_id)
    if data['key_version'] != _latest_version(message.conversation):
        raise KeyOutdated()
    reaction, _ = MessageReaction.objects.update_or_create(
        message=message,
        user=user,
        defaults={'key_version': data['key_version'], 'nonce': data['nonce'], 'ciphertext': data['ciphertext']},
    )
    realtime.broadcast(
        _member_ids(message.conversation),
        'reaction.updated',
        {
            'conversation_id': str(message.conversation_id),
            'message_id': str(message.id),
            'reaction': reaction_payload(reaction),
            'message': message_payload(message),
        },
    )
    return reaction


def remove_reaction(user, message_id) -> None:
    message = _reactable_message(user, message_id)
    deleted, _ = MessageReaction.objects.filter(message=message, user=user).delete()
    if deleted:
        realtime.broadcast(
            _member_ids(message.conversation),
            'reaction.updated',
            {
                'conversation_id': str(message.conversation_id),
                'message_id': str(message.id),
                'removed_user_id': user.pk,
            },
        )


# --- Groups ----------------------------------------------------------------

MAX_GROUP_MEMBERS = 100


def _set_info(conversation, info: dict, *, version: int | None = None) -> None:
    """Store the encrypted group details. They must use the newest key version,
    so every current member (and anyone added later) can open them."""
    key_version = info['key_version']
    if key_version != (version if version is not None else _latest_version(conversation)):
        raise KeyOutdated('The group details must use the newest key.')
    conversation.info_key_version = key_version
    conversation.info_nonce = info['nonce']
    conversation.info_ciphertext = info['ciphertext']
    conversation.save(update_fields=['info_key_version', 'info_nonce', 'info_ciphertext'])


MANAGERS = (Participant.Role.ADMIN, Participant.Role.OWNER)


def _group_membership(user, conversation_id, *, admin: bool = False, owner: bool = False):
    """(participant, conversation) for a group the user is in. `admin`: admins
    and the owner only. `owner`: the owner only."""
    participant = get_membership(user, conversation_id)
    conversation = Conversation.objects.select_for_update().get(pk=participant.conversation_id)
    if conversation.kind != Conversation.Kind.GROUP:
        raise ValidationError({'conversation': ['This is not a group.']})
    if owner and participant.role != Participant.Role.OWNER:
        raise PermissionDenied('Only the group owner can do that.')
    if admin and participant.role not in MANAGERS:
        raise PermissionDenied('Only group admins can do that.')
    return participant, conversation


def _system_note(conversation, event, data: dict) -> Message:
    message = _append_message(conversation, sender=None, kind=Message.Kind.SYSTEM, system_event=event, system_data=data)
    realtime.broadcast(
        _member_ids(conversation),
        'message.new',
        {'conversation_id': str(conversation.id), 'message': message_payload(message, [])},
    )
    return message


def _people_to_add(user, ids, *, existing: set[int]) -> tuple[list, list]:
    """(ready, pending) people for a group: active staff, not already in it."""
    wanted = {int(i) for i in ids} - {user.pk} - existing
    people = list(User.objects.filter(pk__in=wanted, is_active=True).select_related('chat_account'))
    if len(people) != len(wanted):
        raise ValidationError({'member_ids': ['Someone was not found.']})
    ready = [p for p in people if account_of(p) is not None]
    pending = [p for p in people if account_of(p) is None]
    return ready, pending


def _invite_pending(user, conversation, people) -> None:
    """Pending members get the same notice and email as a chat invitation."""
    from emails.services.chat_emails import send_chat_invitation_email
    from notifications.models import Notification
    from notifications.services import create_notification

    inviter_name = display_name(user)
    for person in people:
        create_notification(
            person,
            actor=user,
            notification_type=Notification.TYPE_CHAT_NUDGE,
            title=f'{inviter_name} added you to a group chat',
            body='Set up chat to join.',
            link_url='/chat',
        )
        transaction.on_commit(lambda person=person: send_chat_invitation_email(person, inviter_name))


def create_group(user, *, id, member_ids: list[int], keys: list[dict], info: dict) -> Conversation:
    """A new group with the creator as admin. Keys cover the creator and every
    member who has set up chat; the others join as pending."""
    account = require_account(user)
    ready, pending = _people_to_add(user, member_ids, existing=set())
    if not ready and not pending:
        raise ValidationError({'member_ids': ['Add at least one person.']})
    if len(ready) + len(pending) + 1 > MAX_GROUP_MEMBERS:
        raise ValidationError({'member_ids': [f'A group can have up to {MAX_GROUP_MEMBERS} people.']})
    if info['key_version'] != 1:
        raise ValidationError({'info': ['A new group starts with key version 1.']})
    members = {user.pk: account, **{p.pk: account_of(p) for p in ready}}
    by_recipient = _check_wrapped_keys(keys, members)
    if Conversation.objects.filter(pk=id).exists():
        raise Conflict('A conversation with this id already exists.')
    with transaction.atomic():
        conversation = Conversation.objects.create(id=id, kind=Conversation.Kind.GROUP, created_by=user)
        Participant.objects.bulk_create(
            [Participant(conversation=conversation, user=user, role=Participant.Role.OWNER)]
            + [Participant(conversation=conversation, user=p) for p in ready]
            + [Participant(conversation=conversation, user=p, pending=True) for p in pending]
        )
        _store_keys(conversation, 1, user, account, by_recipient, members)
        _set_info(conversation, info, version=1)
        conversation = Conversation.objects.select_for_update().get(pk=conversation.pk)
        _system_note(conversation, Message.SystemEvent.GROUP_CREATED, {'user_id': user.pk})
        _invite_pending(user, conversation, pending)
        realtime.broadcast(
            [p.pk for p in ready + pending], 'conversation.new', {'conversation_id': str(conversation.id)}
        )
    return conversation


def update_group_info(user, conversation_id, *, info: dict, changed: list[str], photo_object_key=...) -> Conversation:
    """Admins change the name, description or photo. `photo_object_key`: the
    newly uploaded photo, None to remove it, or left out to keep it.

    With nothing `changed`, any member may re-lock the same details with the
    newest key: after someone who could not read them (a member who just
    joined) made that key, so new members can read the name and photo. That
    posts no note. The server cannot check the content is unchanged (it is
    encrypted); a member who abused this would only be renaming the group."""
    relock = not changed and photo_object_key is ...
    with transaction.atomic():
        _participant, conversation = _group_membership(user, conversation_id, admin=not relock)
        if relock and conversation.info_key_version == _latest_version(conversation):
            return conversation  # already current
        _set_info(conversation, info)
        if photo_object_key is not ...:
            previous = conversation.photo_object_key
            if photo_object_key:
                if not photo_object_key.startswith(chat_storage.group_photo_prefix(conversation.id)):
                    raise ValidationError({'photo_object_key': ['Upload the photo for this group first.']})
                try:
                    verify_upload(photo_object_key, max_size=settings.CHAT_GROUP_PHOTO_MAX_SIZE, allowed_types=None)
                except UploadRejected as exc:
                    raise ValidationError({'photo_object_key': [str(exc)]})
                except StorageUnavailable as exc:
                    raise ServiceUnavailable(str(exc))
            conversation.photo_object_key = photo_object_key or ''
            conversation.save(update_fields=['photo_object_key'])
            if previous and previous != conversation.photo_object_key:
                from chat.tasks import queue_object_deletion

                transaction.on_commit(lambda: queue_object_deletion([previous]))
        fields = [f for f in changed if f in ('name', 'description', 'photo')]
        if fields:
            _system_note(conversation, Message.SystemEvent.INFO_CHANGED, {'user_id': user.pk, 'fields': fields})
        realtime.broadcast(_member_ids(conversation), 'conversation.updated', {'conversation_id': str(conversation.id)})
    return conversation


def reserve_group_photo(user, conversation_id, *, size: int) -> dict:
    if size > settings.CHAT_GROUP_PHOTO_MAX_SIZE:
        raise ValidationError({'size': ['A group photo can be up to 512 KB once encrypted.']})
    with transaction.atomic():
        _participant, conversation = _group_membership(user, conversation_id, admin=True)
    key = chat_storage.group_photo_key(conversation.id)
    try:
        upload = chat_storage.upload_url(key)
    except chat_storage.ChatStorageError as exc:
        raise ServiceUnavailable(str(exc))
    return {'object_key': key, 'upload_url': upload, 'content_type': chat_storage.CONTENT_TYPE}


def group_photo_download(user, conversation_id) -> str:
    participant = get_membership(user, conversation_id)
    key = participant.conversation.photo_object_key
    if not key:
        raise NotFound('This group has no photo.')
    try:
        return chat_storage.download_url(key)
    except chat_storage.ChatStorageError as exc:
        raise ServiceUnavailable(str(exc))


def add_group_members(user, conversation_id, *, member_ids, version: int, keys: list[dict], info: dict | None):
    """Admins add people. The adder makes a new key version covering everyone
    now in the group (so the new people can read from here on, not before)
    and re-encrypts the group details with it. People without chat join as
    pending."""
    account = require_account(user)
    with transaction.atomic():
        _participant, conversation = _group_membership(user, conversation_id, admin=True)
        current = set(_member_ids(conversation))
        ready, pending = _people_to_add(user, member_ids, existing=current)
        if not ready and not pending:
            raise ValidationError({'member_ids': ['Everyone chosen is already in the group.']})
        if len(current) + len(ready) + len(pending) > MAX_GROUP_MEMBERS:
            raise ValidationError({'member_ids': [f'A group can have up to {MAX_GROUP_MEMBERS} people.']})
        latest = _latest_version(conversation)
        if version != latest + 1:
            raise Conflict(f'The next key version is {latest + 1}.')
        now = timezone.now()
        for person in ready + pending:
            Participant.objects.update_or_create(
                conversation=conversation,
                user=person,
                defaults={'left_at': None, 'joined_at': now, 'role': Participant.Role.MEMBER,
                          'pending': person in pending, 'last_read_seq': conversation.next_seq - 1},
            )
        keyed = _keyed_member_ids(conversation)
        accounts = {a.user_id: a for a in ChatAccount.objects.filter(user_id__in=keyed)}
        by_recipient = _check_wrapped_keys(keys, accounts)
        _store_keys(conversation, version, user, account, by_recipient, accounts)
        if info:
            _set_info(conversation, info, version=version)
        for person in ready + pending:
            _system_note(conversation, Message.SystemEvent.MEMBER_ADDED, {'user_id': user.pk, 'target_id': person.pk})
        _invite_pending(user, conversation, pending)
        realtime.broadcast([p.pk for p in ready + pending], 'conversation.new', {'conversation_id': str(conversation.id)})
        realtime.broadcast(_member_ids(conversation), 'conversation.updated', {'conversation_id': str(conversation.id)})
        realtime.broadcast(_member_ids(conversation), 'key.changed', {'conversation_id': str(conversation.id), 'version': version})
    return conversation


def _ensure_owner(conversation) -> None:
    """A group always has an owner: when the owner has gone, the longest-
    standing admin takes over, otherwise the longest-standing member."""
    active = Participant.objects.filter(conversation=conversation, left_at__isnull=True)
    if active.filter(role=Participant.Role.OWNER).exists():
        return
    heir = (
        active.filter(role=Participant.Role.ADMIN, pending=False).order_by('joined_at').first()
        or active.filter(pending=False).order_by('joined_at').first()
        or active.order_by('joined_at').first()
    )
    if heir is not None:
        Participant.objects.filter(pk=heir.pk).update(role=Participant.Role.OWNER)
        _system_note(
            conversation,
            Message.SystemEvent.OWNER_TRANSFERRED,
            {'user_id': None, 'target_id': heir.user_id, 'automatic': True},
        )


def remove_group_member(user, conversation_id, target_id: int) -> None:
    """Leave (yourself) or remove someone. Admins remove members; only the
    owner removes admins; nobody removes the owner. They lose access straight
    away, and the next message makes a key without them. An owner who leaves
    without handing over is succeeded by the longest-standing admin (or member)."""
    leaving = target_id == user.pk
    with transaction.atomic():
        participant, conversation = _group_membership(user, conversation_id, admin=not leaving)
        target = Participant.objects.filter(conversation=conversation, user_id=target_id, left_at__isnull=True).first()
        if target is None:
            raise NotFound('That person is not in this group.')
        if not leaving:
            if target.role == Participant.Role.OWNER:
                raise PermissionDenied('The group owner cannot be removed.')
            if target.role == Participant.Role.ADMIN and participant.role != Participant.Role.OWNER:
                raise PermissionDenied('Only the group owner can remove an admin.')
        Participant.objects.filter(pk=target.pk).update(left_at=timezone.now(), role=Participant.Role.MEMBER)
        if leaving:
            _system_note(conversation, Message.SystemEvent.MEMBER_LEFT, {'user_id': user.pk})
        else:
            _system_note(conversation, Message.SystemEvent.MEMBER_REMOVED, {'user_id': user.pk, 'target_id': target_id})
        _ensure_owner(conversation)
        realtime.broadcast([target_id], 'conversation.removed', {'conversation_id': str(conversation.id)})
        realtime.broadcast(_member_ids(conversation), 'conversation.updated', {'conversation_id': str(conversation.id)})


def transfer_ownership(user, conversation_id, target_id: int) -> None:
    """The owner hands the group to another member, and becomes an admin."""
    with transaction.atomic():
        participant, conversation = _group_membership(user, conversation_id, owner=True)
        target = Participant.objects.filter(
            conversation=conversation, user_id=target_id, left_at__isnull=True, pending=False
        ).first()
        if target is None or target.user_id == user.pk:
            raise ValidationError({'user_id': ['Choose another member who has joined the group.']})
        Participant.objects.filter(pk=participant.pk).update(role=Participant.Role.ADMIN)
        Participant.objects.filter(pk=target.pk).update(role=Participant.Role.OWNER)
        _system_note(conversation, Message.SystemEvent.OWNER_TRANSFERRED, {'user_id': user.pk, 'target_id': target_id})
        realtime.broadcast(_member_ids(conversation), 'conversation.updated', {'conversation_id': str(conversation.id)})


def set_group_admin(user, conversation_id, target_id: int, *, admin: bool) -> None:
    """Admins make members admins; only the owner takes admin away. The owner's
    role is changed only by handing over ownership."""
    with transaction.atomic():
        participant, conversation = _group_membership(user, conversation_id, admin=True)
        target = Participant.objects.filter(conversation=conversation, user_id=target_id, left_at__isnull=True).first()
        if target is None:
            raise NotFound('That person is not in this group.')
        if target.role == Participant.Role.OWNER:
            raise PermissionDenied('The owner stays an admin. Hand over ownership to change that.')
        if not admin and participant.role != Participant.Role.OWNER:
            raise PermissionDenied('Only the group owner can remove an admin.')
        if target.pending:
            raise ValidationError({'user_id': ['They can become an admin once they have joined.']})
        role = Participant.Role.ADMIN if admin else Participant.Role.MEMBER
        if target.role == role:
            return
        Participant.objects.filter(pk=target.pk).update(role=role)
        _system_note(
            conversation,
            Message.SystemEvent.ADMIN_GRANTED if admin else Message.SystemEvent.ADMIN_REVOKED,
            {'user_id': user.pk, 'target_id': target_id},
        )
        realtime.broadcast(_member_ids(conversation), 'conversation.updated', {'conversation_id': str(conversation.id)})