from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.db import transaction
from django.utils import timezone

from .models import RecurrenceOccurrence, RecurringSchedule
from .services import (
    build_deadline_for_occurrence,
    calculate_next_run_at,
    create_task_with_side_effects,
    iter_schedule_occurrences,
)

logger = logging.getLogger(__name__)


@shared_task(name='tasks.generate_recurring_task_occurrences')
def generate_recurring_task_occurrences() -> dict[str, int]:
    now = timezone.now()
    due_schedule_ids = list(
        RecurringSchedule.objects.filter(
            is_active=True,
            next_run_at__isnull=False,
            next_run_at__lte=now,
        )
        .order_by('next_run_at')
        .values_list('id', flat=True)[:100]
    )

    processed_schedules = 0
    created_tasks = 0

    for schedule_id in due_schedule_ids:
        try:
            with transaction.atomic():
                schedule = RecurringSchedule.objects.select_for_update(skip_locked=True).get(
                    id=schedule_id,
                    is_active=True,
                    next_run_at__isnull=False,
                    next_run_at__lte=now,
                )
                processed_schedules += 1
                created_tasks += _process_schedule(schedule=schedule, now=now)
        except RecurringSchedule.DoesNotExist:
            continue
        except Exception:
            logger.exception('Failed processing recurring schedule %s', schedule_id)

    return {
        'processed_schedules': processed_schedules,
        'created_tasks': created_tasks,
    }


def _process_schedule(*, schedule: RecurringSchedule, now) -> int:
    created_tasks = 0

    pending_occurrences = list(
        schedule.occurrences.select_for_update()
        .filter(created_task__isnull=True, scheduled_for__lte=now)
        .order_by('scheduled_for')
    )

    for occurrence in pending_occurrences:
        created_tasks += _create_task_for_occurrence(schedule=schedule, occurrence=occurrence)

    latest_created = (
        schedule.occurrences.filter(created_task__isnull=False)
        .order_by('-scheduled_for')
        .values_list('scheduled_for', flat=True)
        .first()
    )

    start_after = latest_created or (schedule.start_at - timedelta(microseconds=1))
    due_times = iter_schedule_occurrences(
        schedule,
        start_after=start_after,
        end_at=now,
    )

    for scheduled_for in due_times:
        occurrence, _ = RecurrenceOccurrence.objects.get_or_create(
            schedule=schedule,
            scheduled_for=scheduled_for,
        )
        if occurrence.created_task_id:
            continue

        created_tasks += _create_task_for_occurrence(
            schedule=schedule,
            occurrence=occurrence,
        )

    next_run_at = calculate_next_run_at(schedule, reference=now + timedelta(microseconds=1))
    if next_run_at and schedule.end_at and next_run_at > schedule.end_at:
        next_run_at = None

    schedule.next_run_at = next_run_at
    if next_run_at is None:
        schedule.is_active = False
        if schedule.ended_at is None:
            schedule.ended_at = now
    schedule.save(update_fields=['next_run_at', 'is_active', 'ended_at', 'updated_at'])

    return created_tasks


def _create_task_for_occurrence(*, schedule: RecurringSchedule, occurrence: RecurrenceOccurrence) -> int:
    if occurrence.created_task_id:
        return 0

    task = create_task_with_side_effects(
        assigner=schedule.assigned_by,
        assignee=schedule.assigned_to,
        title=schedule.title,
        description=schedule.description,
        priority=schedule.priority,
        deadline=build_deadline_for_occurrence(schedule, occurrence.scheduled_for),
        recurrence_schedule=schedule,
        recurrence_scheduled_for=occurrence.scheduled_for,
    )
    occurrence.created_task = task
    occurrence.save(update_fields=['created_task'])
    return 1