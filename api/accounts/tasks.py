from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from applications.audit_actions import AuditAction
from applications.models import AuditLog


@shared_task(name='accounts.flush_expired_tokens')
def flush_expired_tokens():
    """Delete refresh-token records that have expired (their blacklist rows go with them)."""
    deleted, _ = OutstandingToken.objects.filter(expires_at__lte=timezone.now()).delete()
    return deleted


@shared_task(name='accounts.prune_auth_failure_audit_logs')
def prune_auth_failure_audit_logs():
    """Delete old failed sign-in and failed password-reset audit rows.

    Anyone on the internet can cause these rows, so they are kept for a limited
    time. Every other audit row is kept.
    """
    cutoff = timezone.now() - timedelta(days=settings.AUDIT_AUTH_FAILURE_RETENTION_DAYS)
    deleted, _ = AuditLog.objects.filter(
        action__in=[AuditAction.AUTH_LOGIN_FAILED, AuditAction.AUTH_PASSWORD_RESET_FAILED],
        created_at__lt=cutoff,
    ).delete()
    return deleted
