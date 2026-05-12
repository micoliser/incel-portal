from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class EmailLog(models.Model):
    """Log of all sent emails for auditing and debugging."""

    STATUSES = [
        ('pending', 'Pending'),
        ('sent', 'Sent'),
        ('failed', 'Failed'),
    ]

    email_type = models.CharField(max_length=100)
    subject = models.CharField(max_length=255)
    recipients = models.JSONField()  # List of email addresses
    status = models.CharField(max_length=20, choices=STATUSES, default='pending')
    error_message = models.TextField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    sent_at = models.DateTimeField(blank=True, null=True)
    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, null=True, blank=True
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['-created_at']),
            models.Index(fields=['status']),
        ]

    def __str__(self):
        return f"{self.email_type} - {self.subject} ({self.status})"
