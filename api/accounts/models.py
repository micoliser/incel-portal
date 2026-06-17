import uuid

from django.conf import settings
from django.db import models

from common.models import TimeStampedModel


class StaffProfile(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='staff_profile',
    )
    role = models.ForeignKey('organization.Role', on_delete=models.PROTECT, related_name='profiles')
    department = models.ForeignKey(
        'organization.Department',
        on_delete=models.PROTECT,
        related_name='members',
        null=True,
        blank=True,
    )
    is_active = models.BooleanField(default=True)
    last_activity_at = models.DateTimeField(null=True, blank=True)
    line_manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='direct_reports',
    )

    class Meta:
        ordering = ['user__username']

    def __str__(self):
        return f"{self.user.get_username()} ({self.role.code})"
