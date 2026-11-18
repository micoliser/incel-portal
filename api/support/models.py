import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from common.models import TimeStampedModel


class SupportRequest(TimeStampedModel):
    class Category(models.TextChoices):
        IT_SUPPORT = 'IT_SUPPORT', 'IT Support'
        OTHER = 'OTHER', 'Other'

    CATEGORY_CHOICES = Category.choices
    class Priority(models.TextChoices):
        LOW = 'low', 'Low'
        MEDIUM = 'medium', 'Medium'
        HIGH = 'high', 'High'
        URGENT = 'urgent', 'Urgent'

    PRIORITY_CHOICES = Priority.choices
    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        ASSIGNED = 'assigned', 'Assigned'
        IN_PROGRESS = 'in_progress', 'In Progress'
        RESOLVED = 'resolved', 'Resolved'
        CLOSED = 'closed', 'Closed'

    STATUS_CHOICES = Status.choices

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    requester = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='support_requests',
    )
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=20, choices=CATEGORY_CHOICES)
    priority = models.CharField(max_length=10, choices=PRIORITY_CHOICES, default='medium')
    description = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    department = models.ForeignKey(
        'organization.Department',
        on_delete=models.PROTECT,
        related_name='support_requests',
    )
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_support_requests',
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='assigned_by_support_requests',
    )
    resolved_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    line_manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='staff_support_requests',
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['requester', '-created_at']),
            models.Index(fields=['department', 'status']),
            models.Index(fields=['assigned_to', 'status']),
            models.Index(fields=['status', '-created_at']),
        ]

    def __str__(self):
        return f'{self.title} ({self.get_category_display()})'

    @property
    def is_overdue_auto_close(self) -> bool:
        """Check if a resolved request is past the auto-close threshold."""
        if self.status != 'resolved' or not self.resolved_at:
            return False
        days = getattr(settings, 'SUPPORT_AUTO_CLOSE_DAYS', 7)
        threshold = self.resolved_at + timezone.timedelta(days=days)
        return timezone.now() >= threshold


class SupportComment(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.ForeignKey(
        SupportRequest,
        on_delete=models.CASCADE,
        related_name='comments',
    )
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='support_comments',
    )
    body = models.TextField()
    is_system = models.BooleanField(default=False)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['request', 'created_at']),
        ]

    def __str__(self):
        preview = self.body[:60]
        return f'{self.author.username}: {preview}{"..." if len(self.body) > 60 else ""}'


class SupportAttachment(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.ForeignKey(
        SupportRequest,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='attachments',
    )
    comment = models.ForeignKey(
        SupportComment,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='attachments',
    )
    object_key = models.CharField(max_length=1024, unique=True)
    file_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=255)
    size = models.PositiveBigIntegerField()

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return self.file_name

    def clean(self):
        from django.core.exceptions import ValidationError
        if (self.request is None) == (self.comment is None):
            raise ValidationError(
                'Attachment must be linked to exactly one of request or comment.'
            )
