from rest_framework.permissions import BasePermission
from common.permissions import has_admin_access

class IsAdminOrITDepartment(BasePermission):
    """
    Permission that allows access only to ADMIN users or users in the IT department.
    """
    def has_permission(self, request, _view):
        if not request.user or not request.user.is_authenticated:
            return False
            
        if has_admin_access(request.user):
            return True
            
        profile = getattr(request.user, 'staff_profile', None)
        if profile and profile.department and profile.department.name.upper() == 'IT':
            return True
            
        return False
