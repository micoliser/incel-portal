"""Workspace chat. End-to-end encrypted: see docs/CHAT_SPEC.md.

The server stores only what it needs to route and order messages. Message
text, file contents and file names arrive already encrypted by the sender's
browser and are stored as opaque base64 text. Keys are stored only in forms
the server cannot open (wrapped with the user's PIN and password, or recovery code,
or with another participant's public key).
"""

import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q

from common.models import CreatedAtModel, TimeStampedModel


class ChatAccount(TimeStampedModel):
    """One per user who has set up chat: their public key and two encrypted
    copies of their private key. `key_id` changes when the user starts over.

    The PIN copy has two layers: the inner one opens with the 6-digit chat PIN,
    the outer one with a secret derived from the user's portal password (which
    the server never stores), so a copy of the database is not enough to open
    it. The recovery copy opens with the recovery code alone."""

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='chat_account')
    key_id = models.UUIDField(default=uuid.uuid4)
    public_key = models.CharField(max_length=64)

    pin_box = models.TextField()
    pin_nonce = models.CharField(max_length=64)
    pin_inner_nonce = models.CharField(max_length=64)
    pin_salt = models.CharField(max_length=64)
    pin_ops = models.PositiveIntegerField()
    pin_mem = models.PositiveBigIntegerField()

    recovery_box = models.TextField()
    recovery_nonce = models.CharField(max_length=64)
    recovery_salt = models.CharField(max_length=64)
    recovery_ops = models.PositiveIntegerField()
    recovery_mem = models.PositiveBigIntegerField()

    last_seen_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'Chat account of user {self.user_id}'


class Conversation(CreatedAtModel):
    class Kind(models.TextChoices):
        DIRECT = 'direct', 'Direct'
        GROUP = 'group', 'Group'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.DIRECT)
    # "<lower user id>:<higher user id>" for direct chats, so a pair has one chat.
    direct_key = models.CharField(max_length=64, null=True, blank=True, unique=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+'
    )
    last_message_at = models.DateTimeField(null=True, blank=True, db_index=True)
    next_seq = models.PositiveBigIntegerField(default=1)

    # Groups: name, description and the photo's file key, encrypted together
    # with a conversation key version (JSON), so the server cannot read them.
    info_key_version = models.PositiveIntegerField(null=True, blank=True)
    info_nonce = models.CharField(max_length=64, blank=True)
    info_ciphertext = models.TextField(blank=True)
    # Fingerprint of the exact details, set only when an admin or the owner
    # creates or changes them. Any member may re-lock the details with a newer
    # key (so people who join can read them) but cannot change this, and
    # browsers show the details only when they match it: so only admins can
    # change what the group is called. The details carry a random value, so
    # the fingerprint reveals nothing about them.
    info_digest = models.CharField(max_length=64, blank=True)
    # The group photo's encrypted bytes in storage (its key is in the info).
    photo_object_key = models.CharField(max_length=512, blank=True)

    def __str__(self):
        return f'{self.kind} conversation {self.id}'


class Participant(models.Model):
    class Role(models.TextChoices):
        MEMBER = 'member', 'Member'
        ADMIN = 'admin', 'Admin'
        # Groups: the creator (or whoever they handed it to). Cannot be removed or demoted.
        OWNER = 'owner', 'Owner'

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='participants')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='chat_participations')
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.MEMBER)
    joined_at = models.DateTimeField(auto_now_add=True)
    left_at = models.DateTimeField(null=True, blank=True)
    last_read_seq = models.PositiveBigIntegerField(default=0)
    # Added to a group before setting up chat: no keys are made for them
    # until they set it up, and then they join (a note says so).
    pending = models.BooleanField(default=False)
    muted_until = models.DateTimeField(null=True, blank=True)
    archived = models.BooleanField(default=False)
    # "Hide chat": out of this person's list until a message after this seq arrives.
    hidden_at_seq = models.PositiveBigIntegerField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['conversation', 'user'], name='chat_participant_unique'),
        ]


class ConversationKey(CreatedAtModel):
    """A conversation's symmetric key, wrapped for one participant with
    crypto_box (the wrapper's private key and the recipient's public key).

    The wrapper's public key is copied onto the row so the recipient can still
    open it after the wrapper later starts over with a new key."""

    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='keys')
    version = models.PositiveIntegerField()
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='+')
    recipient_key_id = models.UUIDField()
    wrapped_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    wrapper_public_key = models.CharField(max_length=64)
    wrapped_key = models.CharField(max_length=128)
    nonce = models.CharField(max_length=64)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['conversation', 'version', 'recipient'], name='chat_conversation_key_unique'
            ),
        ]


class Message(models.Model):
    class Kind(models.TextChoices):
        TEXT = 'text', 'Text'
        ATTACHMENT = 'attachment', 'Attachment'
        VOICE = 'voice', 'Voice'
        SYSTEM = 'system', 'System'

    class SystemEvent(models.TextChoices):
        KEY_RESET = 'key_reset', 'Key reset'
        INVITE_SENT = 'invite_sent', 'Invitation sent'
        INVITE_ACCEPTED = 'invite_accepted', 'Invitation accepted'
        GROUP_CREATED = 'group_created', 'Group created'
        MEMBER_ADDED = 'member_added', 'Member added'
        MEMBER_REMOVED = 'member_removed', 'Member removed'
        MEMBER_LEFT = 'member_left', 'Member left'
        MEMBER_JOINED = 'member_joined', 'Pending member joined'
        INFO_CHANGED = 'info_changed', 'Group details changed'
        ADMIN_GRANTED = 'admin_granted', 'Made admin'
        ADMIN_REVOKED = 'admin_revoked', 'No longer admin'
        OWNER_TRANSFERRED = 'owner_transferred', 'New owner'

    # Made by the sender's browser, so a retried send is recognised.
    id = models.UUIDField(primary_key=True, editable=False)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='messages')
    sender = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    seq = models.PositiveBigIntegerField()
    kind = models.CharField(max_length=12, choices=Kind.choices, default=Kind.TEXT)
    key_version = models.PositiveIntegerField(null=True, blank=True)
    nonce = models.CharField(max_length=64, null=True, blank=True)
    ciphertext = models.TextField(null=True, blank=True)
    revision = models.PositiveIntegerField(default=0)
    system_event = models.CharField(max_length=20, choices=SystemEvent.choices, blank=True)
    system_data = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    edited_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['conversation', 'seq'], name='chat_message_seq_unique'),
        ]
        indexes = [models.Index(fields=['conversation', '-seq'], name='chat_message_recent')]


class MessageAttachment(CreatedAtModel):
    """An encrypted file in storage. Reserved before upload, linked to a
    message when the message is sent; unlinked ones are removed after a day."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(Conversation, on_delete=models.CASCADE, related_name='attachments')
    message = models.ForeignKey(
        Message, on_delete=models.SET_NULL, null=True, blank=True, related_name='attachments'
    )
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')
    file_key = models.CharField(max_length=512)
    thumb_key = models.CharField(max_length=512, blank=True)
    encrypted_size = models.PositiveBigIntegerField(null=True, blank=True)
    thumb_size = models.PositiveBigIntegerField(null=True, blank=True)


class MessageReaction(models.Model):
    """One person's reaction to a message. The emoji is encrypted with the
    conversation key like a message, so the server sees only that this person
    reacted to this message, not with what. One reaction per person."""

    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='reactions')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='+')
    key_version = models.PositiveIntegerField()
    nonce = models.CharField(max_length=64)
    ciphertext = models.CharField(max_length=512)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            # Also serves lookups by message (its first column).
            models.UniqueConstraint(fields=['message', 'user'], name='chat_reaction_unique'),
        ]


class HiddenMessage(CreatedAtModel):
    """A message deleted for one user only."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='+')
    message = models.ForeignKey(Message, on_delete=models.CASCADE, related_name='hidden_for')

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['user', 'message'], name='chat_hidden_message_unique'),
        ]


ACTIVE_PARTICIPANT = Q(left_at__isnull=True)
