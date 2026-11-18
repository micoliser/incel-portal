from django.conf import settings
from django.db import models

from common.models import CreatedAtModel


class EmailLog(CreatedAtModel):
    """Log of all sent emails for auditing and debugging."""

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        SENT = 'sent', 'Sent'
        FAILED = 'failed', 'Failed'

    STATUSES = Status.choices

    email_type = models.CharField(max_length=100)
    subject = models.CharField(max_length=255)
    recipients = models.JSONField()  # List of email addresses
    status = models.CharField(max_length=20, choices=STATUSES, default='pending')
    error_message = models.TextField(blank=True, null=True)
    sent_at = models.DateTimeField(blank=True, null=True)
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['-created_at']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f"{self.email_type} - {self.subject} ({self.status})"
