import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
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
    unit = models.ForeignKey(
        'organization.Unit',
        on_delete=models.SET_NULL,
        related_name='members',
        null=True,
        blank=True,
    )
    team = models.ForeignKey(
        'organization.Team',
        on_delete=models.SET_NULL,
        related_name='members',
        null=True,
        blank=True,
    )
    is_active = models.BooleanField(default=True)
    last_activity_at = models.DateTimeField(null=True, blank=True)

    @property
    def direct_manager(self):
        """
        Dynamically returns the user's direct superior based on their 
        deepest level in the organization hierarchy.
        """
        if self.team and self.team.team_lead:
            return self.team.team_lead
        if self.unit and self.unit.supervisor:
            return self.unit.supervisor
        if self.department and self.department.line_manager:
            return self.department.line_manager
        return None

    @property
    def display_title(self):
        """
        Computes the user's display title for the frontend header.
        Global roles override structural roles. Structural roles override the base role.
        """
        if self.role and self.role.code in ['ED', 'MD', 'ADMIN']:
            return self.role.name
            
        if self.user.managed_departments.exists():
            return "Line Manager"
        if self.user.managed_units.exists():
            return "Supervisor"
        if self.user.managed_teams.exists():
            return "Team Lead"
            
        return self.role.name if self.role else "Staff"

    def clean(self):
        super().clean()
        if self.team:
            if self.unit and self.team.unit != self.unit:
                raise ValidationError({'team': 'Team does not belong to the selected unit.'})
            if not self.unit:
                self.unit = self.team.unit
                
        if self.unit:
            if self.department and self.unit.department != self.department:
                raise ValidationError({'unit': 'Unit does not belong to the selected department.'})
            if not self.department:
                self.department = self.unit.department

    class Meta:
        ordering = ['user__username']

    def __str__(self):
        return f"{self.user.get_username()} ({self.role.code})"
