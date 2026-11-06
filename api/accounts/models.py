import hashlib
import secrets
import uuid

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

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
        Escalates if the user is the leader of that structural unit.
        """
        if self.team and self.team.team_lead and self.team.team_lead != self.user:
            return self.team.team_lead
            
        unit = self.unit or (self.team.unit if self.team else None)
        if unit and unit.supervisor and unit.supervisor != self.user:
            return unit.supervisor
            
        dept = self.department or (unit.department if unit else None)
        if dept and dept.line_manager and dept.line_manager != self.user:
            return dept.line_manager

        return None

    @property
    def display_title(self):
        """
        Computes the user's display title for the frontend header.
        Global roles override structural roles. Structural roles override the base role.
        """
        if self.role:
            code = (self.role.code or '').upper()
            name = (self.role.name or '').upper()
            if code == 'ED' or name in ['ED', 'EXECUTIVE DIRECTOR']:
                return "ED"
            if code == 'MD' or name in ['MD', 'MANAGING DIRECTOR']:
                return "MD"
            if code == 'ADMIN' or name in ['ADMIN', 'ADMINISTRATOR']:
                return self.role.name or "Admin"

        if self.user.managed_departments.exists():
            return "Line Manager"
        if self.user.managed_units.exists():
            return "Supervisor"
        if self.user.managed_teams.exists():
            return "Team Lead"

        return "Staff"

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


class ServiceApiKey(TimeStampedModel):
    """
    API Key model for external machine-to-machine integrations.
    Authenticates requests via standard Bearer token header.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=150, help_text="Identifier for the external application/client")
    prefix = models.CharField(
        max_length=16,
        db_index=True,
        help_text="First 8-12 characters of the key for identification/debugging",
    )
    hashed_key = models.CharField(
        max_length=128,
        db_index=True,
        help_text="SHA-256 hash of the secret key",
    )
    is_active = models.BooleanField(default=True, db_index=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='service_api_keys',
    )

    class Meta:
        ordering = ['-created_at']
        verbose_name = 'Service API Key'
        verbose_name_plural = 'Service API Keys'

    def __str__(self):
        return f"{self.name} ({self.prefix}...)"

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def is_expired(self) -> bool:
        if self.expires_at is None:
            return False
        return timezone.now() > self.expires_at

    @classmethod
    def generate_key(
        cls,
        name: str,
        created_by=None,
        expires_at=None,
        prefix_tag: str = "incel_live_",
    ) -> tuple['ServiceApiKey', str]:
        """
        Generate a new random raw API key, store its hash and prefix,
        and return the (instance, raw_key) tuple.
        """
        random_part = secrets.token_urlsafe(32)
        raw_key = f"{prefix_tag}{random_part}"
        prefix = raw_key[:12]
        hashed_key = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()

        instance = cls.objects.create(
            name=name,
            prefix=prefix,
            hashed_key=hashed_key,
            created_by=created_by,
            expires_at=expires_at,
            is_active=True,
        )
        return instance, raw_key
