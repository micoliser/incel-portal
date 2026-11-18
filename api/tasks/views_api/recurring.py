"""Recurring task schedules."""

import logging

from django.db import models, transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from audit import log_audit
from audit.actions import AuditAction
from common.permissions import has_global_access
from common.viewsets import (
    CreateModelMixin,
    GenericViewSet,
    ListModelMixin,
    PartialUpdateModelMixin,
    RetrieveModelMixin,
)
from emails.services.task_emails import TaskEmailManager

from ..hierarchy import get_subordinate_user_ids
from ..models import (
    RecurringSchedule,
)
from ..permissions import IsRecurringScheduleAssignerOrAssignee
from ..serializers import (
    RecurringScheduleSerializer,
)
from ..services import calculate_next_run_at

logger = logging.getLogger(__name__)

class RecurringScheduleViewSet(
    ListModelMixin,
    RetrieveModelMixin,
    CreateModelMixin,
    PartialUpdateModelMixin,
    GenericViewSet,
):
    serializer_class = RecurringScheduleSerializer
    permission_classes = [IsAuthenticated, IsRecurringScheduleAssignerOrAssignee]
    # No DELETE: a schedule is stopped with the audited `end` action, which
    # keeps its history. Deleting would silently drop its occurrences.
    lookup_value_converter = 'uuid'

    def get_queryset(self):
        user = self.request.user
        if not user or not user.is_authenticated:
            return RecurringSchedule.objects.none()

        subordinate_ids = get_subordinate_user_ids(user)
        if has_global_access(user):
            base_query = models.Q()
        elif subordinate_ids:
            base_query = (
                models.Q(assigned_to=user)
                | models.Q(assigned_by=user)
                | models.Q(assigned_to_id__in=subordinate_ids)
                | models.Q(assigned_by_id__in=subordinate_ids)
            )
        else:
            base_query = models.Q(assigned_to=user) | models.Q(assigned_by=user)

        return RecurringSchedule.objects.filter(base_query).distinct()

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # `assigned_to_ids` for several people, or `assigned_to_id` for one.
        assignees = serializer.validated_data.get('assigned_to_ids') or [serializer.validated_data['assigned_to']]

        with transaction.atomic():
            created_schedules = []
            validated = dict(serializer.validated_data)
            validated.pop('assigned_to_ids', None)
            for assignee in assignees:
                schedule_data = dict(validated)
                schedule_data['assigned_by'] = request.user
                schedule_data['assigned_to'] = assignee
                schedule = RecurringSchedule.objects.create(**schedule_data)
                schedule.next_run_at = calculate_next_run_at(schedule, reference=timezone.now())
                if schedule.end_at and schedule.next_run_at and schedule.next_run_at > schedule.end_at:
                    schedule.is_active = False
                    schedule.ended_at = schedule.ended_at or timezone.now()
                    schedule.next_run_at = None
                schedule.save()
                log_audit(
                    action=AuditAction.TASK_RECURRING_SCHEDULE_CREATED,
                    request=request,
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
                created_schedules.append(schedule)

        # One schedule per assignee, so the response is always a list.
        serialized = RecurringScheduleSerializer(created_schedules, many=True, context={'request': request}).data
        return Response({'count': len(serialized), 'results': serialized}, status=status.HTTP_201_CREATED)

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
            action=AuditAction.TASK_RECURRING_SCHEDULE_UPDATED,
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

    @action(detail=True, methods=['post'], url_path='end')
    def end(self, request, pk=None):
        schedule = self.get_object()

        if not schedule.is_active or schedule.ended_at is not None:
            raise ValidationError('This recurring schedule has already ended.')

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
            action=AuditAction.TASK_RECURRING_SCHEDULE_ENDED,
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

        if not schedule.is_active or schedule.ended_at is not None:
            raise ValidationError('This recurring schedule has ended and cannot be paused.')

        if schedule.is_paused:
            return Response(self.get_serializer(schedule).data)

        now = timezone.now()
        schedule.is_paused = True
        schedule.paused_at = now
        schedule.paused_by = request.user
        schedule.save(update_fields=['is_paused', 'paused_at', 'paused_by', 'updated_at'])

        TaskEmailManager.send_recurring_task_paused_emails(schedule)

        log_audit(
            action=AuditAction.TASK_RECURRING_SCHEDULE_PAUSED,
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

        if not schedule.is_active or schedule.ended_at is not None:
            raise ValidationError('This recurring schedule has ended and cannot be resumed.')

        if not schedule.is_paused:
            return Response(self.get_serializer(schedule).data)

        now = timezone.now()
        if schedule.end_at and schedule.end_at <= now:
            raise ValidationError('This recurring schedule has expired and cannot be resumed.')

        next_run_at = calculate_next_run_at(schedule, reference=now)
        if next_run_at is None:
            raise ValidationError('No future runs remain for this recurring schedule.')

        if schedule.end_at and next_run_at > schedule.end_at:
            raise ValidationError('No future runs remain before the end date.')

        schedule.is_paused = False
        schedule.paused_at = None
        schedule.paused_by = None
        schedule.next_run_at = next_run_at
        schedule.save(update_fields=['is_paused', 'paused_at', 'paused_by', 'next_run_at', 'updated_at'])

        TaskEmailManager.send_recurring_task_resumed_emails(schedule)

        log_audit(
            action=AuditAction.TASK_RECURRING_SCHEDULE_RESUMED,
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
