from rest_framework.viewsets import ModelViewSet, ViewSet
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework.pagination import PageNumberPagination
from rest_framework import status
from rest_framework.views import APIView
from django.db import models, IntegrityError
from django.db.models import Count, Q
from django.utils import timezone
from datetime import timedelta
from django.contrib.auth.models import User
from applications.audit import log_audit
from notifications.services import create_notification
from notifications.models import Notification
from emails.services.task_emails import TaskEmailManager
from common.permissions import has_global_access
from .models import (
    RecurringSchedule, Task, TaskActivity, TaskAttachment, WeeklySummary,
    WeeklySummaryShare, WeeklySummaryUserShare, SummaryExport, UserGoal,
    DailyReport, DailyReportSubreport, DailyReportComment,
)
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
    WeeklySummarySerializer,
    WeeklySummaryListSerializer,
    # Phase 2 serializers
    WeeklySummaryComparisonSerializer,
    SummaryWithComparisonSerializer,
    WeeklySummaryUserShareSerializer,
    SummaryExportSerializer,
    UserGoalSerializer,
    GoalProgressSerializer,
    UserGoalCreateSerializer,
    OrganizationSummarySerializer,
    DailyReportCommentSerializer,
    DailyReportCreateSerializer,
    DailyReportDetailSerializer,
    DailyReportCommentCreateSerializer,
    DailyReportSubreportDetailSerializer,
    DailyReportSubreportCreateSerializer,
    DailyReportSubreportSummarySerializer,
    DailyReportSummarySerializer,
)
from .permissions import IsRecurringScheduleAssignerOrAssignee, IsTaskAssignedOrAssigner
from .services import calculate_next_run_at, create_task_with_side_effects
import logging
import secrets

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

    @action(detail=False, methods=['get'])
    def dashboard(self, request):
        """GET /tasks/dashboard/ - Dashboard task summary for the current user."""
        user = request.user
        now = timezone.now()
        due_soon_cutoff = now + timedelta(days=3)

        base_queryset = Task.objects.filter(
            models.Q(assigned_to=user) | models.Q(assigned_by=user)
        ).distinct()

        assigned_to_queryset = base_queryset.filter(assigned_to=user)
        assigned_by_queryset = base_queryset.filter(assigned_by=user)

        def build_bucket(queryset):
            counts = queryset.aggregate(
                count=Count('id'),
                pending=Count('id', filter=Q(status='pending')),
                in_progress=Count('id', filter=Q(status='in_progress')),
                completed=Count('id', filter=Q(status='completed')),
                high_priority=Count(
                    'id',
                    filter=Q(priority='high') & ~Q(status='completed'),
                ),
                due_soon_or_overdue=Count(
                    'id',
                    filter=Q(deadline__isnull=False)
                    & ~Q(status='completed')
                    & Q(deadline__lte=due_soon_cutoff),
                ),
            )

            tasks = TaskSerializer(
                queryset.select_related('assigned_by', 'assigned_to')[:5],
                many=True,
            ).data

            return {
                'count': counts['count'] or 0,
                'pending': counts['pending'] or 0,
                'in_progress': counts['in_progress'] or 0,
                'completed': counts['completed'] or 0,
                'high_priority': counts['high_priority'] or 0,
                'due_soon_or_overdue': counts['due_soon_or_overdue'] or 0,
                'tasks': tasks,
            }

        total_counts = base_queryset.aggregate(
            count=Count('id'),
            pending=Count('id', filter=Q(status='pending')),
            in_progress=Count('id', filter=Q(status='in_progress')),
            completed=Count('id', filter=Q(status='completed')),
            overdue=Count(
                'id',
                filter=Q(deadline__isnull=False)
                & ~Q(status='completed')
                & Q(deadline__lt=now),
            ),
        )

        return Response(
            {
                'assigned_to': build_bucket(assigned_to_queryset),
                'assigned_by': build_bucket(assigned_by_queryset),
                'total': {
                    'count': total_counts['count'] or 0,
                    'pending': total_counts['pending'] or 0,
                    'in_progress': total_counts['in_progress'] or 0,
                    'completed': total_counts['completed'] or 0,
                    'overdue': total_counts['overdue'] or 0,
                },
            }
        )

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
        previous_state = self._recurring_schedule_notification_state(serializer.instance)
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
        if self._recurring_schedule_notification_state(schedule) != previous_state:
            TaskEmailManager.send_recurring_task_updated_emails(schedule)
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

    @staticmethod
    def _recurring_schedule_notification_state(schedule):
        return {
            'title': schedule.title,
            'description': schedule.description,
            'priority': schedule.priority,
            'frequency': schedule.frequency,
            'interval': schedule.interval,
            'weekdays': list(schedule.weekdays or []),
            'times': list(schedule.times or []),
            'timezone': schedule.timezone,
            'deadline_offset_minutes': schedule.deadline_offset_minutes,
            'start_at': schedule.start_at,
            'end_at': schedule.end_at,
        }

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

        TaskEmailManager.send_recurring_task_ended_emails(schedule)

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

        TaskEmailManager.send_recurring_task_paused_emails(schedule)

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

        TaskEmailManager.send_recurring_task_resumed_emails(schedule)

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


def _get_week_bounds_from_start(week_start_date):
    from datetime import timedelta

    return week_start_date, week_start_date + timedelta(days=6)


def _get_current_week_bounds():
    from datetime import timedelta

    week_start = timezone.localdate() - timedelta(days=timezone.localdate().weekday())
    return week_start, week_start + timedelta(days=6)


def _get_goal_summary_data(user, week_start_date, week_end_date):
    summary = WeeklySummary.objects.filter(
        user=user,
        week_start_date=week_start_date,
    ).first()

    if summary:
        return summary.summary_data or {}

    from .services import calculate_user_weekly_summary

    return calculate_user_weekly_summary(user, week_start_date, week_end_date)


def _serialize_goals_with_progress(user, goals, week_start_date, week_end_date, summary_data):
    from .services import check_user_goals

    progress_map = check_user_goals(user, week_start_date, week_end_date, summary_data)
    serializer = UserGoalSerializer(goals, many=True)
    payload = []

    for goal in serializer.data:
        payload.append({
            **goal,
            'progress': progress_map.get(goal['metric']),
        })

    return payload


class GoalsViewSet(ViewSet):
    permission_classes = [IsAuthenticated]

    def _resolve_week(self, request):
        from datetime import datetime

        week_start_str = request.query_params.get('week_start_date') or request.data.get('week_start_date')
        if week_start_str:
            week_start = datetime.strptime(week_start_str, '%Y-%m-%d').date()
        else:
            week_start, _ = _get_current_week_bounds()

        return _get_week_bounds_from_start(week_start)

    def _list_goals_for_week(self, request, week_start, week_end):
        try:
            summary_data = _get_goal_summary_data(request.user, week_start, week_end)
        except WeeklySummary.DoesNotExist:
            return Response(
                {'error': 'Summary not found for the specified week'},
                status=status.HTTP_404_NOT_FOUND,
            )

        goals = UserGoal.objects.filter(
            user=request.user,
            is_active=True,
            period_start=week_start,
            period_end=week_end,
        ).order_by('-created_at')

        return Response({
            'week_start_date': str(week_start),
            'week_end_date': str(week_end),
            'goals': _serialize_goals_with_progress(request.user, goals, week_start, week_end, summary_data),
        })

    @action(detail=False, methods=['get'])
    def current(self, request):
        week_start, week_end = self._resolve_week(request)
        return self._list_goals_for_week(request, week_start, week_end)

    def list(self, request):
        week_start, week_end = self._resolve_week(request)
        return self._list_goals_for_week(request, week_start, week_end)

    def create(self, request):
        serializer = UserGoalCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        week_start = serializer.validated_data.get('week_start_date')
        if week_start is None:
            week_start, week_end = _get_current_week_bounds()
        else:
            week_start, week_end = _get_week_bounds_from_start(week_start)

        if UserGoal.objects.filter(
            user=request.user,
            metric=serializer.validated_data['metric'],
            period_start=week_start,
            period_end=week_end,
            is_active=True,
        ).exists():
            return Response(
                {'error': 'Goal already exists for this week and metric'},
                status=status.HTTP_409_CONFLICT,
            )

        goal = UserGoal.objects.create(
            user=request.user,
            metric=serializer.validated_data['metric'],
            target_value=serializer.validated_data['target_value'],
            period_start=week_start,
            period_end=week_end,
        )

        summary_data = _get_goal_summary_data(request.user, week_start, week_end)
        progress_map = _serialize_goals_with_progress(request.user, [goal], week_start, week_end, summary_data)
        return Response(progress_map[0], status=status.HTTP_201_CREATED)

class WeeklySummaryViewSet(ViewSet):
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['get'])
    def available_weeks(self, request):
        """GET /summaries/available-weeks/ - List available summary weeks"""
        summaries = WeeklySummary.objects.filter(user=request.user).values(
            'week_start_date', 'week_end_date', 'created_at'
        ).order_by('-week_start_date')
        return Response(summaries)

    @action(detail=False, methods=['get'])
    def summary(self, request):
        """GET /summaries/summary/?week_start_date=YYYY-MM-DD"""
        week_start_date = request.query_params.get('week_start_date')
        if not week_start_date:
            return Response(
                {'error': 'week_start_date query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            summary = WeeklySummary.objects.get(
                user=request.user,
                week_start_date=week_start_date
            )
            serializer = WeeklySummarySerializer(summary)
            return Response(serializer.data)
        except WeeklySummary.DoesNotExist:
            return Response(
                {'error': 'Summary not found for the specified week'},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=False, methods=['get'])
    def comparison_metrics(self, request):
        """GET /summaries/comparison-metrics/?week_start_date=YYYY-MM-DD - Return stored comparison metrics for a summary"""
        week_start_date = request.query_params.get('week_start_date')
        if not week_start_date:
            return Response(
                {'error': 'week_start_date query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            summary = WeeklySummary.objects.get(
                user=request.user,
                week_start_date=week_start_date
            )
            comparison = summary.comparison_metrics or {}

            # If no stored comparison metrics, attempt on-demand calculation using previous week's summary
            if not comparison:
                from datetime import datetime, timedelta
                prev_week = (datetime.strptime(week_start_date, '%Y-%m-%d').date() - timedelta(days=7))
                previous_summary = WeeklySummary.objects.filter(
                    user=request.user,
                    week_start_date=prev_week
                ).first()

                if previous_summary:
                    from .services import calculate_weekly_comparison
                    try:
                        calculated = calculate_weekly_comparison(
                            summary.summary_data,
                            previous_summary.summary_data
                        )
                        # persist for future requests
                        summary.previous_week_summary = previous_summary
                        summary.comparison_metrics = calculated
                        summary.save(update_fields=['previous_week_summary', 'comparison_metrics'])
                        comparison = calculated
                    except Exception as e:
                        return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

            if not comparison:
                return Response({}, status=status.HTTP_200_OK)

            serializer = WeeklySummaryComparisonSerializer(comparison)
            return Response(serializer.data, status=status.HTTP_200_OK)
        except WeeklySummary.DoesNotExist:
            return Response(
                {'error': 'Summary not found for the specified week'},
                status=status.HTTP_404_NOT_FOUND
            )

    @action(detail=False, methods=['get'])
    def historical(self, request):
        """GET /summaries/historical/?week_start_date=YYYY-MM-DD&weeks=4 - Return recent weekly summaries including the requested week"""
        week_start_str = request.query_params.get('week_start_date')
        weeks = int(request.query_params.get('weeks', 4))
        if not week_start_str:
            return Response(
                {'error': 'week_start_date query parameter is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            from datetime import datetime, timedelta
            week_start = datetime.strptime(week_start_str, '%Y-%m-%d').date()
            week_starts = [(week_start - timedelta(days=7 * i)) for i in range(weeks)][::-1]

            summaries = WeeklySummary.objects.filter(
                user=request.user,
                week_start_date__in=week_starts
            ).order_by('week_start_date')

            serializer = WeeklySummarySerializer(summaries, many=True)
            return Response(serializer.data)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=False, methods=['post'])
    def share(self, request):
        """POST /summaries/share/ - Create a public share link"""
        week_start_date = request.data.get('week_start_date')
        if not week_start_date:
            return Response(
                {'error': 'week_start_date is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            summary = WeeklySummary.objects.get(
                user=request.user,
                week_start_date=week_start_date
            )
        except WeeklySummary.DoesNotExist:
            return Response(
                {'error': 'Summary not found for the specified week'},
                status=status.HTTP_404_NOT_FOUND
            )

        # Generate secure token
        share_token = secrets.token_urlsafe(48)
        share = WeeklySummaryShare.objects.create(
            summary=summary,
            shared_by=request.user,
            share_token=share_token
        )

        log_audit(
            action='WEEKLY_SUMMARY_SHARED',
            request=request,
            target_type='weekly_summary',
            target_id=summary.id,
            metadata={
                'share_token': share_token,
                'week_start_date': str(week_start_date),
            },
        )

        return Response({
            'share_link': f'/summaries?token={share_token}',
            'share_token': share_token,
            'created_at': share.created_at
        }, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def share_status(self, request):
        """GET /summaries/share-status/?week_start_date=YYYY-MM-DD - returns public share info if any"""
        week_start_date = request.query_params.get('week_start_date')
        if not week_start_date:
            return Response({'error': 'week_start_date is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            summary = WeeklySummary.objects.get(user=request.user, week_start_date=week_start_date)
        except WeeklySummary.DoesNotExist:
            return Response({'error': 'Summary not found'}, status=status.HTTP_404_NOT_FOUND)

        # Return the most recent public share if exists
        public_share = WeeklySummaryShare.objects.filter(summary=summary).order_by('-created_at').first()
        if not public_share:
            return Response({'shared': False})

        return Response({'shared': True, 'share_link': f'/summaries?token={public_share.share_token}', 'share_token': public_share.share_token})

    @action(detail=False, methods=['post'])
    def revoke_share(self, request):
        """POST /summaries/revoke_share/ - Revoke a public share for a summary"""
        week_start_date = request.data.get('week_start_date')
        if not week_start_date:
            return Response({'error': 'week_start_date is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            summary = WeeklySummary.objects.get(user=request.user, week_start_date=week_start_date)
        except WeeklySummary.DoesNotExist:
            return Response({'error': 'Summary not found'}, status=status.HTTP_404_NOT_FOUND)

        # Only allow owner who created the share to revoke (shared_by == request.user)
        shares = WeeklySummaryShare.objects.filter(summary=summary)
        deleted = 0
        for s in shares:
            if s.shared_by == request.user:
                s.delete()
                deleted += 1

        return Response({'revoked': deleted > 0, 'revoked_count': deleted})

    @action(detail=False, methods=['get'])
    def user_shares(self, request):
        """GET /summaries/user-shares/?week_start_date=YYYY-MM-DD - list user-to-user shares for a summary"""
        week_start_date = request.query_params.get('week_start_date')
        if not week_start_date:
            return Response({'error': 'week_start_date is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            summary = WeeklySummary.objects.get(user=request.user, week_start_date=week_start_date)
        except WeeklySummary.DoesNotExist:
            return Response({'error': 'Summary not found'}, status=status.HTTP_404_NOT_FOUND)

        shares = WeeklySummaryUserShare.objects.filter(summary=summary).select_related('shared_with')
        serializer = WeeklySummaryUserShareSerializer(shares, many=True)
        return Response(serializer.data)

    @action(detail=False, methods=['post'])
    def revoke_user_share(self, request):
        """POST /summaries/revoke-user-share/ - revoke a user-to-user share"""
        week_start_date = request.data.get('week_start_date')
        shared_with_id = request.data.get('user_id')
        if not week_start_date or not shared_with_id:
            return Response({'error': 'week_start_date and user_id required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            summary = WeeklySummary.objects.get(user=request.user, week_start_date=week_start_date)
        except WeeklySummary.DoesNotExist:
            return Response({'error': 'Summary not found'}, status=status.HTTP_404_NOT_FOUND)

        deleted = WeeklySummaryUserShare.objects.filter(summary=summary, shared_with__id=shared_with_id, shared_by=request.user).delete()
        # delete() returns (count, {..})
        count = deleted[0] if isinstance(deleted, tuple) else int(deleted)
        return Response({'revoked': count > 0, 'revoked_count': count})

    @action(detail=False, methods=['get'])
    def shared(self, request):
        """GET /summaries/shared/{share_token}/ - View shared summary for authenticated users"""
        share_token = request.query_params.get('token')
        if not share_token:
            return Response(
                {'error': 'share_token is required'},
                status=status.HTTP_400_BAD_REQUEST
            )

        # First try public shares
        try:
            share = WeeklySummaryShare.objects.get(share_token=share_token)

            # Check if expired
            if share.expires_at and share.expires_at < timezone.now():
                return Response(
                    {'error': 'Share link has expired'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # Use SummaryWithComparisonSerializer so shared view includes comparison_metrics if present
            from .serializers import SummaryWithComparisonSerializer, WeeklySummarySerializer

            summary_serialized = SummaryWithComparisonSerializer(share.summary).data

            # Also include historical summaries (last 4 weeks including this one)
            try:
                from datetime import datetime, timedelta
                week_start = share.summary.week_start_date
                if isinstance(week_start, str):
                    week_start = datetime.strptime(week_start, '%Y-%m-%d').date()

                week_starts = [(week_start - timedelta(days=7 * i)) for i in range(4)][::-1]
                historical_qs = WeeklySummary.objects.filter(
                    user=share.summary.user,
                    week_start_date__in=week_starts
                ).order_by('week_start_date')
                historical_serialized = WeeklySummarySerializer(historical_qs, many=True).data
            except Exception:
                historical_serialized = []

            return Response({
                'summary': summary_serialized,
                'historical': historical_serialized,
            })
        except WeeklySummaryShare.DoesNotExist:
            # Not a public share, check if it's a user-scoped share token
            try:
                user_share = WeeklySummaryUserShare.objects.get(share_token=share_token)

                # Require authentication and ensure the requesting user is the intended recipient
                if not request.user or not request.user.is_authenticated:
                    return Response({'error': 'Authentication required for this share link'}, status=status.HTTP_403_FORBIDDEN)

                if user_share.shared_with != request.user:
                    return Response({'error': 'This share link is not valid for your account'}, status=status.HTTP_403_FORBIDDEN)

                from .serializers import SummaryWithComparisonSerializer, WeeklySummarySerializer

                summary_serialized = SummaryWithComparisonSerializer(user_share.summary).data

                try:
                    from datetime import datetime, timedelta
                    week_start = user_share.summary.week_start_date
                    if isinstance(week_start, str):
                        week_start = datetime.strptime(week_start, '%Y-%m-%d').date()

                    week_starts = [(week_start - timedelta(days=7 * i)) for i in range(4)][::-1]
                    historical_qs = WeeklySummary.objects.filter(
                        user=user_share.summary.user,
                        week_start_date__in=week_starts
                    ).order_by('week_start_date')
                    historical_serialized = WeeklySummarySerializer(historical_qs, many=True).data
                except Exception:
                    historical_serialized = []

                return Response({
                    'summary': summary_serialized,
                    'historical': historical_serialized,
                })
            except WeeklySummaryUserShare.DoesNotExist:
                return Response(
                    {'error': 'Invalid share link'},
                    status=status.HTTP_404_NOT_FOUND
                )

    # PHASE 2 ENDPOINTS

    @action(detail=False, methods=['get'])
    def organization_summary(self, request):
        """GET /summaries/organization-summary/ - Org-wide stats (admin only)"""
        if not request.user.is_staff:
            return Response(
                {'error': 'Admin access required'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        week_start_str = request.query_params.get('week_start_date')
        if not week_start_str:
            return Response(
                {'error': 'week_start_date parameter required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            from datetime import datetime
            week_start = datetime.strptime(week_start_str, '%Y-%m-%d').date()
            week_end = week_start + timedelta(days=6)
            
            from .services import calculate_organization_summary
            org_summary = calculate_organization_summary(week_start, week_end)
            
            serializer = OrganizationSummarySerializer(org_summary)
            return Response(serializer.data)
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )


    
    @action(detail=False, methods=['post'])
    def share_with_user(self, request):
        """POST /summaries/share-with-user/ - Share with specific user"""
        week_start_str = request.data.get('week_start_date')
        shared_with_id = request.data.get('user_id')
        
        if not week_start_str or not shared_with_id:
            return Response(
                {'error': 'week_start_date and user_id required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            from datetime import datetime
            week_start = datetime.strptime(week_start_str, '%Y-%m-%d').date()
            
            summary = WeeklySummary.objects.get(
                user=request.user,
                week_start_date=week_start
            )
            
            try:
                shared_with_user = User.objects.get(id=shared_with_id)
            except User.DoesNotExist:
                return Response(
                    {'error': 'User not found'},
                    status=status.HTTP_404_NOT_FOUND
                )
            
            from .models import WeeklySummaryUserShare
            from emails.services.summary_emails import SummaryEmailManager
            
            # Avoid duplicate shares: return existing share if present
            from django.db import transaction

            existing = WeeklySummaryUserShare.objects.filter(
                summary=summary,
                shared_with=shared_with_user
            ).first()
            if existing:
                # Re-send email when a user re-shares with the same recipient.
                try:
                    existing_summary_path = f"/summaries?token={existing.share_token}" if existing.share_token else "/summaries"
                    SummaryEmailManager.send_summary_shared_notification(
                        shared_with_user,
                        request.user,
                        str(week_start),
                        view_summary_url=existing_summary_path,
                        week_end=str(summary.week_end_date),
                    )
                except Exception:
                    logger.exception('Failed to send summary shared email for existing share')

                serializer = WeeklySummaryUserShareSerializer(existing)
                return Response(serializer.data, status=status.HTTP_200_OK)

            try:
                with transaction.atomic():
                    # generate a per-user token for recipient-scoped access
                    share_token = secrets.token_urlsafe(48)
                    share = WeeklySummaryUserShare.objects.create(
                        summary=summary,
                        shared_by=request.user,
                        shared_with=shared_with_user,
                        share_token=share_token,
                    )
            except IntegrityError as ie:
                # Likely a concurrent duplicate insert
                existing = WeeklySummaryUserShare.objects.filter(
                    summary=summary,
                    shared_with=shared_with_user
                ).first()
                if existing:
                    serializer = WeeklySummaryUserShareSerializer(existing)
                    return Response(serializer.data, status=status.HTTP_200_OK)
                raise ie
            
            # Send notification email
            try:
                summary_path = f"/summaries?token={share.share_token}"
                SummaryEmailManager.send_summary_shared_notification(
                    shared_with_user,
                    request.user,
                    str(week_start),
                    view_summary_url=summary_path,
                    week_end=str(summary.week_end_date),
                )
            except Exception:
                logger.exception('Failed to send summary shared email')

            # Create in-app notification and attempt web-push delivery
            try:
                # Use the per-user share token in the link so the recipient can open it.
                # Use a relative frontend path so the client's service worker opens the frontend route.
                summary_path = f"/summaries?token={share.share_token}"

                create_notification(
                    shared_with_user,
                    actor=request.user,
                    notification_type='summary_shared',
                    title=f"{request.user.username} shared a weekly summary",
                    body=f"{request.user.username} shared the summary for week starting {week_start} with you.",
                    link_url=summary_path,
                    payload={
                        'summary_id': str(summary.id),
                        'week_start_date': str(week_start),
                        'url': summary_path,
                    },
                    send_push=True,
                )
            except Exception:
                logger.exception('Failed to create notification for shared summary')
            
            serializer = WeeklySummaryUserShareSerializer(share)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except WeeklySummary.DoesNotExist:
            return Response(
                {'error': 'Summary not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )
    
    @action(detail=False, methods=['post'])
    def export(self, request):
        """POST /summaries/export/ - Export summary as PDF"""
        week_start_str = request.data.get('week_start_date')
        export_format = request.data.get('format', 'pdf')
        
        if not week_start_str or export_format != 'pdf':
            return Response(
                {'error': 'week_start_date and format "pdf" required (CSV export removed)'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            from datetime import datetime
            week_start = datetime.strptime(week_start_str, '%Y-%m-%d').date()
            
            summary = WeeklySummary.objects.get(
                user=request.user,
                week_start_date=week_start
            )
            
            from .models import SummaryExport
            from tasks.export_storage import generate_summary_pdf, save_export_to_s3

            filename = f"summary_{summary.id}_{week_start}.pdf"

            file_bytes = generate_summary_pdf(
                summary.summary_data,
                request.user,
                summary.comparison_metrics
            )
            content_type = 'application/pdf'

            file_url = save_export_to_s3(file_bytes, filename, content_type)

            export_record = SummaryExport.objects.create(
                summary=summary,
                exported_by=request.user,
                format='pdf',
                file_url=file_url
            )

            serializer = SummaryExportSerializer(export_record)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except WeeklySummary.DoesNotExist:
            return Response(
                {'error': 'Summary not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            logger.exception('Export failed while exporting summary')
            return Response(
                {'error': str(e)},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )
    
class SummaryFilesViewSet(ViewSet):
    """Nested viewset for files within a summary: GET /summaries/<id>/files/"""
    
    permission_classes = [IsAuthenticated]
    
    def list(self, request, summary_pk=None):
        """GET /summaries/<id>/files/?view=sent|recieved
        Returns all files attached during a week, grouped by task.
        - view=sent: files attached by the current user
        - view=recieved: files attached by others on tasks the user is involved with
        """
        view_type = request.query_params.get('view', 'sent')  # 'sent' or 'recieved'
        
        if view_type not in ['sent', 'recieved']:
            return Response(
                {'error': 'view parameter must be "sent" or "recieved"'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            summary = WeeklySummary.objects.get(id=summary_pk)
            
            # Check authorization - user must own the summary or have a valid share token
            if summary.user_id != request.user.id:
                share_token = request.query_params.get('token')
                # Allow if token matches either:
                # 1) a non-expired public share token, or
                # 2) a user-scoped share token issued specifically to this user
                from django.utils import timezone as django_timezone
                if share_token:
                    valid_public_share = WeeklySummaryShare.objects.filter(
                        summary=summary,
                        share_token=share_token,
                    ).filter(
                        models.Q(expires_at__isnull=True) | models.Q(expires_at__gt=django_timezone.now())
                    ).exists()

                    valid_user_share = WeeklySummaryUserShare.objects.filter(
                        summary=summary,
                        share_token=share_token,
                        shared_with=request.user,
                    ).exists()

                    if not (valid_public_share or valid_user_share):
                        return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)
                else:
                    return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)
            
            from datetime import datetime
            from collections import defaultdict
            
            week_start = summary.week_start_date
            week_end = summary.week_end_date
            
            if isinstance(week_start, str):
                week_start = datetime.strptime(week_start, '%Y-%m-%d').date()
            if isinstance(week_end, str):
                week_end = datetime.strptime(week_end, '%Y-%m-%d').date()
            
            # Add one day to week_end to make it inclusive
            week_end = week_end + timedelta(days=1)
            
            # Get all tasks involving this user
            tasks_qs = Task.objects.filter(
                models.Q(assigned_to=request.user) | models.Q(assigned_by=request.user)
            ).distinct()
            
            # Find all activities with attachments during the week
            if view_type == 'sent':
                # Files attached by the current user
                activities_qs = TaskActivity.objects.filter(
                    task__in=tasks_qs,
                    user=request.user,
                    created_at__gte=week_start,
                    created_at__lt=week_end
                ).prefetch_related('attachments', 'task').order_by('-created_at')
            else:  # recieved
                # Files attached by others
                activities_qs = TaskActivity.objects.filter(
                    task__in=tasks_qs,
                    created_at__gte=week_start,
                    created_at__lt=week_end
                ).exclude(user=request.user).prefetch_related('attachments', 'task').order_by('-created_at')
            
            # Group by task
            tasks_with_files = defaultdict(list)
            
            for activity in activities_qs:
                if activity.attachments.exists():
                    task = activity.task
                    for attachment in activity.attachments.all():
                        tasks_with_files[task.id].append({
                            'task_id': str(task.id),
                            'task_title': task.title,
                            'task_created_at': task.created_at.isoformat() if task.created_at else None,
                            'file_id': str(attachment.id),
                            'file_name': attachment.file_name,
                            'size': attachment.size,
                            'content_type': attachment.content_type,
                            'created_at': activity.created_at.isoformat(),
                            'created_by': activity.user.get_full_name() or activity.user.username,
                            'download_url': f'/api/attachments/{attachment.id}/download/',
                        })
            
            # Convert defaultdict to regular dict with sorted tasks
            result = {
                'week_start': summary.week_start_date.isoformat() if isinstance(summary.week_start_date, datetime) else summary.week_start_date,
                'week_end': summary.week_end_date.isoformat() if isinstance(summary.week_end_date, datetime) else summary.week_end_date,
                'view_type': view_type,
                'tasks': [
                    {
                        'task_id': task_id,
                        'task_title': tasks_with_files[task_id][0]['task_title'],
                        'task_created_at': tasks_with_files[task_id][0]['task_created_at'],
                        'files': tasks_with_files[task_id]
                    }
                    for task_id in sorted(tasks_with_files.keys(), 
                                        key=lambda tid: tasks_with_files[tid][0]['task_title'])
                ]
            }
            
            return Response(result)
        except WeeklySummary.DoesNotExist:
            return Response(
                {'error': 'Summary not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        except Exception as e:
            return Response(
                {'error': str(e)},
                status=status.HTTP_400_BAD_REQUEST
            )


def _get_staff_profile(user):
    return getattr(user, 'staff_profile', None)


def _get_user_department(user):
    profile = _get_staff_profile(user)
    return profile.department if profile else None


def _report_scope_users(user):
    queryset = User.objects.select_related('staff_profile__department').filter(is_active=True)
    if has_global_access(user):
        return queryset.filter(staff_profile__department__isnull=False).distinct()

    department = _get_user_department(user)
    if department is None:
        return User.objects.filter(id=user.id).select_related('staff_profile__department')

    return queryset.filter(staff_profile__department=department).distinct()


def _ensure_daily_reports_for_date(user, report_date):
    department = _get_user_department(user)
    if department is None and not has_global_access(user):
        raise ValueError('Department is required to access daily reports.')

    users = _report_scope_users(user)
    created_reports = []
    for member in users:
        profile = _get_staff_profile(member)
        if profile is None or profile.department is None:
            continue

        report, _ = DailyReport.objects.get_or_create(
            user=member,
            report_date=report_date,
            defaults={'department': profile.department},
        )
        created_reports.append(report)

    return created_reports


def _get_or_create_current_user_report(user, report_date):
    profile = _get_staff_profile(user)
    if profile is None or profile.department is None:
        raise ValueError('Department is required to create a daily report.')

    report, _ = DailyReport.objects.get_or_create(
        user=user,
        report_date=report_date,
        defaults={'department': profile.department},
    )
    return report


def _serialize_daily_report_detail(report):
    return DailyReportDetailSerializer(report).data


def _serialize_daily_report_summary(report):
    return DailyReportSummarySerializer(report).data


def _parse_report_date(value):
    from datetime import datetime

    if isinstance(value, datetime):
        return value.date()
    return datetime.strptime(str(value), '%Y-%m-%d').date()


class ReportsMonthCalendarView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        month_str = request.query_params.get('month')
        if not month_str:
            return Response({'error': 'month query parameter is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            from datetime import datetime, date

            month_start = datetime.strptime(month_str, '%Y-%m').date().replace(day=1)
            next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
            month_end = next_month - timedelta(days=1)
        except Exception as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        scope_users = _report_scope_users(request.user)
        reports = DailyReport.objects.filter(
            report_date__gte=month_start,
            report_date__lte=month_end,
            user__in=scope_users,
        ).values('report_date').annotate(
            report_count=Count('id'),
            subreport_count=Count('subreports', distinct=True),
        ).order_by('report_date')

        your_reports = DailyReport.objects.filter(
            user=request.user,
            report_date__gte=month_start,
            report_date__lte=month_end,
        ).values('report_date').annotate(
            report_count=Count('id'),
            subreport_count=Count('subreports', distinct=True),
        ).order_by('report_date')

        report_map = {
            str(item['report_date']): item for item in reports
        }
        your_report_map = {
            str(item['report_date']): item for item in your_reports
        }

        return Response({
            'month': month_start.strftime('%Y-%m'),
            'dates': [
                {
                    'report_date': date_str,
                    'report_count': report_map.get(date_str, {}).get('report_count', 0),
                    'subreport_count': your_report_map.get(date_str, {}).get('subreport_count', 0),
                    'has_your_report': date_str in your_report_map,
                }
                for date_str in sorted(report_map.keys())
            ],
        })


class ReportsDayView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        report_date_str = request.query_params.get('report_date')
        if not report_date_str:
            return Response({'error': 'report_date query parameter is required'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            report_date = _parse_report_date(report_date_str)
        except Exception as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        your_report = DailyReport.objects.select_related('user__staff_profile__department').prefetch_related(
            'subreports__comments__author',
            'subreports__created_by',
            'user__staff_profile__department',
        ).filter(user=request.user, report_date=report_date).first()

        scope_users = _report_scope_users(request.user)
        all_reports = DailyReport.objects.select_related('user__staff_profile__department').prefetch_related(
            'subreports',
            'user__staff_profile__department',
        ).filter(
            report_date=report_date,
            user__in=scope_users,
        ).annotate(subreport_count=Count('subreports', distinct=True)).order_by('user__first_name', 'user__last_name', 'user__username')

        return Response({
            'report_date': str(report_date),
            'your_report': _serialize_daily_report_detail(your_report) if your_report else None,
            'all_reports': DailyReportSummarySerializer(all_reports, many=True).data,
        })

    def post(self, request):
        serializer = DailyReportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        report_date = serializer.validated_data['report_date']
        try:
            daily_report = _get_or_create_current_user_report(request.user, report_date)
        except ValueError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        subreport = DailyReportSubreport.objects.create(
            daily_report=daily_report,
            title=serializer.validated_data['title'],
            created_by=request.user,
        )
        DailyReportComment.objects.create(
            subreport=subreport,
            author=request.user,
            body=serializer.validated_data['comment'],
        )

        log_audit(
            action='DAILY_REPORT_CREATED',
            request=request,
            actor_user=request.user,
            target_type='daily_report_subreport',
            target_id=str(subreport.id),
            metadata={
                'report_date': str(report_date),
                'daily_report_id': str(daily_report.id),
                'title': subreport.title,
            },
        )

        return Response(DailyReportSubreportDetailSerializer(subreport).data, status=status.HTTP_201_CREATED)


class DailyReportDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_object(self, report_id):
        return DailyReport.objects.select_related('user__staff_profile__department').prefetch_related(
            'subreports__comments__author',
            'subreports__created_by',
            'user__staff_profile__department',
        ).get(id=report_id)

    def get(self, request, report_id):
        try:
            report = self.get_object(report_id)
        except DailyReport.DoesNotExist:
            return Response({'error': 'Report not found'}, status=status.HTTP_404_NOT_FOUND)

        if not has_global_access(request.user) and report.user_id != request.user.id:
            profile = _get_user_department(request.user)
            if profile is None or report.department_id != profile.id:
                return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        return Response(_serialize_daily_report_detail(report))


class DailyReportSubreportCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, report_id):
        serializer = DailyReportSubreportCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            report = DailyReport.objects.get(id=report_id)
        except DailyReport.DoesNotExist:
            return Response({'error': 'Report not found'}, status=status.HTTP_404_NOT_FOUND)

        if report.user_id != request.user.id and not has_global_access(request.user):
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        if report.report_date != timezone.localdate():
            return Response(
                {'error': 'You can only add reports on the current day.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        subreport = DailyReportSubreport.objects.create(
            daily_report=report,
            title=serializer.validated_data['title'],
            created_by=request.user,
        )
        DailyReportComment.objects.create(
            subreport=subreport,
            author=request.user,
            body=serializer.validated_data['comment'],
        )

        return Response(DailyReportSubreportDetailSerializer(subreport).data, status=status.HTTP_201_CREATED)


class DailyReportSubreportDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get_object(self, subreport_id):
        return DailyReportSubreport.objects.select_related(
            'daily_report__user__staff_profile__department',
            'created_by__staff_profile__department',
        ).prefetch_related('comments__author').get(id=subreport_id)

    def get(self, request, subreport_id):
        try:
            subreport = self.get_object(subreport_id)
        except DailyReportSubreport.DoesNotExist:
            return Response({'error': 'Subreport not found'}, status=status.HTTP_404_NOT_FOUND)

        if not has_global_access(request.user) and subreport.daily_report.user_id != request.user.id:
            profile = _get_user_department(request.user)
            if profile is None or subreport.daily_report.department_id != profile.id:
                return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        return Response(DailyReportSubreportDetailSerializer(subreport).data)


class DailyReportSubreportCommentView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, subreport_id):
        serializer = DailyReportCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            subreport = DailyReportSubreport.objects.select_related('daily_report__user').get(id=subreport_id)
        except DailyReportSubreport.DoesNotExist:
            return Response({'error': 'Subreport not found'}, status=status.HTTP_404_NOT_FOUND)

        if not has_global_access(request.user) and subreport.daily_report.user_id != request.user.id:
            return Response({'error': 'Forbidden'}, status=status.HTTP_403_FORBIDDEN)

        if subreport.daily_report.report_date != timezone.localdate():
            return Response(
                {'error': 'You can only add comments on the current day.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        comment = DailyReportComment.objects.create(
            subreport=subreport,
            author=request.user,
            body=serializer.validated_data['body'],
        )

        return Response(DailyReportCommentSerializer(comment).data, status=status.HTTP_201_CREATED)
