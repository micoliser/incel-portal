"""Personal to-do items."""

import datetime
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from common.models import TimeStampedModel

from .tasks import TASK_PRIORITY_CHOICES


class TodoItem(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='todos')
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default='')

    # Due Date & Time
    due_date = models.DateField(null=True, blank=True)
    due_time = models.TimeField(null=True, blank=True)
    due_datetime = models.DateTimeField(null=True, blank=True, db_index=True)

    # Priority & Completion Status
    priority = models.CharField(max_length=20, choices=TASK_PRIORITY_CHOICES, default='medium')
    is_completed = models.BooleanField(default=False, db_index=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    # Reminders
    reminder_at = models.DateTimeField(null=True, blank=True, db_index=True)
    reminder_offset = models.CharField(max_length=32, default='exact')  # single offset (backwards compatibility)
    reminder_offsets = models.JSONField(default=list, blank=True)  # multiple offsets: ['30m', '15m', 'exact']
    reminders_sent = models.JSONField(default=list, blank=True)  # list of dispatched offsets
    reminder_sent = models.BooleanField(default=False, db_index=True)
    reminder_sent_at = models.DateTimeField(null=True, blank=True)
    send_email_reminder = models.BooleanField(default=False)

    OFFSET_MAP = {
        'exact': datetime.timedelta(minutes=0),
        '5m': datetime.timedelta(minutes=5),
        '10m': datetime.timedelta(minutes=10),
        '15m': datetime.timedelta(minutes=15),
        '30m': datetime.timedelta(minutes=30),
        '1h': datetime.timedelta(hours=1),
        '2h': datetime.timedelta(hours=2),
        '1d': datetime.timedelta(days=1),
    }


    class Meta:
        ordering = ['is_completed', 'due_datetime', '-created_at']

    def __str__(self):
        return f"{self.user.username}: {self.title}"

    def compute_next_reminder(self):
        """Find earliest unsent reminder datetime based on due_datetime and reminder_offsets."""
        if not self.due_datetime:
            return None

        offsets = list(self.reminder_offsets) if self.reminder_offsets else []
        if not offsets and self.reminder_offset and self.reminder_offset != 'none':
            offsets = [self.reminder_offset]

        valid_offsets = [o for o in offsets if o in self.OFFSET_MAP]
        if not valid_offsets:
            return None

        sent = set(self.reminders_sent or [])
        unsent_times = []
        for o in valid_offsets:
            if o not in sent:
                rem_time = self.due_datetime - self.OFFSET_MAP[o]
                unsent_times.append((rem_time, o))

        if not unsent_times:
            return None

        unsent_times.sort(key=lambda x: x[0])
        return unsent_times[0][0]

    def save(self, *args, **kwargs):
        # Auto compute due_datetime from due_date + due_time if due_date is provided and not already set with timezone
        if self.due_date:
            if not self.due_datetime:
                target_time = self.due_time or datetime.time(23, 59, 59)
                dt = datetime.datetime.combine(self.due_date, target_time)
                current_tz = timezone.get_current_timezone()
                if timezone.is_naive(dt):
                    self.due_datetime = timezone.make_aware(dt, current_tz)
                else:
                    self.due_datetime = dt
        else:
            self.due_datetime = None

        if self.due_datetime:
            # Sync single and multiple offsets
            if not self.reminder_offsets and self.reminder_offset and self.reminder_offset != 'none':
                self.reminder_offsets = [self.reminder_offset]
            elif self.reminder_offsets and not self.reminder_offset:
                self.reminder_offset = self.reminder_offsets[0]

            # Only recompute next_reminder if reminder_at is not already set to a future custom/snoozed time
            if not self.reminder_at or self.reminder_at <= timezone.now():
                next_rem = self.compute_next_reminder()
                if next_rem:
                    self.reminder_at = next_rem
                    self.reminder_sent = False
                elif self.reminder_offsets and not self.reminder_at:
                    # All reminders have fired
                    self.reminder_sent = True
        elif not self.reminder_at:
            self.reminder_at = None

        if self.is_completed and not self.completed_at:
            self.completed_at = timezone.now()
        elif not self.is_completed:
            self.completed_at = None

        super().save(*args, **kwargs)

    def snooze(self, minutes: int = 15):
        base_time = timezone.now()
        if self.reminder_at and self.reminder_at > base_time:
            base_time = self.reminder_at
        self.reminder_at = base_time + datetime.timedelta(minutes=minutes)
        self.reminder_sent = False
        self.save()

    def toggle_complete(self):
        self.is_completed = not self.is_completed
        if self.is_completed:
            self.completed_at = timezone.now()
        else:
            self.completed_at = None
        self.save()
