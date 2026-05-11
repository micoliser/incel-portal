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
from .models import RecurringSchedule, Task, TaskActivity, TaskAttachment
from .s3 import (
    TaskAttachmentStorageError,
    build_task_attachment_key_prefix,
    generate_task_attachment_upload_url,
)
from .serializers import (
    TaskAttachmentUploadRequestSerializer,
    TaskCommentCreateSerializer,
    RecurringScheduleSerializer,
    TaskSerializer,
    TaskActivitySerializer,
)
from .permissions import IsRecurringScheduleAssignerOrAssignee, IsTaskAssignedOrAssigner
from .services import calculate_next_run_at, create_task_with_side_effects
import logging

logger = logging.getLogger(__name__)


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
        task = create_task_with_side_effects(
            assigner=self.request.user,
            assignee=serializer.validated_data['assigned_to'],
            title=serializer.validated_data['title'],
            description=serializer.validated_data.get('description', ''),
            priority=serializer.validated_data['priority'],
            deadline=serializer.validated_data['deadline'],
            request=self.request,
        )
        serializer.instance = task

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

    @action(detail=True, methods=['post'], url_path='attachment-upload-url')
    def attachment_upload_url(self, request, pk=None):
        task = self.get_object()
        serializer = TaskAttachmentUploadRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            payload = generate_task_attachment_upload_url(
                task_id=task.id,
                file_name=serializer.validated_data['file_name'],
                content_type=serializer.validated_data['content_type'],
            )
        except TaskAttachmentStorageError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(payload)

    @action(detail=True, methods=['get'])
    def activities(self, request, pk=None):
        task = self.get_object()
        activities = task.activities.all()
        serializer = TaskActivitySerializer(activities, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def comments(self, request, pk=None):
        task = self.get_object()
        serializer = TaskCommentCreateSerializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except Exception as exc:
            # print validation errors to aid debugging in tests
            try:
                import json
                detail = getattr(exc, 'detail', None) or getattr(serializer, 'errors', None)
                logger.debug('Comment create validation errors: %s', json.dumps(detail, default=str))
            except Exception:
                logger.exception('Comment create validation exception')
            raise

        attachments_data = serializer.validated_data.get('attachments')
        if attachments_data:
            expected_prefix = build_task_attachment_key_prefix(task.id)
            # Accept either configured prefix (which may include env prefix) or the bare 'task-attachments/<id>/'
            alt_prefix = None
            if '/' in expected_prefix:
                alt_prefix = expected_prefix.split('/', 1)[-1]
                if not alt_prefix.endswith('/'):
                    alt_prefix = alt_prefix + '/'
            logger.debug('expected_prefix=%s alt_prefix=%s', expected_prefix, alt_prefix)
            for attachment_data in attachments_data:
                key = str(attachment_data['object_key'])
                ok = key.startswith(expected_prefix) or (alt_prefix and key.startswith(alt_prefix))
                logger.debug('attachment key=%s ok=%s', key, ok)
                if not ok:
                    return Response(
                        {'attachments': ['One or more attachment keys do not belong to this task.']},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        activity = TaskActivity.objects.create(
            task=task,
            user=request.user,
            activity_type='comment',
            comment=serializer.validated_data['comment'],
        )

        if attachments_data:
            for attachment_data in attachments_data:
                TaskAttachment.objects.create(
                    activity=activity,
                    object_key=attachment_data['object_key'],
                    file_name=attachment_data['file_name'],
                    content_type=attachment_data['content_type'],
                    size=attachment_data['size'],
                )

        recipient = task.assigned_by if request.user == task.assigned_to else task.assigned_to
        notification_body = f'{_display_name(request.user)} made a new comment "{_comment_preview(serializer.validated_data["comment"], 3)}"'
        if attachments_data:
            attachment_count = len(attachments_data)
            files_text = "file" if attachment_count == 1 else "files"
            notification_body += f' [{attachment_count} {files_text} attached]'
        create_notification(
            recipient=recipient,
            actor=request.user,
            notification_type=Notification.TYPE_TASK_COMMENT,
            title=f'New comment on task {task.title}',
            body=notification_body,
            link_url=f'/tasks/{task.id}',
            payload={
                'task_id': task.id,
                'comment_id': str(activity.id),
            },
        )

        response_serializer = TaskActivitySerializer(activity)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)


class RecurringSchedulePagination(PageNumberPagination):
    page_size = 20


class RecurringScheduleViewSet(ModelViewSet):
    serializer_class = RecurringScheduleSerializer
    permission_classes = [IsAuthenticated, IsRecurringScheduleAssignerOrAssignee]
    pagination_class = RecurringSchedulePagination

    def get_queryset(self):
        user = self.request.user
        return RecurringSchedule.objects.filter(
            models.Q(assigned_to=user) | models.Q(assigned_by=user)
        ).distinct()

    def perform_create(self, serializer):
        schedule = serializer.save(assigned_by=self.request.user)
        schedule.next_run_at = calculate_next_run_at(schedule, reference=timezone.now())
        if schedule.end_at and schedule.next_run_at and schedule.next_run_at > schedule.end_at:
            schedule.is_active = False
            schedule.ended_at = schedule.ended_at or timezone.now()
            schedule.next_run_at = None
        schedule.save()
        log_audit(
            action='TASK_RECURRING_SCHEDULE_CREATED',
            request=self.request,
            target_type='recurring_schedule',
            target_id=schedule.id,
            metadata={
                'title': schedule.title,
                'assigned_by_id': schedule.assigned_by_id,
                'assigned_to_id': schedule.assigned_to_id,
                'frequency': schedule.frequency,
                'interval': schedule.interval,
                'timezone': schedule.timezone,
            },
        )

    def perform_update(self, serializer):
        schedule = serializer.save()
        if schedule.is_active and not schedule.is_paused:
            schedule.next_run_at = calculate_next_run_at(schedule, reference=timezone.now())
            if schedule.end_at and schedule.next_run_at and schedule.next_run_at > schedule.end_at:
                schedule.is_active = False
                schedule.ended_at = schedule.ended_at or timezone.now()
                schedule.next_run_at = None
                schedule.is_paused = False
                schedule.paused_at = None
                schedule.paused_by = None
        else:
            schedule.next_run_at = None
            schedule.is_paused = False
            schedule.paused_at = None
            schedule.paused_by = None
        schedule.save()
        log_audit(
            action='TASK_RECURRING_SCHEDULE_UPDATED',
            request=self.request,
            target_type='recurring_schedule',
            target_id=schedule.id,
            metadata={
                'title': schedule.title,
                'assigned_by_id': schedule.assigned_by_id,
                'assigned_to_id': schedule.assigned_to_id,
                'frequency': schedule.frequency,
                'interval': schedule.interval,
                'timezone': schedule.timezone,
            },
        )

    def _ensure_creator(self, schedule):
        if self.request.user != schedule.assigned_by:
            return Response(
                {'detail': 'Only the schedule creator can update it.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None

    @action(detail=True, methods=['post'], url_path='end')
    def end(self, request, pk=None):
        schedule = self.get_object()
        if request.user != schedule.assigned_by:
            return Response({'detail': 'Only the schedule creator can end it.'}, status=status.HTTP_403_FORBIDDEN)

        schedule.is_active = False
        schedule.is_paused = False
        schedule.paused_at = None
        schedule.paused_by = None
        schedule.ended_at = timezone.now()
        schedule.ended_by = request.user
        schedule.next_run_at = None
        schedule.save()

        log_audit(
            action='TASK_RECURRING_SCHEDULE_ENDED',
            request=request,
            target_type='recurring_schedule',
            target_id=schedule.id,
            metadata={
                'title': schedule.title,
                'assigned_by_id': schedule.assigned_by_id,
                'assigned_to_id': schedule.assigned_to_id,
            },
        )
        return Response(self.get_serializer(schedule).data)

    @action(detail=True, methods=['post'], url_path='pause')
    def pause(self, request, pk=None):
        schedule = self.get_object()
        if request.user != schedule.assigned_by:
            return Response({'detail': 'Only the schedule creator can pause it.'}, status=status.HTTP_403_FORBIDDEN)

        if not schedule.is_active:
            return Response({'detail': 'This recurring schedule has ended and cannot be paused.'}, status=status.HTTP_400_BAD_REQUEST)

        if schedule.is_paused:
            return Response(self.get_serializer(schedule).data)

        now = timezone.now()
        schedule.is_paused = True
        schedule.paused_at = now
        schedule.paused_by = request.user
        schedule.save(update_fields=['is_paused', 'paused_at', 'paused_by', 'updated_at'])

        log_audit(
            action='TASK_RECURRING_SCHEDULE_PAUSED',
            request=request,
            target_type='recurring_schedule',
            target_id=schedule.id,
            metadata={
                'title': schedule.title,
                'assigned_by_id': schedule.assigned_by_id,
                'assigned_to_id': schedule.assigned_to_id,
            },
        )

        return Response(self.get_serializer(schedule).data)

    @action(detail=True, methods=['post'], url_path='resume')
    def resume(self, request, pk=None):
        schedule = self.get_object()
        if request.user != schedule.assigned_by:
            return Response({'detail': 'Only the schedule creator can resume it.'}, status=status.HTTP_403_FORBIDDEN)

        if not schedule.is_active:
            return Response({'detail': 'This recurring schedule has ended and cannot be resumed.'}, status=status.HTTP_400_BAD_REQUEST)

        if not schedule.is_paused:
            return Response(self.get_serializer(schedule).data)

        now = timezone.now()
        if schedule.end_at and schedule.end_at <= now:
            return Response(
                {'detail': 'This recurring schedule has expired and cannot be resumed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        next_run_at = calculate_next_run_at(schedule, reference=now)
        if next_run_at is None:
            return Response(
                {'detail': 'No future runs remain for this recurring schedule.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if schedule.end_at and next_run_at > schedule.end_at:
            return Response(
                {'detail': 'No future runs remain before the end date.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        schedule.is_paused = False
        schedule.paused_at = None
        schedule.paused_by = None
        schedule.next_run_at = next_run_at
        schedule.save(update_fields=['is_paused', 'paused_at', 'paused_by', 'next_run_at', 'updated_at'])

        log_audit(
            action='TASK_RECURRING_SCHEDULE_RESUMED',
            request=request,
            target_type='recurring_schedule',
            target_id=schedule.id,
            metadata={
                'title': schedule.title,
                'assigned_by_id': schedule.assigned_by_id,
                'assigned_to_id': schedule.assigned_to_id,
                'next_run_at': next_run_at.isoformat(),
            },
        )

        return Response(self.get_serializer(schedule).data)
