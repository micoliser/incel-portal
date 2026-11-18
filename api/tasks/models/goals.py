"""Weekly goals."""

import uuid

from django.conf import settings
from django.db import models

from common.models import TimeStampedModel


class UserGoal(TimeStampedModel):
    """Goal tracking for users to set targets and track progress"""
    class Metric(models.TextChoices):
        TASKS_COMPLETED = 'tasks_completed', 'Tasks Completed'
        HIGH_PRIORITY_COMPLETED = 'high_priority_completed', 'High Priority Tasks Completed'
        FILES_ATTACHED = 'files_attached', 'Files Attached'
        COMMENTS_ADDED = 'comments_added', 'Comments Added'

    GOAL_METRICS = Metric.choices
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='goals')
    metric = models.CharField(max_length=50, choices=GOAL_METRICS)
    target_value = models.FloatField()  # e.g., 90.0 for 90%
    period_start = models.DateField()
    period_end = models.DateField()
    is_active = models.BooleanField(default=True)
    
    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['user', 'is_active']),
        ]
    
    def __str__(self):
        return f"{self.user.username} - {self.metric}: {self.target_value}"
