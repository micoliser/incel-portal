import uuid

from django.conf import settings
from django.db import models

from common.models import TimeStampedModel


class Role(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=50, unique=True)
    has_global_access = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Department(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=120, unique=True)
    code = models.CharField(max_length=50, unique=True)
    line_manager = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='managed_departments'
    )
    is_active = models.BooleanField(default=True)
    # What the department is responsible for. These replace rules that looked
    # at the department's name or code, so renaming a department no longer
    # grants or removes rights.
    manages_inventory = models.BooleanField(
        default=False, help_text='Members may create, edit, assign and retire company assets.',
    )
    handles_it_support = models.BooleanField(
        default=False, help_text='IT support requests are routed to this department.',
    )
    handles_general_support = models.BooleanField(
        default=False, help_text='Support requests that are not IT are routed to this department.',
    )
    manager_views_credit_clients = models.BooleanField(
        default=False, help_text="The department's line manager may view credit clients.",
    )

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Unit(TimeStampedModel):
    class CreditClientAccess(models.TextChoices):
        NONE = '', 'No access'
        VIEW = 'view', 'Members view'
        SUPERVISOR_MANAGES = 'supervisor_manages', 'Members view, supervisor manages'
        MANAGE = 'manage', 'Members manage'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name='units')
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=50, unique=True)
    supervisor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='managed_units'
    )
    is_active = models.BooleanField(default=True)
    # Who may see or manage credit clients (clients app). Managing means adding,
    # editing and importing clients and changing their limits.
    credit_client_access = models.CharField(
        max_length=20, choices=CreditClientAccess.choices, default=CreditClientAccess.NONE, blank=True,
    )

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.department.name})"


class Team(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    unit = models.ForeignKey(Unit, on_delete=models.CASCADE, related_name='teams')
    name = models.CharField(max_length=120)
    code = models.CharField(max_length=50, unique=True)
    team_lead = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='managed_teams'
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f"{self.name} ({self.unit.name})"
