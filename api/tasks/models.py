import uuid

from django.db import models
from django.contrib.auth.models import User


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
            models.Index(fields=['is_active', 'next_run_at']),
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
