"""Request validation and response shapes for chat.

Encrypted values travel as standard base64 text. The server checks only that
they decode and have the expected length; it never learns what they contain.
"""

from __future__ import annotations

import base64
import binascii

from django.conf import settings
from django.core.exceptions import ObjectDoesNotExist
from rest_framework import serializers

from chat.models import Message
from common.users import display_name

KEY_BYTES = 32  # X25519 public keys, symmetric keys
NONCE_BYTES = 24  # XSalsa20 / XChaCha20 nonces
SALT_BYTES = 16  # crypto_pwhash salt
BOX_MAC_BYTES = 16

# Argon2id limits: low enough that phones can unlock, high enough that a
# stolen copy of the database cannot be guessed cheaply.
MIN_OPS, MAX_OPS = 2, 10
MIN_MEM, MAX_MEM = 32 * 1024 * 1024, 1024 * 1024 * 1024


def _decoded_length(value: str) -> int:
    try:
        return len(base64.b64decode(value, validate=True))
    except (binascii.Error, ValueError):
        raise serializers.ValidationError('Must be base64.')


class Base64Field(serializers.CharField):
    """Base64 text whose decoded size is exactly `size`, or between `min_size` and `max_size`."""

    def __init__(self, *, size=None, min_size=1, max_size=None, **kwargs):
        self.size = size
        self.min_size = min_size
        self.max_bytes = max_size
        kwargs.setdefault('trim_whitespace', True)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        value = super().to_internal_value(data)
        length = _decoded_length(value)
        if self.size is not None and length != self.size:
            raise serializers.ValidationError(f'Must decode to {self.size} bytes.')
        if length < self.min_size:
            raise serializers.ValidationError('Too short.')
        if self.max_bytes is not None and length > self.max_bytes:
            raise serializers.ValidationError('Too long.')
        return value


class KeyBackupSerializer(serializers.Serializer):
    """The private key encrypted with a key derived (Argon2id) from a secret
    only the user knows (the recovery code, or the PIN in PinBackupSerializer)."""

    box = Base64Field(size=KEY_BYTES + BOX_MAC_BYTES)
    nonce = Base64Field(size=NONCE_BYTES)
    salt = Base64Field(size=SALT_BYTES)
    ops = serializers.IntegerField(min_value=MIN_OPS, max_value=MAX_OPS)
    mem = serializers.IntegerField(min_value=MIN_MEM, max_value=MAX_MEM)


class PinBackupSerializer(KeyBackupSerializer):
    """Two layers: the private key sealed with the PIN-derived key
    (`inner_nonce`), then sealed again with the password-derived secret (`nonce`)."""

    box = Base64Field(size=KEY_BYTES + 2 * BOX_MAC_BYTES)
    inner_nonce = Base64Field(size=NONCE_BYTES)


class AccountSetupSerializer(serializers.Serializer):
    public_key = Base64Field(size=KEY_BYTES)
    pin = PinBackupSerializer()
    recovery = KeyBackupSerializer()


class AccountBackupUpdateSerializer(serializers.Serializer):
    pin = PinBackupSerializer(required=False)
    recovery = KeyBackupSerializer(required=False)

    def validate(self, attrs):
        if not attrs:
            raise serializers.ValidationError('Send a new PIN copy, a new recovery copy, or both.')
        return attrs


class ResetCodeSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=20)


class AccountResetSerializer(AccountSetupSerializer):
    code = serializers.CharField(max_length=20)


class PasswordCheckSerializer(serializers.Serializer):
    password = serializers.CharField(trim_whitespace=False, max_length=512)


def account_payload(account) -> dict:
    def backup(prefix):
        return {
            'box': getattr(account, f'{prefix}_box'),
            'nonce': getattr(account, f'{prefix}_nonce'),
            'salt': getattr(account, f'{prefix}_salt'),
            'ops': getattr(account, f'{prefix}_ops'),
            'mem': getattr(account, f'{prefix}_mem'),
        }

    return {
        'key_id': str(account.key_id),
        'public_key': account.public_key,
        'pin': {**backup('pin'), 'inner_nonce': account.pin_inner_nonce},
        'recovery': backup('recovery'),
        'created_at': account.created_at,
        'updated_at': account.updated_at,
    }


class WrappedKeySerializer(serializers.Serializer):
    recipient_id = serializers.IntegerField()
    recipient_key_id = serializers.UUIDField()
    wrapped_key = Base64Field(size=KEY_BYTES + BOX_MAC_BYTES)
    nonce = Base64Field(size=NONCE_BYTES)


class StartConversationSerializer(serializers.Serializer):
    user_id = serializers.IntegerField()
    keys = WrappedKeySerializer(many=True, allow_empty=False)


class KeyVersionSerializer(serializers.Serializer):
    # 1 for a chat that began as an invitation (no key until both set up).
    version = serializers.IntegerField(min_value=1)
    keys = WrappedKeySerializer(many=True, allow_empty=False)


class SendMessageSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    kind = serializers.ChoiceField(choices=[Message.Kind.TEXT, Message.Kind.ATTACHMENT, Message.Kind.VOICE])
    key_version = serializers.IntegerField(min_value=1)
    nonce = Base64Field(size=NONCE_BYTES)
    ciphertext = Base64Field(max_size=None)
    attachment_ids = serializers.ListField(child=serializers.UUIDField(), required=False, default=list)

    def validate_ciphertext(self, value):
        if len(value) > settings.CHAT_MESSAGE_MAX_CIPHERTEXT:
            raise serializers.ValidationError('The message is too long.')
        return value

    def validate(self, attrs):
        ids = attrs.get('attachment_ids') or []
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError({'attachment_ids': ['Each file can be sent once.']})
        if len(ids) > settings.CHAT_ATTACHMENTS_PER_MESSAGE:
            raise serializers.ValidationError(
                {'attachment_ids': [f'Send up to {settings.CHAT_ATTACHMENTS_PER_MESSAGE} files at a time.']}
            )
        if attrs['kind'] == Message.Kind.TEXT and ids:
            raise serializers.ValidationError({'attachment_ids': ['A text message carries no files.']})
        if attrs['kind'] != Message.Kind.TEXT and not ids:
            raise serializers.ValidationError({'attachment_ids': ['Attach at least one file.']})
        return attrs


class EditMessageSerializer(serializers.Serializer):
    revision = serializers.IntegerField(min_value=1)
    nonce = Base64Field(size=NONCE_BYTES)
    ciphertext = Base64Field()

    def validate_ciphertext(self, value):
        if len(value) > settings.CHAT_MESSAGE_MAX_CIPHERTEXT:
            raise serializers.ValidationError('The message is too long.')
        return value


class ReadSerializer(serializers.Serializer):
    seq = serializers.IntegerField(min_value=0)


class ReserveAttachmentSerializer(serializers.Serializer):
    size = serializers.IntegerField(min_value=1)
    thumb_size = serializers.IntegerField(min_value=1, required=False, allow_null=True)

    def validate_size(self, value):
        limit = settings.CHAT_ATTACHMENT_MAX_SIZE + settings.CHAT_ATTACHMENT_ENCRYPTION_OVERHEAD
        if value > limit:
            raise serializers.ValidationError('Files can be up to 25 MB.')
        return value

    def validate_thumb_size(self, value):
        if value is not None and value > settings.CHAT_THUMBNAIL_MAX_SIZE:
            raise serializers.ValidationError('The preview image is too large.')
        return value


class ConversationSettingsSerializer(serializers.Serializer):
    muted_until = serializers.DateTimeField(required=False, allow_null=True)
    archived = serializers.BooleanField(required=False)


# --- Response shapes -------------------------------------------------------

def person_payload(user, *, online: bool | None = None) -> dict:
    account = account_of(user)
    profile = getattr(user, 'staff_profile', None)
    department = getattr(profile, 'department', None) if profile else None
    data = {
        'id': user.id,
        'name': display_name(user),
        'email': user.email,
        'department': department.name if department else None,
        'is_active': user.is_active,
        'chat_ready': account is not None,
        'key_id': str(account.key_id) if account else None,
        'public_key': account.public_key if account else None,
        'last_seen_at': account.last_seen_at if account else None,
    }
    if online is not None:
        data['online'] = online
    return data


def account_of(user):
    """The user's ChatAccount, or None if they have not set up chat."""
    try:
        return user.chat_account
    except ObjectDoesNotExist:
        return None


def message_payload(message, attachments=None) -> dict:
    deleted = message.deleted_at is not None
    if attachments is None:
        attachments = [] if deleted else list(message.attachments.all())
    return {
        'id': str(message.id),
        'conversation_id': str(message.conversation_id),
        'sender_id': message.sender_id,
        'seq': message.seq,
        'kind': message.kind,
        'key_version': message.key_version,
        'nonce': message.nonce,
        'ciphertext': message.ciphertext,
        'revision': message.revision,
        'system_event': message.system_event or None,
        'system_data': message.system_data or {},
        'created_at': message.created_at,
        'edited_at': message.edited_at,
        'deleted': deleted,
        'deleted_at': message.deleted_at,
        'attachments': [
            {
                'id': str(item.id),
                'size': item.encrypted_size,
                'has_thumb': bool(item.thumb_key),
            }
            for item in attachments
        ],
    }


def key_payload(row) -> dict:
    return {
        'version': row.version,
        'recipient_key_id': str(row.recipient_key_id),
        'wrapped_by_id': row.wrapped_by_id,
        'wrapper_public_key': row.wrapper_public_key,
        'wrapped_key': row.wrapped_key,
        'nonce': row.nonce,
        'created_at': row.created_at,
    }
