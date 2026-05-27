import uuid

from django.db import models
from django.contrib.auth.models import User

from organization.models import Department


TASK_PRIORITY_CHOICES = [
    ('low', 'Low'),
    ('medium', 'Medium'),
    ('high', 'High'),
]


class RecurringSchedule(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    FREQUENCY_CHOICES = [
        ('daily', 'Daily'),
        ('weekly', 'Weekly'),
    ]

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    assigned_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='recurring_schedules_created')
    assigned_to = models.ForeignKey(User, on_delete=models.CASCADE, related_name='recurring_schedules_assigned')
    priority = models.CharField(max_length=20, choices=TASK_PRIORITY_CHOICES, default='medium')
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES)
    interval = models.PositiveIntegerField(default=1)
    weekdays = models.JSONField(default=list, blank=True)
    times = models.JSONField(default=list, blank=True)
    timezone = models.CharField(max_length=64, default='UTC')
    deadline_offset_minutes = models.PositiveIntegerField(default=0)
    start_at = models.DateTimeField()
    end_at = models.DateTimeField(null=True, blank=True)
    next_run_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    is_paused = models.BooleanField(default=False)
    paused_at = models.DateTimeField(null=True, blank=True)
    paused_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='recurring_schedules_paused',
    )
    ended_at = models.DateTimeField(null=True, blank=True)
    ended_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='recurring_schedules_ended',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['is_active', 'is_paused', 'next_run_at']),
            models.Index(fields=['assigned_by', 'is_active']),
            models.Index(fields=['assigned_to', 'is_active']),
        ]

    def __str__(self):
        return self.title


class RecurrenceOccurrence(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    schedule = models.ForeignKey(RecurringSchedule, on_delete=models.CASCADE, related_name='occurrences')
    scheduled_for = models.DateTimeField()
    created_task = models.OneToOneField(
        'Task',
        on_delete=models.CASCADE,
        related_name='recurrence_origin',
        null=True,
        blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['scheduled_for']
        constraints = [
            models.UniqueConstraint(
                fields=['schedule', 'scheduled_for'],
                name='tasks_unique_recurring_occurrence',
            )
        ]

    def __str__(self):
        return f'{self.schedule.title} @ {self.scheduled_for.isoformat()}'


class Task(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('in_progress', 'In Progress'),
        ('completed', 'Completed'),
    ]
    PRIORITY_CHOICES = TASK_PRIORITY_CHOICES

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    assigned_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tasks_created')
    assigned_to = models.ForeignKey(User, on_delete=models.CASCADE, related_name='tasks_assigned')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='medium')
    deadline = models.DateTimeField(null=True, blank=True)
    recurrence_schedule = models.ForeignKey(
        RecurringSchedule,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='generated_tasks',
    )
    recurrence_scheduled_for = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title


class TaskActivity(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    ACTIVITY_TYPES = [
        ('status_change', 'Status Change'),
        ('assignment', 'Assignment'),
        ('comment', 'Comment'),
        ('created', 'Created'),
    ]

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='activities')
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    activity_type = models.CharField(max_length=50, choices=ACTIVITY_TYPES, default='comment')
    old_value = models.CharField(max_length=255, null=True, blank=True)
    new_value = models.CharField(max_length=255, null=True, blank=True)
    comment = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.task.title} - {self.activity_type}'


class TaskAttachment(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    activity = models.ForeignKey(
        TaskActivity,
        on_delete=models.CASCADE,
        related_name='attachments',
    )
    object_key = models.CharField(max_length=1024, unique=True)
    file_name = models.CharField(max_length=255)
    content_type = models.CharField(max_length=255)
    size = models.PositiveBigIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return self.file_name


class WeeklySummary(models.Model):
    """Pre-calculated weekly summary for a user"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='weekly_summaries')
    week_start_date = models.DateField()  # Monday of that week
    week_end_date = models.DateField()    # Sunday
    created_at = models.DateTimeField(auto_now_add=True)
    
    # Summary metrics stored as JSON
    summary_data = models.JSONField(default=dict)
    
    # PHASE 2: Week-over-week comparison
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


class WeeklySummaryShare(models.Model):
    """Tracks who can view whose summary - public link sharing"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    summary = models.ForeignKey(WeeklySummary, on_delete=models.CASCADE, related_name='shares')
    shared_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='summaries_shared')
    share_token = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField(null=True, blank=True)  # Optional expiration
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['share_token']),
            models.Index(fields=['shared_by', '-created_at']),
        ]

    def __str__(self):
        return f"Share of {self.summary} by {self.shared_by.username}"


# PHASE 2 MODELS

class WeeklySummaryUserShare(models.Model):
    """User-to-user explicit sharing of summaries"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    summary = models.ForeignKey(WeeklySummary, on_delete=models.CASCADE, related_name='user_shares')
    shared_by = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='summaries_shared_by_me'
    )
    shared_with = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='summaries_shared_with_me'
    )
    created_at = models.DateTimeField(auto_now_add=True)
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


class DailyReport(models.Model):
    """One top-level report per user per day."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='daily_reports')
    department = models.ForeignKey(Department, on_delete=models.PROTECT, related_name='daily_reports')
    report_date = models.DateField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

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


class DailyReportSubreport(models.Model):
    """A report entry inside a daily report."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    daily_report = models.ForeignKey(DailyReport, on_delete=models.CASCADE, related_name='subreports')
    title = models.CharField(max_length=255)
    created_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='daily_report_subreports')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['daily_report', 'created_at']),
            models.Index(fields=['created_by', 'created_at']),
        ]

    def __str__(self):
        return self.title


class DailyReportComment(models.Model):
    """Append-only comments attached to a subreport."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    subreport = models.ForeignKey(
        DailyReportSubreport,
        on_delete=models.CASCADE,
        related_name='comments',
    )
    author = models.ForeignKey(User, on_delete=models.CASCADE, related_name='daily_report_comments')
    body = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']
        indexes = [
            models.Index(fields=['subreport', 'created_at']),
            models.Index(fields=['author', 'created_at']),
        ]

    def __str__(self):
        return f'{self.author.username} @ {self.created_at.isoformat()}'


class SummaryExport(models.Model):
    """Track PDF exports of summaries"""
    EXPORT_FORMATS = [
        ('pdf', 'PDF'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    summary = models.ForeignKey(WeeklySummary, on_delete=models.CASCADE, related_name='exports')
    exported_by = models.ForeignKey(User, on_delete=models.CASCADE, related_name='exported_summaries')
    format = models.CharField(max_length=10, choices=EXPORT_FORMATS)
    file_url = models.CharField(max_length=500)  # S3 or local file URL
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['exported_by', '-created_at']),
        ]
    
    def __str__(self):
        return f"{self.summary} exported as {self.format} by {self.exported_by.username}"


class UserGoal(models.Model):
    """Goal tracking for users to set targets and track progress"""
    GOAL_METRICS = [
        ('tasks_completed', 'Tasks Completed'),
        ('high_priority_completed', 'High Priority Tasks Completed'),
        ('files_attached', 'Files Attached'),
        ('comments_added', 'Comments Added'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='goals')
    metric = models.CharField(max_length=50, choices=GOAL_METRICS)
    target_value = models.FloatField()  # e.g., 90.0 for 90%
    period_start = models.DateField()
    period_end = models.DateField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'is_active']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.metric}: {self.target_value}"


class OrganizationSummaryCache(models.Model):
    """Cache organization-wide summaries to avoid expensive queries"""
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    week_start_date = models.DateField()
    week_end_date = models.DateField()
    summary_data = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        unique_together = ('week_start_date',)
        ordering = ['-week_start_date']
    
    def __str__(self):
        return f"Org Summary - Week of {self.week_start_date}"
