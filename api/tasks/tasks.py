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
            is_paused=False,
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

    start_after = latest_created
    if schedule.next_run_at:
        next_run_cursor = schedule.next_run_at - timedelta(microseconds=1)
        if start_after is None or next_run_cursor > start_after:
            start_after = next_run_cursor
    if start_after is None:
        start_after = schedule.start_at - timedelta(microseconds=1)
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


@shared_task(name='tasks.generate_weekly_summaries')
def generate_weekly_summaries() -> dict[str, int]:
    """Generate weekly summaries for all users every Monday at 00:00"""
    from datetime import datetime, date
    from django.contrib.auth.models import User
    from .models import WeeklySummary
    from .services import calculate_user_weekly_summary
    
    # Calculate the previous week (Monday to Sunday)
    today = date.today()
    # Monday is 0, Sunday is 6
    days_since_monday = today.weekday()
    week_start = today - timedelta(days=days_since_monday + 7)  # Start of last week
    week_end = week_start + timedelta(days=6)  # Sunday of last week
    
    summaries_created = 0
    errors = 0
    
    # Generate summary for all active users
    active_users = User.objects.filter(is_active=True)
    
    for user in active_users:
        try:
            summary_data = calculate_user_weekly_summary(user, week_start, week_end)
            
            WeeklySummary.objects.update_or_create(
                user=user,
                week_start_date=week_start,
                defaults={
                    'week_end_date': week_end,
                    'summary_data': summary_data,
                }
            )
            summaries_created += 1
        except Exception as e:
            logger.error(f'Error generating summary for user {user.id}: {str(e)}')
            errors += 1
    
    logger.info(
        f'Weekly summaries generated: {summaries_created} created, {errors} errors'
    )
    return {
        'summaries_created': summaries_created,
        'errors': errors,
    }


# PHASE 2: Weekly email notifications and comparisons

@shared_task(name='tasks.send_weekly_summary_emails')
def send_weekly_summary_emails() -> dict[str, int]:
    """Send weekly summary emails to users every Monday at 8 AM"""
    from datetime import datetime, date
    from .models import WeeklySummary
    from emails.services.summary_emails import SummaryEmailManager
    
    # Find summaries from last week
    today = timezone.now().date()
    last_week_start = today - timedelta(days=(today.weekday() + 7))  # Last Monday
    
    summaries = WeeklySummary.objects.filter(
        week_start_date=last_week_start
    )
    
    emails_sent = 0
    errors = 0
    
    for summary in summaries:
        try:
            SummaryEmailManager.send_weekly_summary_notification(
                summary.user,
                summary.summary_data,
                summary.comparison_metrics
            )
            emails_sent += 1
        except Exception as e:
            logger.error(f'Error sending email for user {summary.user.id}: {str(e)}')
            errors += 1
    
    logger.info(f'Weekly emails sent: {emails_sent} sent, {errors} errors')
    return {
        'emails_sent': emails_sent,
        'errors': errors,
    }


@shared_task(name='tasks.calculate_weekly_comparisons')
def calculate_weekly_comparisons() -> dict[str, int]:
    """Calculate week-over-week comparisons for all users"""
    from datetime import date
    from .models import WeeklySummary
    from .services import calculate_weekly_comparison
    
    comparisons_created = 0
    errors = 0
    
    # Get all current week summaries
    today = timezone.now().date()
    current_week_start = today - timedelta(days=today.weekday())  # Monday of current week
    previous_week_start = current_week_start - timedelta(days=7)
    
    current_summaries = WeeklySummary.objects.filter(
        week_start_date=current_week_start
    )
    
    for current_summary in current_summaries:
        try:
            # Get previous week's summary for this user
            previous_summary = WeeklySummary.objects.filter(
                user=current_summary.user,
                week_start_date=previous_week_start
            ).first()
            
            # Calculate comparison
            comparison_metrics = calculate_weekly_comparison(
                current_summary.summary_data,
                previous_summary.summary_data if previous_summary else None
            )
            
            # Update current summary with comparison
            current_summary.previous_week_summary = previous_summary
            current_summary.comparison_metrics = comparison_metrics
            current_summary.save()
            
            comparisons_created += 1
        except Exception as e:
            logger.error(f'Error calculating comparison for user {current_summary.user.id}: {str(e)}')
            errors += 1
    
    logger.info(f'Comparisons calculated: {comparisons_created} created, {errors} errors')
    return {
        'comparisons_created': comparisons_created,
        'errors': errors,
    }
    return 1