from rest_framework import permissions
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission

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
    message = 'Only the schedule creator can change it.'

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


class IsTaskAssigner(BasePermission):
    """Only the person who assigned the task (approve and reject)."""

    message = 'Only the assigner can approve or reject task completion.'

    def has_object_permission(self, request, view, obj):
        return request.user.id == obj.assigned_by_id


TASK_DETAIL_FIELDS = ('title', 'description', 'priority', 'deadline')


def require_may_change_task(user, task, changes):
    """Who may change what on a task. Raises PermissionDenied.

    This is only about *who*; whether the change itself is valid (for example
    an allowed status transition) is the serializer's job.
    - The assigner edits the details and gives the final verdict (completed).
    - The assignee moves the work along (in progress, under review).
    """
    is_assigner = user.id == task.assigned_by_id
    is_assignee = user.id == task.assigned_to_id

    changes_details = any(field in changes and getattr(task, field) != changes[field] for field in TASK_DETAIL_FIELDS)
    if changes_details and not is_assigner:
        raise PermissionDenied('Only the assigner can edit task details.')

    new_status = changes.get('status')
    if new_status is None or new_status == task.status:
        return

    if not is_assigner and not is_assignee:
        raise PermissionDenied('You do not have permission to change this task status.')
    if is_assignee and not is_assigner and new_status == 'completed':
        raise PermissionDenied('Only the assigner can approve and finalize task completion.')
    if is_assigner and not is_assignee and task.status != 'under_review' and new_status != 'completed':
        raise PermissionDenied('Only the assignee can change task progress.')
