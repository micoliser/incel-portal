from rest_framework.viewsets import ModelViewSet
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from rest_framework import status
from django.db import models
from django.utils import timezone
from applications.audit import log_audit
from notifications.services import create_notification
from notifications.models import Notification
from .models import Task, TaskActivity
from .serializers import TaskSerializer, TaskActivitySerializer
from .permissions import IsTaskAssignedOrAssigner


COMMENT_MAX_LENGTH = 200


def _display_name(user):
    return user.get_full_name() or user.username


def _comment_preview(comment_text: str, words: int = 3) -> str:
    tokens = [token for token in comment_text.split() if token]
    preview = " ".join(tokens[:words])
    if preview:
        return f"{preview}..."
    return "..."


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
        create_notification(
            recipient=task.assigned_to,
            actor=self.request.user,
            notification_type=Notification.TYPE_TASK_ASSIGNED,
            title='New Task',
            body=f'You were assigned: {task.title} by {_display_name(self.request.user)}',
            link_url=f'/tasks/{task.id}',
            payload={
                'task_id': task.id,
                'status': task.status,
                'priority': task.priority,
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
            create_notification(
                recipient=task.assigned_by,
                actor=self.request.user,
                notification_type=Notification.TYPE_TASK_STATUS_CHANGED,
                title=f'Status updated for task {task.title}',
                body=f'{_display_name(self.request.user)} changed the status to {new_status.replace("_", " ")}',
                link_url=f'/tasks/{task.id}',
                payload={
                    'task_id': task.id,
                    'old_status': old_status,
                    'new_status': new_status,
                },
            )

    @action(detail=True, methods=['get'])
    def activities(self, request, pk=None):
        task = self.get_object()
        activities = task.activities.all()
        serializer = TaskActivitySerializer(activities, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def comments(self, request, pk=None):
        task = self.get_object()
        comment_text = str(request.data.get('comment', '')).strip()

        if not comment_text:
            return Response(
                {'comment': ['Comment cannot be empty.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if len(comment_text) > COMMENT_MAX_LENGTH:
            return Response(
                {'comment': [f'Comment cannot exceed {COMMENT_MAX_LENGTH} characters.']},
                status=status.HTTP_400_BAD_REQUEST,
            )

        activity = TaskActivity.objects.create(
            task=task,
            user=request.user,
            activity_type='comment',
            comment=comment_text,
        )
        recipient = task.assigned_by if request.user == task.assigned_to else task.assigned_to
        create_notification(
            recipient=recipient,
            actor=request.user,
            notification_type=Notification.TYPE_TASK_COMMENT,
            title=f'New comment on task {task.title}',
            body=f'{_display_name(request.user)} made a new comment "{_comment_preview(comment_text, 3)}"',
            link_url=f'/tasks/{task.id}',
            payload={
                'task_id': task.id,
                'comment': comment_text,
            },
        )
        serializer = TaskActivitySerializer(activity)
        return Response(serializer.data, status=status.HTTP_201_CREATED)
