from django.db.models import Q
from django.utils import timezone

from applications.models import ApplicationAccessOverride
from common.permissions import has_global_access


def can_user_access_application(user, application):
    if not user or not user.is_authenticated:
        return False, 'Authentication required.'

    if has_global_access(user):
        return True, 'Global role access.'

    now = timezone.now()
    active_override = ApplicationAccessOverride.objects.filter(
        application=application,
        user=user,
    ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now)).first()

    if active_override:
        if active_override.effect == ApplicationAccessOverride.Effect.DENY:
            return False, 'Access explicitly denied.'
        return True, 'Access explicitly allowed.'

    if application.access_scope == application.AccessScope.ALL_AUTHENTICATED:
        return True, 'Application is open to all authenticated users.'

    profile = getattr(user, 'staff_profile', None)
    if not profile:
        return False, 'No staff profile assigned.'
    if not profile.department_id:
        return False, 'No department assigned.'

    user_department_ids = {profile.department_id}
    app_department_ids = set(application.departments.values_list('id', flat=True))

    if user_department_ids.intersection(app_department_ids):
        return True, 'Department access granted.'

    return False, 'Department access not granted.'


def user_access_payload(user, application):
    can_access, reason = can_user_access_application(user, application)
    return {
        'application_id': application.id,
        'can_access': can_access,
        'reason': reason,
    }
