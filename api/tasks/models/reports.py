"""Daily reports, their entries and comments."""

import uuid

from django.conf import settings
from django.db import models

from common.models import CreatedAtModel, TimeStampedModel
from organization.models import Department


class DailyReport(TimeStampedModel):
    """One top-level report per user per day."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='daily_reports')
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name='daily_reports')
    report_date = models.DateField()

    class Meta:
        unique_together = ('user', 'report_date')
        ordering = ['-report_date', '-created_at']
        indexes = [
            models.Index(fields=['report_date', 'department']),
            models.Index(fields=['user', 'report_date']),
        ]

    def __str__(self):
        return f'{self.user.username} - {self.report_date.isoformat()}'

    @property
    def display_title(self):
        first_subreport = self.subreports.order_by('created_at').first()
        if first_subreport:
            return first_subreport.title
        return 'No subreports yet'


class DailyReportSubreport(TimeStampedModel):
    """A report entry inside a daily report."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    daily_report = models.ForeignKey(DailyReport, on_delete=models.CASCADE, related_name='subreports')
    title = models.CharField(max_length=255)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='daily_report_subreports')

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['daily_report', 'created_at']),
            models.Index(fields=['created_by', 'created_at']),
        ]

    def __str__(self):
        return self.title


class DailyReportComment(CreatedAtModel):
    """Append-only comments attached to a subreport."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subreport = models.ForeignKey(
        DailyReportSubreport,
        on_delete=models.CASCADE,
        related_name='comments',
    )
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='daily_report_comments')
    body = models.TextField()

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['subreport', 'created_at']),
            models.Index(fields=['author', 'created_at']),
        ]

    def __str__(self):
        return f'{self.author.username} @ {self.created_at.isoformat()}'
