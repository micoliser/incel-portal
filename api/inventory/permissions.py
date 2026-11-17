from rest_framework.permissions import BasePermission

from common.permissions import has_admin_access, has_global_access


def can_manage_inventory(user):
    """Members of a department responsible for company assets."""
    if not user or not user.is_authenticated:
        return False
    profile = getattr(user, 'staff_profile', None)
    return bool(profile and profile.department and profile.department.manages_inventory)


# Kept for callers that still use the old name.
is_it = can_manage_inventory


class IsITOrAdminOrGlobalReadOnly(BasePermission):
    """
    IT/Admin have full access. Global Access users have read-only access.
    """
    def has_permission(self, request, _view):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return has_admin_access(request.user) or can_manage_inventory(request.user) or has_global_access(request.user)
        return has_admin_access(request.user) or can_manage_inventory(request.user)
