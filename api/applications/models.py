from django.conf import settings
from django.db import models
from django.utils import timezone

from common.models import TimeStampedModel


class InternalApplication(TimeStampedModel):
    class Status(models.TextChoices):
        ACTIVE = 'ACTIVE', 'Active'
        INACTIVE = 'INACTIVE', 'Inactive'
        MAINTENANCE = 'MAINTENANCE', 'Maintenance'

    class AccessScope(models.TextChoices):
        ALL_AUTHENTICATED = 'ALL_AUTHENTICATED', 'All Authenticated Users'
        RESTRICTED = 'RESTRICTED', 'Restricted'

    class VisibilityScope(models.TextChoices):
        VISIBLE_TO_ALL = 'VISIBLE_TO_ALL', 'Visible To All'
        HIDDEN = 'HIDDEN', 'Hidden'

    name = models.CharField(max_length=150)
    slug = models.SlugField(max_length=180, unique=True)
    description = models.TextField(blank=True)
    app_url = models.URLField(max_length=500)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    access_scope = models.CharField(
        max_length=30,
        choices=AccessScope.choices,
        default=AccessScope.RESTRICTED,
    )
    visibility_scope = models.CharField(
        max_length=30,
        choices=VisibilityScope.choices,
        default=VisibilityScope.VISIBLE_TO_ALL,
    )
    departments = models.ManyToManyField(
        'organization.Department',
        related_name='applications',
        blank=True,
        help_text='Departments allowed for restricted access applications.',
    )

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class ApplicationAccessOverride(TimeStampedModel):
    class Effect(models.TextChoices):
        ALLOW = 'ALLOW', 'Allow'
        DENY = 'DENY', 'Deny'

    application = models.ForeignKey(
        InternalApplication,
        on_delete=models.CASCADE,
        related_name='overrides',
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='application_overrides',
    )
    effect = models.CharField(max_length=10, choices=Effect.choices)
    reason = models.TextField(blank=True)
    expires_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        unique_together = ('application', 'user')

    def is_active(self):
        return self.expires_at is None or self.expires_at > timezone.now()

    def __str__(self):
        return f"{self.user} {self.effect} {self.application}"


class AuditLog(TimeStampedModel):
    actor_user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='audit_logs',
        null=True,
        blank=True,
    )
    action = models.CharField(max_length=100, db_index=True)
    target_type = models.CharField(max_length=100, blank=True, db_index=True)
    target_id = models.CharField(max_length=64, blank=True, db_index=True)
    metadata_json = models.JSONField(blank=True, null=True)
    ip_address = models.GenericIPAddressField(blank=True, null=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        actor = self.actor_user.get_username() if self.actor_user else 'system'
        return f"{self.action} by {actor}"
