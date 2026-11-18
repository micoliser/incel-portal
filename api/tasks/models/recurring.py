"""Recurring schedules and the occurrences they create."""

import uuid

from django.conf import settings
from django.db import models

from common.models import CreatedAtModel, TimeStampedModel

from .tasks import TASK_PRIORITY_CHOICES


class RecurringSchedule(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    class Frequency(models.TextChoices):
        DAILY = 'daily', 'Daily'
        WEEKLY = 'weekly', 'Weekly'

    FREQUENCY_CHOICES = Frequency.choices

    title = models.CharField(max_length=255)
    description = models.TextField(blank=True)
    # PROTECT: work records outlive a staff member; accounts are deactivated, not deleted.
    assigned_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='recurring_schedules_created')
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='recurring_schedules_assigned')
    priority = models.CharField(max_length=20, choices=TASK_PRIORITY_CHOICES, default='medium')
    frequency = models.CharField(max_length=20, choices=FREQUENCY_CHOICES)
    interval = models.PositiveIntegerField(default=1)
    include_weekends = models.BooleanField(default=False)
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
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='recurring_schedules_paused',
    )
    ended_at = models.DateTimeField(null=True, blank=True)
    ended_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='recurring_schedules_ended',
    )

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['is_active', 'is_paused', 'next_run_at']),
            models.Index(fields=['assigned_by', 'is_active']),
            models.Index(fields=['assigned_to', 'is_active']),
        ]

    def __str__(self):
        return self.title


class RecurrenceOccurrence(CreatedAtModel):
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
