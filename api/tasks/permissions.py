from rest_framework import permissions
from rest_framework.permissions import BasePermission
from common.permissions import has_global_access
from .hierarchy import has_task_oversight


class IsTaskAssignedOrAssigner(BasePermission):
    """
    Permission to allow:
    - Assigner or Assignee full task interactions according to their role.
    - Managers/Execs with oversight read-only access (GET/HEAD/OPTIONS) plus commenting and attachment uploads.
    - Status changes, detail editing, approval, and rejection remain restricted to assigner/assignee.
    """

    def has_object_permission(self, request, view, obj):
        # Assigner or Assignee has base access
        if request.user.id == obj.assigned_to_id or request.user.id == obj.assigned_by_id:
            return True

        # Check managerial oversight
        if has_task_oversight(request.user, obj):
            if request.method in permissions.SAFE_METHODS:
                return True
            # Allow posting comments and requesting attachment upload URLs
            if getattr(view, 'action', None) in ['comments', 'attachment_upload_url', 'activities']:
                return True

        return False


class IsRecurringScheduleAssignerOrAssignee(BasePermission):
    """
    Permission for recurring task schedules:
    - Read-only access for Assignee and Managers with oversight.
    - Management (Edit, Pause, Resume, End) strictly restricted to Assigner.
    """

    def has_object_permission(self, request, view, obj):
        if request.user.id == obj.assigned_to_id or request.user.id == obj.assigned_by_id:
            if request.method in permissions.SAFE_METHODS:
                return True
            return request.user.id == obj.assigned_by_id

        if has_task_oversight(request.user, obj):
            return request.method in permissions.SAFE_METHODS

        return False
