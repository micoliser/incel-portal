from rest_framework.permissions import BasePermission


class IsTaskAssignedOrAssigner(BasePermission):
    """
    Permission to allow only the assigned user or the assigning user to view/edit a task.
    """

    def has_object_permission(self, request, view, obj):
        return request.user == obj.assigned_to or request.user == obj.assigned_by

class IsRecurringScheduleAssignerOrAssignee(BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.method in {'GET', 'HEAD', 'OPTIONS'}:
            return request.user == obj.assigned_to or request.user == obj.assigned_by

        return request.user == obj.assigned_by
