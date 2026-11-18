"""Tasks, their history, attachments and drafts."""

import uuid

from django.conf import settings
from django.db import models

from common.models import CreatedAtModel, TimeStampedModel


class TaskPriority(models.TextChoices):
    LOW = 'low', 'Low'
    MEDIUM = 'medium', 'Medium'
    HIGH = 'high', 'High'


TASK_PRIORITY_CHOICES = TaskPriority.choices


class Task(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        IN_PROGRESS = 'in_progress', 'In Progress'
        UNDER_REVIEW = 'under_review', 'Under Review'
        COMPLETED = 'completed', 'Completed'

    STATUS_CHOICES = Status.choices
    PRIORITY_CHOICES = TASK_PRIORITY_CHOICES

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    # PROTECT: deleting one person must not delete other people's tasks.
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='tasks_created')
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='tasks_assigned')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    priority = models.CharField(max_length=20, choices=PRIORITY_CHOICES, default='medium')
    deadline = models.DateTimeField(null=True, blank=True)
    recurrence_schedule = models.ForeignKey(
        'tasks.RecurringSchedule',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='generated_tasks',
    )
    recurrence_scheduled_for = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.title


class TaskActivity(CreatedAtModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    class ActivityType(models.TextChoices):
        STATUS_CHANGE = 'status_change', 'Status Change'
        ASSIGNMENT = 'assignment', 'Assignment'
        COMMENT = 'comment', 'Comment'
        CREATED = 'created', 'Created'
        TASK_EDITED = 'task_edited', 'Task Edited'

    ACTIVITY_TYPES = ActivityType.choices

    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name='activities')
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE)
    activity_type = models.CharField(max_length=50, choices=ACTIVITY_TYPES, default='comment')
    old_value = models.CharField(max_length=255, null=True, blank=True)
    new_value = models.CharField(max_length=255, null=True, blank=True)
    comment = models.TextField(null=True, blank=True)
    links = models.JSONField(default=list, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.task.title} - {self.activity_type}'


class TaskAttachment(CreatedAtModel):
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

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return self.file_name


class TaskDraft(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='task_drafts')
    mode = models.CharField(max_length=20, default='one_time')
    title = models.CharField(max_length=255, blank=True, default='')
    description = models.TextField(blank=True, default='')
    priority = models.CharField(max_length=20, default='medium')
    deadline = models.DateTimeField(null=True, blank=True)
    assigned_to_ids = models.JSONField(default=list, blank=True)
    recurrence_config = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ['-updated_at']

    def __str__(self):
        return f"Draft: {self.title or 'Untitled'} ({self.user.username})"
