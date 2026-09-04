from rest_framework.permissions import BasePermission, IsAuthenticated

from .models import SupportRequest


class IsRequester(BasePermission):
    """User is the requester of the support request."""

    def has_object_permission(self, request, view, obj: SupportRequest):
        return obj.requester == request.user


class CanManageDepartmentRequests(BasePermission):
    """User is a LINE_MANAGER in the request's department."""

    def has_object_permission(self, request, view, obj: SupportRequest):
        return _is_department_manager(request.user, obj)


class IsAssignedHandler(BasePermission):
    """User is the assigned handler of the support request."""

    def has_object_permission(self, request, view, obj: SupportRequest):
        return obj.assigned_to == request.user


class CanViewRequest(BasePermission):
    """User can view the request: requester, assigned handler, or dept manager."""

    def has_object_permission(self, request, view, obj: SupportRequest):
        if obj.requester == request.user:
            return True
        if obj.assigned_to == request.user:
            return True
        if _is_department_manager(request.user, obj):
            return True
        return False


class CanComment(BasePermission):
    """User can comment: requester, assigned handler, or department line manager."""

    def has_object_permission(self, request, view, obj: SupportRequest):
        if obj.requester == request.user:
            return True
        if obj.assigned_to == request.user:
            return True
        if _is_department_manager(request.user, obj):
            return True
        return False


class IsHandlerOrDepartmentManager(BasePermission):
    """User is either the assigned handler or a department manager.

    Combines IsAssignedHandler and CanManageDepartmentRequests via OR logic.
    """

    def has_object_permission(self, request, view, obj: SupportRequest):
        if obj.assigned_to == request.user:
            return True
        return _is_department_manager(request.user, obj)


def _is_department_manager(user, request_obj: SupportRequest) -> bool:
    """Check if user is the line manager of the request's department."""
    if not request_obj.department:
        return False
    return request_obj.department.line_manager_id == user.id


def user_is_any_department_manager(user) -> bool:
    """Check if user is a line manager for any department."""
    if not user.is_authenticated:
        return False
    return user.managed_departments.exists()
