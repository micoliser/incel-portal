from rest_framework.permissions import BasePermission
from common.permissions import has_admin_access, has_global_access

def is_it(user):
    if not user or not user.is_authenticated:
        return False
    profile = getattr(user, 'staff_profile', None)
    return bool(profile and profile.department and profile.department.name.upper() == 'IT')


class IsAdminOrITDepartment(BasePermission):
    """
    Permission that allows access only to ADMIN users or users in the IT department.
    """
    def has_permission(self, request, _view):
        return has_admin_access(request.user) or is_it(request.user)


class IsITOrAdminOrGlobalReadOnly(BasePermission):
    """
    IT/Admin have full access. Global Access users have read-only access.
    """
    def has_permission(self, request, _view):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return has_admin_access(request.user) or is_it(request.user) or has_global_access(request.user)
        return has_admin_access(request.user) or is_it(request.user)
