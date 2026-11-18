import uuid

from django.conf import settings
from django.db import models

from common.models import CreatedAtModel, TimeStampedModel


class Notification(CreatedAtModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    class Type(models.TextChoices):
        TASK_ASSIGNED = 'task_assigned', 'Task Assigned'
        TASK_STATUS_CHANGED = 'task_status_changed', 'Task Status Changed'
        TASK_COMMENT = 'task_comment', 'Task Comment'
        SUPPORT_SUBMITTED = 'support_request_submitted', 'Support Request Submitted'
        SUPPORT_ASSIGNED = 'support_request_assigned', 'Support Request Assigned'
        SUPPORT_STATUS_UPDATED = 'support_status_updated', 'Support Status Updated'
        SUPPORT_COMMENT = 'support_comment_added', 'Support Comment Added'
        SUPPORT_RESOLVED = 'support_request_resolved', 'Support Request Resolved'
        SUPPORT_CLOSED = 'support_request_closed', 'Support Request Closed'
        TODO_REMINDER = 'todo_reminder', 'To-Do Reminder'
        INVENTORY_ASSIGNED = 'inventory_assigned', 'Inventory Assigned'
        SUMMARY_SHARED = 'summary_shared', 'Summary Shared'

    TYPE_CHOICES = Type.choices
    # The names the rest of the code uses (plain strings).
    TYPE_TASK_ASSIGNED = Type.TASK_ASSIGNED.value
    TYPE_TASK_STATUS_CHANGED = Type.TASK_STATUS_CHANGED.value
    TYPE_TASK_COMMENT = Type.TASK_COMMENT.value
    TYPE_SUPPORT_SUBMITTED = Type.SUPPORT_SUBMITTED.value
    TYPE_SUPPORT_ASSIGNED = Type.SUPPORT_ASSIGNED.value
    TYPE_SUPPORT_STATUS_UPDATED = Type.SUPPORT_STATUS_UPDATED.value
    TYPE_SUPPORT_COMMENT = Type.SUPPORT_COMMENT.value
    TYPE_SUPPORT_RESOLVED = Type.SUPPORT_RESOLVED.value
    TYPE_SUPPORT_CLOSED = Type.SUPPORT_CLOSED.value
    TYPE_TODO_REMINDER = Type.TODO_REMINDER.value
    TYPE_INVENTORY_ASSIGNED = Type.INVENTORY_ASSIGNED.value
    TYPE_SUMMARY_SHARED = Type.SUMMARY_SHARED.value

    recipient = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='notifications_sent',
    )
    notification_type = models.CharField(max_length=64, choices=TYPE_CHOICES)
    title = models.CharField(max_length=255)
    body = models.TextField(blank=True)
    link_url = models.CharField(max_length=512, blank=True)
    payload_json = models.JSONField(default=dict, blank=True)
    is_read = models.BooleanField(default=False)
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.recipient.username}: {self.title}'


class PushSubscription(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='push_subscriptions',
    )
    endpoint = models.TextField()
    p256dh = models.TextField()
    auth = models.TextField()
    user_agent = models.CharField(max_length=512, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(
                fields=['endpoint'],
                name='notifications_unique_endpoint',
            )
        ]

    def __str__(self):
        return f'{self.user.username} push subscription'
