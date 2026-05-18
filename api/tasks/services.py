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


def calculate_user_weekly_summary(user: User, week_start: datetime.date, week_end: datetime.date) -> dict:
    """Calculate weekly summary metrics for a user"""
    from django.db.models import Count, Q, F
    from django.utils import timezone as django_timezone
    
    # Convert dates to datetime for database queries
    week_start_dt = django_timezone.make_aware(
        datetime.combine(week_start, datetime.min.time())
    )
    week_end_dt = django_timezone.make_aware(
        datetime.combine(week_end, datetime.max.time())
    )
    
    # Tasks created by this user during the week
    tasks_created = Task.objects.filter(
        assigned_by=user,
        created_at__gte=week_start_dt,
        created_at__lte=week_end_dt,
    )
    
    # Tasks assigned to this user during the week
    tasks_assigned = Task.objects.filter(
        assigned_to=user,
        created_at__gte=week_start_dt,
        created_at__lte=week_end_dt,
    )
    
    # Tasks completed by this user during the week
    tasks_completed = Task.objects.filter(
        assigned_to=user,
        status='completed',
        completed_at__gte=week_start_dt,
        completed_at__lte=week_end_dt,
    )
    
    # Comments/activities by this user during the week
    comments_count = TaskActivity.objects.filter(
        user=user,
        activity_type='comment',
        created_at__gte=week_start_dt,
        created_at__lte=week_end_dt,
    ).count()
    
    # File attachments created by this user's comments during the week
    files_attached = TaskActivity.objects.filter(
        user=user,
        created_at__gte=week_start_dt,
        created_at__lte=week_end_dt,
    ).annotate(
        attachment_count=Count('attachments')
    ).aggregate(total=Count('attachments', filter=Q(attachments__isnull=False)))['total'] or 0
    
    # Recurring schedules created by this user during the week
    recurring_created = RecurringSchedule.objects.filter(
        assigned_by=user,
        created_at__gte=week_start_dt,
        created_at__lte=week_end_dt,
    ).count()
    
    # Recurring schedules assigned to this user
    recurring_assigned = RecurringSchedule.objects.filter(
        assigned_to=user,
        is_active=True,
        created_at__lte=week_end_dt,
    ).count()
    
    # Calculate completion metrics
    total_assigned_to_user = tasks_assigned.count()
    completed_count = tasks_completed.count()
    completion_rate = (completed_count / total_assigned_to_user * 100) if total_assigned_to_user > 0 else 0
    
    # On-time completion rate
    on_time_completed = tasks_completed.filter(
        Q(deadline__isnull=True) | Q(completed_at__lte=F('deadline'))
    ).count()
    on_time_rate = (on_time_completed / completed_count * 100) if completed_count > 0 else 0
    
    # High priority tasks handled
    high_priority_tasks = tasks_assigned.filter(priority='high').count()
    high_priority_completed = tasks_completed.filter(priority='high').count()
    
    # Task priority breakdown
    priority_breakdown = tasks_assigned.values('priority').annotate(count=Count('id'))
    priority_dist = {item['priority']: item['count'] for item in priority_breakdown}
    
    # Task status breakdown (for assigned tasks)
    status_breakdown = tasks_assigned.values('status').annotate(count=Count('id'))
    status_dist = {item['status']: item['count'] for item in status_breakdown}
    
    return {
        'week_start_date': str(week_start),
        'week_end_date': str(week_end),
        'user_id': str(user.id),
        'user_name': user.get_full_name() or user.username,
        
        # Task metrics
        'tasks_created': tasks_created.count(),
        'tasks_assigned': total_assigned_to_user,
        'tasks_completed': completed_count,
        'completion_rate_percent': round(completion_rate, 2),
        'on_time_completion_rate_percent': round(on_time_rate, 2),
        
        # High priority metrics
        'high_priority_tasks': high_priority_tasks,
        'high_priority_completed': high_priority_completed,
        
        # Engagement metrics
        'comments_added': comments_count,
        'files_attached': files_attached,
        'recurring_schedules_created': recurring_created,
        'active_recurring_schedules': recurring_assigned,
        
        # Breakdowns
        'priority_distribution': priority_dist,
        'status_distribution': status_dist,
        
        # Summary message
        'summary_message': f"You created {tasks_created.count()} task(s), completed {completed_count} of {total_assigned_to_user} assigned task(s) ({round(completion_rate, 1)}%), and added {comments_count} comment(s).",
    }