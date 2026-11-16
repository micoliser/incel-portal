from rest_framework.permissions import BasePermission


def has_global_access(user):
    if not user or not user.is_authenticated:
        return False

    if user.is_superuser:
        return True

    profile = getattr(user, 'staff_profile', None)
    if not profile or not profile.role:
        return False

    if profile.role.has_global_access:
        return True

    return profile.role.code in {'ED', 'MD'}


def has_admin_access(user):
    if not user or not user.is_authenticated:
        return False

    if user.is_superuser:
        return True

    profile = getattr(user, 'staff_profile', None)
    if not profile or not profile.role:
        return False

    return profile.role.code == 'ADMIN'


class IsAdminUser(BasePermission):
    def has_permission(self, request, _view):
        return has_admin_access(request.user)


class IsAdminOrGlobalAccessUser(BasePermission):
    """Administrators and executives only, for every method.

    Use this for sensitive read endpoints such as the audit log.
    """

    def has_permission(self, request, _view):
        return has_admin_access(request.user) or has_global_access(request.user)


class IsAdminOrGlobalReadOnly(BasePermission):
    def has_permission(self, request, _view):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return has_global_access(request.user)
        return has_admin_access(request.user)


class IsAdminOrAuthenticatedReadOnly(BasePermission):
    """Any signed-in user may read; only administrators may write.

    Only use this where every GET on the view is safe for all staff. Adding a
    GET to a view that uses it exposes that data to everyone, which is how the
    audit log was once readable by all users.
    """

    def has_permission(self, request, _view):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return bool(request.user and request.user.is_authenticated)
        return has_admin_access(request.user)
