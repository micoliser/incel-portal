from django.conf import settings
from django.db import models

from common.models import TimeStampedModel


class StaffProfile(TimeStampedModel):
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

    class Meta:
        ordering = ['user__username']

    def __str__(self):
        return f"{self.user.get_username()} ({self.role.code})"
