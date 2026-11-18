"""Weekly summaries: own work, delegated work, comparisons and the organization view."""

from __future__ import annotations

from datetime import datetime, timedelta

from django.contrib.auth import get_user_model
from django.db.models import Count, F, OuterRef, Q, Subquery
from django.utils import timezone as django_timezone

from common.users import display_name

from ..models import (
    DailyReport,
    RecurringSchedule,
    Task,
    TaskActivity,
    WeeklySummary,
)

User = get_user_model()


def _open_during_week(queryset, week_start_dt, week_end_dt):
    """Tasks that were open at some point during the week.

    Created by the end of the week, and not completed before it started.
    """
    return queryset.filter(created_at__lte=week_end_dt).filter(
        Q(completed_at__gte=week_start_dt) | (Q(completed_at__isnull=True) & ~Q(status='completed'))
    )


def _open_at(queryset, moment):
    """Tasks that existed and were not yet completed at `moment`."""
    return queryset.filter(created_at__lte=moment).filter(
        Q(completed_at__gt=moment) | (Q(completed_at__isnull=True) & ~Q(status='completed'))
    )


REVIEW_OUTCOMES = ('completed', 'in_progress', 'pending')


def calculate_delegated_work(user: User, week_start_dt, week_end_dt) -> dict:
    """Weekly figures for tasks this person gave to other people.

    Self-assigned tasks are not delegation; they count as the person's own work.
    "At the end of the week" figures are rebuilt from task history, so past
    weeks can be recalculated accurately.
    """
    delegated = Task.objects.filter(assigned_by=user).exclude(assigned_to=user)

    given = delegated.filter(created_at__gte=week_start_dt, created_at__lte=week_end_dt)
    given_count = given.count()
    people_count = given.values('assigned_to').distinct().count()

    open_count = _open_during_week(delegated, week_start_dt, week_end_dt).count()
    completed = delegated.filter(
        status='completed', completed_at__gte=week_start_dt, completed_at__lte=week_end_dt,
    )
    completed_count = completed.count()
    on_time_count = completed.filter(Q(deadline__isnull=True) | Q(completed_at__lte=F('deadline'))).count()

    # Reviews: this person approving a submitted task, or sending it back.
    reviews = TaskActivity.objects.filter(
        user=user,
        activity_type='status_change',
        old_value='under_review',
        new_value__in=REVIEW_OUTCOMES,
        created_at__gte=week_start_dt,
        created_at__lte=week_end_dt,
    ).exclude(task__assigned_to=user)
    submitted_at = (
        TaskActivity.objects.filter(
            task=OuterRef('task'),
            activity_type='status_change',
            new_value='under_review',
            created_at__lte=OuterRef('created_at'),
        )
        .order_by('-created_at')
        .values('created_at')[:1]
    )
    review_rows = list(reviews.annotate(submitted_at=Subquery(submitted_at)).values('new_value', 'created_at', 'submitted_at'))
    approved_count = sum(1 for row in review_rows if row['new_value'] == 'completed')
    waits = [
        (row['created_at'] - row['submitted_at']).total_seconds() / 3600
        for row in review_rows
        if row['submitted_at'] is not None
    ]
    avg_review_hours = round(sum(waits) / len(waits), 1) if waits else None

    # Status at the end of the week, from the history.
    status_at_end = (
        TaskActivity.objects.filter(
            task=OuterRef('pk'),
            activity_type='status_change',
            created_at__lte=week_end_dt,
        )
        .order_by('-created_at')
        .values('new_value')[:1]
    )
    open_at_end = _open_at(delegated, week_end_dt)
    waiting_count = open_at_end.annotate(status_at_end=Subquery(status_at_end)).filter(
        status_at_end='under_review'
    ).count()
    overdue_count = open_at_end.filter(deadline__isnull=False, deadline__lt=week_end_dt).count()

    has_delegated_work = bool(given_count or open_count or review_rows)
    return {
        'has_delegated_work': has_delegated_work,
        'delegated_tasks_given': given_count,
        'delegated_people': people_count,
        'delegated_tasks_open_during_week': open_count,
        'delegated_tasks_completed': completed_count,
        'delegated_completion_rate_percent': round(completed_count / open_count * 100, 2) if open_count else 0,
        'delegated_on_time_completion_rate_percent': (
            round(on_time_count / completed_count * 100, 2) if completed_count else 0
        ),
        'delegated_reviews_total': len(review_rows),
        'delegated_reviews_approved': approved_count,
        'delegated_reviews_sent_back': len(review_rows) - approved_count,
        'delegated_avg_review_hours': avg_review_hours,
        'delegated_waiting_for_review': waiting_count,
        'delegated_overdue': overdue_count,
    }


def _plural(count: int, word: str) -> str:
    return f'{count} {word}' if count == 1 else f'{count} {word}s'


def _summary_message(*, lead_section, has_own_work, own_completed, own_open, own_rate, delegated) -> str:
    own = (
        f'You completed {own_completed} of {_plural(own_open, "task")} on your list ({round(own_rate, 1)}%).'
        if has_own_work else ''
    )
    if delegated['has_delegated_work']:
        given_text = (
            f'{delegated["delegated_tasks_completed"]} of {_plural(delegated["delegated_tasks_open_during_week"], "task")} '
            'you delegated were completed'
        )
        reviews = delegated['delegated_reviews_total']
        given_text += f', and you reviewed {_plural(reviews, "submission")}.' if reviews else '.'
        parts = [given_text[0].upper() + given_text[1:]]
    else:
        parts = []
    if own:
        parts.insert(0 if lead_section == 'own' else 1, own)
    return ' '.join(parts) or 'No task activity this week.'


def calculate_user_weekly_summary(user: User, week_start: datetime.date, week_end: datetime.date) -> dict:
    """Calculate weekly summary metrics for a user"""
    
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
    files_received = calculate_user_files_received(user, week_start_dt, week_end_dt)

    daily_reports_qs = (
        DailyReport.objects.filter(
            user=user,
            report_date__gte=week_start,
            report_date__lte=week_end,
        )
        .select_related('user', 'department')
        .prefetch_related('subreports')
        .order_by('report_date')
    )
    daily_reports = []
    daily_reports_subreports_created = 0
    for report in daily_reports_qs:
        subreport_count = report.subreports.count()
        daily_reports_subreports_created += subreport_count
        daily_reports.append(
            {
                'report_date': str(report.report_date),
                'title': report.display_title,
                'subreport_count': subreport_count,
                'view_url': f'/reports/daily/{report.id}',
            }
        )

    daily_reports_created = len(daily_reports)
    
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
    
    # Completion rate: of the tasks on this person's list during the week (open
    # at some point between Monday and Sunday), how many they completed that
    # week. Both counts are about the same tasks, so it never exceeds 100%.
    total_assigned_to_user = tasks_assigned.count()
    completed_count = tasks_completed.count()
    own_open_count = _open_during_week(
        Task.objects.filter(assigned_to=user), week_start_dt, week_end_dt
    ).count()
    completion_rate = (completed_count / own_open_count * 100) if own_open_count > 0 else 0
    
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
    
    delegated = calculate_delegated_work(user, week_start_dt, week_end_dt)
    has_own_work = own_open_count > 0 or completed_count > 0
    delegated_volume = delegated['delegated_tasks_open_during_week'] + delegated['delegated_reviews_total']
    lead_section = (
        'delegated'
        if delegated['has_delegated_work'] and delegated_volume > own_open_count
        else 'own'
    )

    return {
        'week_start_date': str(week_start),
        'week_end_date': str(week_end),
        'user_id': str(user.id),
        'user_name': display_name(user),
        
        # Task metrics
        'tasks_created': tasks_created.count(),
        'tasks_assigned': total_assigned_to_user,
        'tasks_open_during_week': own_open_count,
        'tasks_completed': completed_count,
        'completion_rate_percent': round(completion_rate, 2),
        'on_time_completion_rate_percent': round(on_time_rate, 2),
        
        # High priority metrics
        'high_priority_tasks': high_priority_tasks,
        'high_priority_completed': high_priority_completed,
        
        # Engagement metrics
        'comments_added': comments_count,
        'files_attached': files_attached,
        'files_received': files_received,
        'daily_reports_created': daily_reports_created,
        'daily_reports_subreports_created': daily_reports_subreports_created,
        'daily_reports': daily_reports,
        'recurring_schedules_created': recurring_created,
        'active_recurring_schedules': recurring_assigned,
        
        # Breakdowns
        'priority_distribution': priority_dist,
        'status_distribution': status_dist,
        
        # Work given to other people
        **delegated,
        'has_own_work': has_own_work,
        'lead_section': lead_section,

        # Summary message
        'summary_message': _summary_message(
            lead_section=lead_section,
            has_own_work=has_own_work,
            own_completed=completed_count,
            own_open=own_open_count,
            own_rate=completion_rate,
            delegated=delegated,
        ),
    }


def calculate_user_files_received(user: User, week_start_dt: datetime.datetime, week_end_dt: datetime.datetime) -> int:
    """Count attachments received on tasks the user is involved with during a time range."""

    user_tasks = Task.objects.filter(
        Q(assigned_to=user) | Q(assigned_by=user)
    ).distinct()

    return (
        TaskActivity.objects.filter(
            task__in=user_tasks,
            created_at__gte=week_start_dt,
            created_at__lte=week_end_dt,
        )
        .exclude(user=user)
        .aggregate(total=Count('attachments', filter=Q(attachments__isnull=False)))['total']
        or 0
    )


# Week-over-week comparison and analytics


def calculate_weekly_comparison(current_summary: dict, previous_summary: dict | None) -> dict:
    """Calculate week-over-week deltas and trends"""
    if not previous_summary:
        return {}
    
    comparison = {
        'delta_tasks_completed': (
            current_summary.get('tasks_completed', 0) - previous_summary.get('tasks_completed', 0)
        ),
        'delta_completion_rate': round(
            current_summary.get('completion_rate_percent', 0) - 
            previous_summary.get('completion_rate_percent', 0), 2
        ),
        'delta_on_time_completion_rate': round(
            current_summary.get('on_time_completion_rate_percent', 0) - 
            previous_summary.get('on_time_completion_rate_percent', 0), 2
        ),
        'delta_high_priority_completed': (
            current_summary.get('high_priority_completed', 0) - 
            previous_summary.get('high_priority_completed', 0)
        ),
        'delta_comments': (
            current_summary.get('comments_added', 0) - 
            previous_summary.get('comments_added', 0)
        ),
        'delta_files': (
            current_summary.get('files_attached', 0) - 
            previous_summary.get('files_attached', 0)
        ),
        'previous_week_start': previous_summary.get('week_start_date'),
    }

    # Delegated work, compared only when both weeks have the figures (weeks
    # summarised before November 2026 do not).
    if 'has_delegated_work' in current_summary and 'has_delegated_work' in previous_summary:
        for key, delta_key in (
            ('delegated_tasks_given', 'delta_delegated_tasks_given'),
            ('delegated_tasks_completed', 'delta_delegated_tasks_completed'),
            ('delegated_reviews_total', 'delta_delegated_reviews'),
        ):
            comparison[delta_key] = current_summary.get(key, 0) - previous_summary.get(key, 0)
        for key, delta_key in (
            ('delegated_completion_rate_percent', 'delta_delegated_completion_rate'),
            ('delegated_on_time_completion_rate_percent', 'delta_delegated_on_time_completion_rate'),
        ):
            comparison[delta_key] = round(current_summary.get(key, 0) - previous_summary.get(key, 0), 2)
        current_hours = current_summary.get('delegated_avg_review_hours')
        previous_hours = previous_summary.get('delegated_avg_review_hours')
        if current_hours is not None and previous_hours is not None:
            comparison['delta_delegated_avg_review_hours'] = round(current_hours - previous_hours, 1)

    # Trend: from the section that leads this person's week.
    completion_delta = (
        comparison.get('delta_delegated_completion_rate', 0)
        if current_summary.get('lead_section') == 'delegated'
        else comparison['delta_completion_rate']
    )
    if completion_delta > 2:
        comparison['trend'] = 'up'
    elif completion_delta < -2:
        comparison['trend'] = 'down'
    else:
        comparison['trend'] = 'flat'
    
    # Calculate velocity change percentage
    prev_completed = previous_summary.get('tasks_completed', 0)
    if prev_completed > 0:
        velocity_change = (
            (current_summary['tasks_completed'] - prev_completed) / prev_completed * 100
        )
        comparison['velocity_change_percent'] = round(velocity_change, 1)
    
    return comparison


def calculate_organization_summary(week_start: datetime.date, week_end: datetime.date) -> dict:
    """Calculate organization-wide summary stats (admin-only)"""
    
    summaries = WeeklySummary.objects.filter(
        week_start_date=week_start
    )

    if not summaries.exists():
        return {
            'week_start_date': str(week_start),
            'week_end_date': str(week_end),
            'total_active_users': 0,
            'total_tasks_completed': 0,
            'total_tasks_assigned': 0,
            'avg_completion_rate_percent': 0,
            'avg_on_time_completion_rate_percent': 0,
            'summaries_count': 0,
            'total_comments_added': 0,
            'total_files_attached': 0,
            'total_files_received': 0,
            'total_recurring_schedules_created': 0,
            'total_active_recurring_schedules': 0,
            'total_daily_reports_created': 0,
            'total_daily_reports_subreports_created': 0,
            'priority_distribution': {},
            'status_distribution': {},
            'comparison': None,
        }
    
    total_users = summaries.count()
    total_completed = 0
    total_assigned = 0
    completion_rates = []
    on_time_rates = []
    total_comments = 0
    total_files_attached = 0
    total_files_received = 0
    total_recurring_created = 0
    total_active_recurring = 0
    total_daily_reports = 0
    total_daily_subreports = 0
    agg_priority_dist = {}
    agg_status_dist = {}
    
    for summary in summaries:
        data = summary.summary_data
        total_completed += data.get('tasks_completed', 0)
        total_assigned += data.get('tasks_assigned', 0)
        completion_rates.append(data.get('completion_rate_percent', 0))
        on_time_rates.append(data.get('on_time_completion_rate_percent', 0))
        total_comments += data.get('comments_added', 0)
        total_files_attached += data.get('files_attached', 0)
        total_files_received += data.get('files_received', 0)
        total_recurring_created += data.get('recurring_schedules_created', 0)
        total_active_recurring += data.get('active_recurring_schedules', 0)
        total_daily_reports += data.get('daily_reports_created', 0)
        total_daily_subreports += data.get('daily_reports_subreports_created', 0)

        for k, v in (data.get('priority_distribution') or {}).items():
            agg_priority_dist[k] = agg_priority_dist.get(k, 0) + v
        for k, v in (data.get('status_distribution') or {}).items():
            agg_status_dist[k] = agg_status_dist.get(k, 0) + v
    
    avg_completion_rate = (
        sum(completion_rates) / len(completion_rates) if completion_rates else 0
    )
    avg_on_time_rate = (
        sum(on_time_rates) / len(on_time_rates) if on_time_rates else 0
    )

    # Calculate week-over-week comparison
    prev_week = week_start - timedelta(days=7)
    prev_summaries = WeeklySummary.objects.filter(week_start_date=prev_week)
    comparison = None
    if prev_summaries.exists():
        prev_completed = sum(s.summary_data.get('tasks_completed', 0) for s in prev_summaries)
        prev_assigned = sum(s.summary_data.get('tasks_assigned', 0) for s in prev_summaries)
        prev_completion_rates = [s.summary_data.get('completion_rate_percent', 0) for s in prev_summaries]
        prev_avg_completion = sum(prev_completion_rates) / len(prev_completion_rates) if prev_completion_rates else 0
        prev_on_time_rates = [s.summary_data.get('on_time_completion_rate_percent', 0) for s in prev_summaries]
        prev_avg_on_time = sum(prev_on_time_rates) / len(prev_on_time_rates) if prev_on_time_rates else 0
        prev_users = prev_summaries.count()
        prev_comments = sum(s.summary_data.get('comments_added', 0) for s in prev_summaries)
        prev_files = sum(s.summary_data.get('files_attached', 0) for s in prev_summaries)

        comparison = {
            'delta_users': total_users - prev_users,
            'delta_tasks_completed': total_completed - prev_completed,
            'delta_tasks_assigned': total_assigned - prev_assigned,
            'delta_completion_rate': round(avg_completion_rate - prev_avg_completion, 2),
            'delta_on_time_completion_rate': round(avg_on_time_rate - prev_avg_on_time, 2),
            'delta_comments': total_comments - prev_comments,
            'delta_files': total_files_attached - prev_files,
            'trend': 'up' if avg_completion_rate > prev_avg_completion else ('down' if avg_completion_rate < prev_avg_completion else 'flat'),
            'previous_week_start': str(prev_week),
            'previous_active_users': prev_users,
            'previous_tasks_completed': prev_completed,
            'previous_completion_rate': round(prev_avg_completion, 2),
        }
    
    return {
        'week_start_date': str(week_start),
        'week_end_date': str(week_end),
        'total_active_users': total_users,
        'total_tasks_completed': total_completed,
        'total_tasks_assigned': total_assigned,
        'avg_completion_rate_percent': round(avg_completion_rate, 2),
        'avg_on_time_completion_rate_percent': round(avg_on_time_rate, 2),
        'summaries_count': summaries.count(),
        'total_comments_added': total_comments,
        'total_files_attached': total_files_attached,
        'total_files_received': total_files_received,
        'total_recurring_schedules_created': total_recurring_created,
        'total_active_recurring_schedules': total_active_recurring,
        'total_daily_reports_created': total_daily_reports,
        'total_daily_reports_subreports_created': total_daily_subreports,
        'priority_distribution': agg_priority_dist,
        'status_distribution': agg_status_dist,
        'comparison': comparison,
    }
