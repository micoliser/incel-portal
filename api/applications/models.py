import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from common.models import TimeStampedModel


class InternalApplication(TimeStampedModel):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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
    logo_url = models.URLField(max_length=500, blank=True, null=True)
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
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
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


class RecentApplication(TimeStampedModel):
    """Records when a user last opened an application.

    We enforce uniqueness on (user, application) so that repeated opens update
    the timestamp rather than creating duplicates. The dashboard will query
    the most recent 4 entries per user ordered by `opened_at` (alias to
    `updated_at` from TimeStampedModel) to display recently opened apps.
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='recent_applications',
    )
    application = models.ForeignKey(
        InternalApplication,
        on_delete=models.CASCADE,
        related_name='recent_entries',
    )
    opened_at = models.DateTimeField(default=timezone.now)

    class Meta:
        unique_together = (('user', 'application'),)
        indexes = [models.Index(fields=['user', 'opened_at']),]

    def save(self, *args, **kwargs):
        # Keep opened_at fresh on every save unless explicitly set
        self.opened_at = timezone.now()
        super().save(*args, **kwargs)

    def __str__(self):
        return f"RecentApplication user={self.user_id} app={self.application_id} at={self.opened_at}"
