from rest_framework.permissions import BasePermission


def has_global_access(user):
    if not user or not user.is_authenticated:
        return False

    if user.is_superuser:
        return True

    profile = getattr(user, 'staff_profile', None)
    if not profile or not profile.role or not profile.role.is_active:
        return False

    # Set on the role itself (migration organization/0004 set it for ED and
    # MD), so a role's rights come from its record, not from its code.
    return profile.role.has_global_access


def has_admin_access(user):
    if not user or not user.is_authenticated:
        return False

    if user.is_superuser:
        return True

    profile = getattr(user, 'staff_profile', None)
    if not profile or not profile.role or not profile.role.is_active:
        return False

    return profile.role.code == 'ADMIN'


def can_manage_user(actor, target):
    """Whether `actor` may edit, re-role, deactivate or reset `target`.

    Superusers and executives (global access) can only be managed by a
    superuser. Without this, any administrator could reset an executive's
    password and sign in as them.
    """
    if not has_admin_access(actor):
        return False
    if actor.is_superuser:
        return True
    return not (target.is_superuser or has_global_access(target))


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
