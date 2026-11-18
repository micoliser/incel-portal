"""Weekly summaries, sharing, PDF exports and the organization cache."""

import uuid

from django.conf import settings
from django.db import models

from common.models import CreatedAtModel, TimeStampedModel


class WeeklySummary(CreatedAtModel):
    """Pre-calculated weekly summary for a user"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='weekly_summaries')
    week_start_date = models.DateField()  # Monday of that week
    week_end_date = models.DateField()    # Sunday
    
    # Summary metrics stored as JSON
    summary_data = models.JSONField(default=dict)
    
    # Week-over-week comparison
    previous_week_summary = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='next_week'
    )
    comparison_metrics = models.JSONField(
        default=dict,
        help_text="Week-over-week changes: delta_tasks, delta_completion_rate, etc."
    )
    
    class Meta:
        unique_together = ('user', 'week_start_date')
        ordering = ['-week_start_date']
        indexes = [
            models.Index(fields=['user', '-week_start_date']),
        ]

    def __str__(self):
        return f"{self.user.username} - Week of {self.week_start_date}"


class WeeklySummaryShare(CreatedAtModel):
    """Tracks who can view whose summary - public link sharing"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    summary = models.ForeignKey(WeeklySummary, on_delete=models.CASCADE, related_name='shares')
    shared_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='summaries_shared')
    share_token = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField(null=True, blank=True)  # Optional expiration
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['share_token']),
            models.Index(fields=['shared_by', '-created_at']),
        ]

    def __str__(self):
        return f"Share of {self.summary} by {self.shared_by.username}"


# Sharing, exports and goals


class WeeklySummaryUserShare(CreatedAtModel):
    """User-to-user explicit sharing of summaries"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    summary = models.ForeignKey(WeeklySummary, on_delete=models.CASCADE, related_name='user_shares')
    shared_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='summaries_shared_by_me'
    )
    shared_with = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='summaries_shared_with_me'
    )
    # Token allowing the recipient to open the shared summary. This token is user-scoped
    # and should be validated against the `shared_with` user when consumed.
    share_token = models.CharField(max_length=64, unique=True, null=True, blank=True)
    
    class Meta:
        unique_together = ('summary', 'shared_with')
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['shared_with', '-created_at']),
            models.Index(fields=['shared_by', '-created_at']),
        ]
    
    def __str__(self):
        return f"{self.shared_by.username} shared {self.summary} with {self.shared_with.username}"


class SummaryExport(CreatedAtModel):
    """Track PDF exports of summaries"""
    class Format(models.TextChoices):
        PDF = 'pdf', 'PDF'

    EXPORT_FORMATS = Format.choices
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    summary = models.ForeignKey(WeeklySummary, on_delete=models.CASCADE, related_name='exports')
    exported_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='exported_summaries')
    format = models.CharField(max_length=10, choices=EXPORT_FORMATS)
    file_url = models.CharField(max_length=500)  # S3 or local file URL
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['exported_by', '-created_at']),
        ]
    
    def __str__(self):
        return f"{self.summary} exported as {self.format} by {self.exported_by.username}"


class OrganizationSummaryCache(TimeStampedModel):
    """Cache organization-wide summaries to avoid expensive queries"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    week_start_date = models.DateField()
    week_end_date = models.DateField()
    summary_data = models.JSONField(default=dict)
    
    class Meta:
        unique_together = ('week_start_date',)
        ordering = ['-week_start_date']
    
    def __str__(self):
        return f"Org Summary - Week of {self.week_start_date}"
