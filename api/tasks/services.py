from __future__ import annotations

from datetime import datetime, timedelta, timezone as datetime_timezone
from typing import Iterable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.contrib.auth.models import User
from django.utils import timezone

from applications.audit import log_audit
from notifications.models import Notification
from notifications.services import create_notification

from .models import RecurringSchedule, Task, TaskActivity


def _display_name(user: User) -> str:
    return user.get_full_name() or user.username


def _schedule_timezone(schedule: RecurringSchedule) -> ZoneInfo:
    try:
        return ZoneInfo(schedule.timezone or 'UTC')
    except ZoneInfoNotFoundError:
        return ZoneInfo('UTC')


def _normalize_time_strings(values: Iterable[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()

    for raw_value in values:
        value = str(raw_value).strip()
        if not value:
            continue

        parsed = datetime.strptime(value, '%H:%M').time()
        normalized_value = parsed.strftime('%H:%M')
        if normalized_value in seen:
            continue

        seen.add(normalized_value)
        normalized.append(normalized_value)

    return normalized


def _normalize_weekdays(values: Iterable[int]) -> list[int]:
    normalized: list[int] = []
    seen: set[int] = set()

    for raw_value in values:
        value = int(raw_value)
        if value < 0 or value > 6 or value in seen:
            continue

        seen.add(value)
        normalized.append(value)

    return normalized


def iter_schedule_occurrences(
    schedule: RecurringSchedule,
    *,
    start_after: datetime,
    end_at: datetime,
):
    tz = _schedule_timezone(schedule)
    start_local = start_after.astimezone(tz)
    end_local = end_at.astimezone(tz)
    anchor_date = schedule.start_at.astimezone(tz).date()
    candidate_date = max(anchor_date, start_local.date())
    times = _normalize_time_strings(schedule.times or []) or ['00:00']
    weekdays = _normalize_weekdays(schedule.weekdays or [])

    while candidate_date <= end_local.date():
        days_since_anchor = (candidate_date - anchor_date).days

        if schedule.frequency == 'daily':
            eligible = days_since_anchor >= 0 and days_since_anchor % schedule.interval == 0
        else:
            eligible = (
                days_since_anchor >= 0
                and (days_since_anchor // 7) % schedule.interval == 0
                and candidate_date.weekday() in weekdays
            )

        if eligible:
            for time_value in times:
                parsed_time = datetime.strptime(time_value, '%H:%M').time()
                candidate_local = datetime.combine(candidate_date, parsed_time, tzinfo=tz)
                if start_local < candidate_local <= end_local:
                    yield candidate_local.astimezone(datetime_timezone.utc)

        candidate_date = candidate_date + timedelta(days=1)


def get_next_occurrence_after(
    schedule: RecurringSchedule,
    after_dt: datetime,
) -> datetime | None:
    horizon = after_dt + timedelta(days=370)
    for occurrence in iter_schedule_occurrences(
        schedule,
        start_after=after_dt,
        end_at=horizon,
    ):
        return occurrence
    return None


def calculate_next_run_at(
    schedule: RecurringSchedule,
    *,
    reference: datetime | None = None,
) -> datetime | None:
    reference_dt = reference or timezone.now()
    return get_next_occurrence_after(schedule, reference_dt - timedelta(microseconds=1))


def build_deadline_for_occurrence(
    schedule: RecurringSchedule,
    scheduled_for: datetime,
) -> datetime:
    return scheduled_for + timedelta(minutes=schedule.deadline_offset_minutes)


def create_task_with_side_effects(
    *,
    assigner: User,
    assignee: User,
    title: str,
    description: str = '',
    priority: str = 'medium',
    deadline: datetime | None = None,
    request=None,
    recurrence_schedule: RecurringSchedule | None = None,
    recurrence_scheduled_for: datetime | None = None,
) -> Task:
    task = Task.objects.create(
        title=title,
        description=description,
        assigned_by=assigner,
        assigned_to=assignee,
        priority=priority,
        deadline=deadline,
        recurrence_schedule=recurrence_schedule,
        recurrence_scheduled_for=recurrence_scheduled_for,
    )

    activity_comment = f'Task created by {_display_name(assigner)}'
    if recurrence_schedule and recurrence_scheduled_for:
        activity_comment = (
            f'{activity_comment} from recurring schedule '
            f'for {recurrence_scheduled_for.isoformat()}'
        )

    TaskActivity.objects.create(
        task=task,
        user=assigner,
        activity_type='created',
        comment=activity_comment,
    )

    metadata = {
        'title': task.title,
        'assigned_by_id': task.assigned_by_id,
        'assigned_to_id': task.assigned_to_id,
        'priority': task.priority,
        'status': task.status,
    }
    if recurrence_schedule:
        metadata['recurrence_schedule_id'] = str(recurrence_schedule.id)
    if recurrence_scheduled_for:
        metadata['recurrence_scheduled_for'] = recurrence_scheduled_for

    log_audit(
        action='TASK_CREATED',
        request=request,
        actor_user=assigner,
        target_type='task',
        target_id=task.id,
        metadata=metadata,
    )

    body = f'You were assigned: {task.title} by {_display_name(assigner)}'
    if recurrence_schedule:
        body = f'{body} [recurring]'

    create_notification(
        recipient=assignee,
        actor=assigner,
        notification_type=Notification.TYPE_TASK_ASSIGNED,
        title='New Task',
        body=body,
        link_url=f'/tasks/{task.id}',
        payload={
            'task_id': task.id,
            'status': task.status,
            'priority': task.priority,
            'recurrence_schedule_id': str(recurrence_schedule.id) if recurrence_schedule else None,
            'recurrence_scheduled_for': recurrence_scheduled_for,
        },
    )

    return task