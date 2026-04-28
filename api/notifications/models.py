from django.contrib.auth.models import User
from django.db import models


class Notification(models.Model):
    TYPE_TASK_ASSIGNED = 'task_assigned'
    TYPE_TASK_STATUS_CHANGED = 'task_status_changed'
    TYPE_TASK_COMMENT = 'task_comment'

    TYPE_CHOICES = [
        (TYPE_TASK_ASSIGNED, 'Task Assigned'),
        (TYPE_TASK_STATUS_CHANGED, 'Task Status Changed'),
        (TYPE_TASK_COMMENT, 'Task Comment'),
    ]

    recipient = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='notifications',
    )
    actor = models.ForeignKey(
        User,
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
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.recipient.username}: {self.title}'


class PushSubscription(models.Model):
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='push_subscriptions',
    )
    endpoint = models.TextField()
    p256dh = models.TextField()
    auth = models.TextField()
    user_agent = models.CharField(max_length=512, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at']
        constraints = [
            models.UniqueConstraint(
                fields=['user', 'endpoint'],
                name='notifications_unique_user_endpoint',
            )
        ]

    def __str__(self):
        return f'{self.user.username} push subscription'
