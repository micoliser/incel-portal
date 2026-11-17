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


def visible_applications(user, queryset=None):
    """The applications a user is allowed to know about.

    A hidden application (which is also what deleting one makes it) exists only
    for administrators. Everyone else neither sees it listed nor can open it.
    """
    from applications.models import InternalApplication
    from common.permissions import has_admin_access

    if queryset is None:
        queryset = InternalApplication.objects.all()
    if has_admin_access(user):
        return queryset
    return queryset.filter(visibility_scope=InternalApplication.VisibilityScope.VISIBLE_TO_ALL)


def access_for_applications(user, applications):
    """`{application.id: (can_access, reason)}` for many applications at once.

    Same rules as can_user_access_application, but the user's overrides and the
    applications' departments are each read once instead of once per application.
    Pass applications loaded with prefetch_related('departments').
    """
    applications = list(applications)
    if not user or not user.is_authenticated:
        return {app.id: (False, 'Authentication required.') for app in applications}
    if has_global_access(user):
        return {app.id: (True, 'Global role access.') for app in applications}

    now = timezone.now()
    overrides = {
        override.application_id: override
        for override in ApplicationAccessOverride.objects.filter(
            user=user,
            application__in=applications,
        ).filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
    }
    profile = getattr(user, 'staff_profile', None)
    department_id = getattr(profile, 'department_id', None)

    result = {}
    for app in applications:
        override = overrides.get(app.id)
        if override is not None:
            if override.effect == ApplicationAccessOverride.Effect.DENY:
                result[app.id] = (False, 'Access explicitly denied.')
            else:
                result[app.id] = (True, 'Access explicitly allowed.')
        elif app.access_scope == app.AccessScope.ALL_AUTHENTICATED:
            result[app.id] = (True, 'Application is open to all authenticated users.')
        elif not profile:
            result[app.id] = (False, 'No staff profile assigned.')
        elif not department_id:
            result[app.id] = (False, 'No department assigned.')
        elif department_id in {department.id for department in app.departments.all()}:
            result[app.id] = (True, 'Department access granted.')
        else:
            result[app.id] = (False, 'Department access not granted.')
    return result
