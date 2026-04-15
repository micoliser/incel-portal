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


class IsGlobalAccessUser(BasePermission):
    def has_permission(self, request, _view):
        return has_global_access(request.user)
