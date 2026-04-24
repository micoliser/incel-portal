from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from django.db import models
from django.utils import timezone
from applications.audit import log_audit
from .models import Task, TaskActivity
from .serializers import TaskSerializer, TaskActivitySerializer
from .permissions import IsTaskAssignedOrAssigner


class TaskPagination(PageNumberPagination):
    page_size = 20


class TaskViewSet(ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = TaskPagination

    def get_queryset(self):
        user = self.request.user
        queryset = Task.objects.filter(
            models.Q(assigned_to=user) | models.Q(assigned_by=user)
        ).distinct()

        view_filter = (self.request.query_params.get('view') or '').strip()
        if view_filter == 'assigned':
            queryset = queryset.filter(assigned_to=user)
        elif view_filter == 'created':
            queryset = queryset.filter(assigned_by=user)

        statuses_raw = (self.request.query_params.get('status') or '').strip()
        if statuses_raw:
            status_values = [value.strip() for value in statuses_raw.split(',') if value.strip()]
            allowed_statuses = {choice[0] for choice in Task.STATUS_CHOICES}
            valid_statuses = [value for value in status_values if value in allowed_statuses]
            if valid_statuses:
                queryset = queryset.filter(status__in=valid_statuses)

        priorities_raw = (self.request.query_params.get('priority') or '').strip()
        if priorities_raw:
            priority_values = [value.strip() for value in priorities_raw.split(',') if value.strip()]
            allowed_priorities = {choice[0] for choice in Task.PRIORITY_CHOICES}
            valid_priorities = [value for value in priority_values if value in allowed_priorities]
            if valid_priorities:
                queryset = queryset.filter(priority__in=valid_priorities)

        return queryset

    def get_permissions(self):
        if self.action in ['list', 'create']:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsTaskAssignedOrAssigner()]

    def perform_create(self, serializer):
        task = serializer.save(assigned_by=self.request.user)
        TaskActivity.objects.create(
            task=task,
            user=self.request.user,
            activity_type='created',
            comment=f'Task created by {self.request.user.get_full_name()}',
        )
        log_audit(
            action='TASK_CREATED',
            request=self.request,
            target_type='task',
            target_id=task.id,
            metadata={
                'title': task.title,
                'assigned_by_id': task.assigned_by_id,
                'assigned_to_id': task.assigned_to_id,
                'priority': task.priority,
                'status': task.status,
            },
        )

    def perform_update(self, serializer):
        old_task = self.get_object()
        old_status = old_task.status
        task = serializer.save()

        if old_status != task.status:
            new_status = task.status
            if new_status == 'completed':
                task.completed_at = timezone.now()
                task.save(update_fields=['completed_at'])

            TaskActivity.objects.create(
                task=task,
                user=self.request.user,
                activity_type='status_change',
                old_value=old_status,
                new_value=new_status,
            )
            log_audit(
                action='TASK_STATUS_CHANGED',
                request=self.request,
                target_type='task',
                target_id=task.id,
                metadata={
                    'old_status': old_status,
                    'new_status': new_status,
                    'assigned_to_id': task.assigned_to_id,
                },
            )

    @action(detail=True, methods=['get'])
    def activities(self, request, pk=None):
        task = self.get_object()
        activities = task.activities.all()
        serializer = TaskActivitySerializer(activities, many=True)
        return Response(serializer.data)
