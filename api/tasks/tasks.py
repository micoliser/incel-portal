from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.contrib.auth.models import User
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from emails.services.daily_report_emails import DailyReportEmailManager
from emails.services.summary_emails import SummaryEmailManager
from emails.services.task_emails import TaskEmailManager
from notifications.models import Notification
from notifications.services import create_notification

from . import services as task_services
from .models import (
    DailyReport,
    OrganizationSummaryCache,
    RecurrenceOccurrence,
    RecurringSchedule,
    TodoItem,
    WeeklySummary,
)
from .services import (
    build_deadline_for_occurrence,
    calculate_next_run_at,
    calculate_user_weekly_summary,
    calculate_weekly_comparison,
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
                # Re-checked under the lock: the schedule may have been paused
                # or ended since the list above was read.
                schedule = RecurringSchedule.objects.select_for_update(skip_locked=True).get(
                    id=schedule_id,
                    is_active=True,
                    is_paused=False,
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

    # After an outage many runs may be overdue at once. Creating a task for
    # each would bury the assignee, so only the most recent ones are created.
    due_times = list(due_times)
    limit = settings.RECURRING_MAX_CATCH_UP_RUNS
    if len(due_times) > limit:
        logger.warning(
            'Recurring schedule %s: skipping %s missed runs, creating the latest %s',
            schedule.id, len(due_times) - limit, limit,
        )
        due_times = due_times[-limit:]

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
    
    # Calculate the previous week (Monday to Sunday)
    today = timezone.localdate()
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


# Weekly email notifications and comparisons

@shared_task(name='tasks.send_weekly_summary_emails')
def send_weekly_summary_emails() -> dict[str, int]:
    """Send weekly summary emails to users every Monday at 8 AM"""
    
    # Find summaries from last week
    today = timezone.localdate()
    last_week_start = today - timedelta(days=(today.weekday() + 7))  # Last Monday
    
    # Deactivated accounts are not emailed.
    summaries = WeeklySummary.objects.filter(
        week_start_date=last_week_start,
        user__is_active=True,
    ).select_related('user')

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
    """Compare the week that has just finished with the one before it, for every user.

    Runs on Monday after the weekly summaries are generated; those are for the
    week that ended on Sunday, so that is the week compared here.
    """

    comparisons_created = 0
    errors = 0

    today = timezone.localdate()
    current_week_start = today - timedelta(days=today.weekday() + 7)  # Monday of the finished week
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


@shared_task(name='tasks.cache_organization_summaries')
def cache_organization_summaries() -> dict[str, int]:
    """Pre-compute organization summaries for all available weeks and cache them.

    Runs after user weekly summaries are generated so admins see cached data
    instead of live-aggregating on every page load.
    """

    week_starts = (
        WeeklySummary.objects
        .values_list('week_start_date', flat=True)
        .distinct()
        .order_by('-week_start_date')
    )

    cached = 0
    errors = 0

    for week_start in week_starts:
        try:
            week_end = week_start + timedelta(days=6)
            org_data = task_services.calculate_organization_summary(week_start, week_end)

            OrganizationSummaryCache.objects.update_or_create(
                week_start_date=week_start,
                defaults={
                    'week_end_date': week_end,
                    'summary_data': org_data,
                },
            )
            cached += 1
        except Exception as e:
            logger.error(
                'Error caching org summary for week %s: %s', week_start, str(e)
            )
            errors += 1

    logger.info(
        'Organization summaries cached: %d stored, %d errors', cached, errors
    )
    return {'cached': cached, 'errors': errors}
@shared_task(name='tasks.send_eod_daily_reports')
def send_eod_daily_reports() -> dict[str, int]:
    """Weekdays at 17:05 Lagos time: email each of today's reports to its author and their manager.

    Only reports with at least one entry, written by active accounts, are sent.
    """
    today = timezone.localdate()
    lock_key = f"eod_emails_sent_{today.isoformat()}"
    if not cache.add(lock_key, True, timeout=60 * 60 * 24):
        return {'reports': 0, 'sent': 0, 'status': 'already_sent'}

    reports = (
        DailyReport.objects.filter(
            report_date=today,
            user__is_active=True,
            subreports__isnull=False,
        )
        .distinct()
        .select_related('user', 'department')
    )

    report_count = 0
    emails_sent = 0
    for report in reports:
        report_count += 1
        try:
            emails_sent += DailyReportEmailManager.send_end_of_day(report)
        except Exception:
            logger.exception('End-of-day email failed for daily report %s', report.id)

    logger.info('End-of-day reports: %s reports, %s emails sent', report_count, emails_sent)
    return {'reports': report_count, 'sent': emails_sent}


@shared_task(name='tasks.check_due_todo_reminders')
def check_due_todo_reminders() -> dict[str, int]:

    now = timezone.now()
    due_reminders = TodoItem.objects.filter(
        is_completed=False,
        reminder_sent=False,
        reminder_at__isnull=False,
        reminder_at__lte=now,
    ).select_related('user')[:100]

    processed = 0
    notifications_created = 0

    for todo in due_reminders:
        try:
            with transaction.atomic():
                item = TodoItem.objects.select_for_update(skip_locked=True).get(
                    id=todo.id,
                    reminder_sent=False,
                )

                time_str = ""
                if item.due_time:
                    time_str = f" due at {item.due_time.strftime('%I:%M %p')}"
                elif item.due_date:
                    time_str = f" due on {item.due_date.strftime('%b %d')}"

                # Determine which offset(s) triggered
                sent_set = set(item.reminders_sent or [])
                offsets = list(item.reminder_offsets) if item.reminder_offsets else []
                if not offsets and item.reminder_offset and item.reminder_offset != 'none':
                    offsets = [item.reminder_offset]

                dispatched_offsets = []
                for o in offsets:
                    if o in item.OFFSET_MAP and o not in sent_set:
                        rem_time = (item.due_datetime - item.OFFSET_MAP[o]) if item.due_datetime else item.reminder_at
                        if rem_time and rem_time <= now:
                            dispatched_offsets.append(o)

                offset_labels = {
                    'exact': 'due time',
                    '5m': '5-minute',
                    '10m': '10-minute',
                    '15m': '15-minute',
                    '30m': '30-minute',
                    '1h': '1-hour',
                    '2h': '2-hour',
                    '1d': '1-day',
                }

                if dispatched_offsets:
                    reminder_time_label = ', '.join([offset_labels.get(o, o) for o in dispatched_offsets])
                elif item.due_datetime and item.reminder_at:
                    diff_seconds = (item.due_datetime - item.reminder_at).total_seconds()
                    if abs(diff_seconds) < 60:
                        reminder_time_label = 'due time'
                    elif diff_seconds > 0:
                        mins = round(diff_seconds / 60)
                        if mins < 60:
                            reminder_time_label = f"{mins}-minute"
                        elif mins % 60 == 0 and mins < 1440:
                            reminder_time_label = f"{mins // 60}-hour"
                        elif mins >= 1440 and mins % 1440 == 0:
                            reminder_time_label = f"{mins // 1440}-day"
                        else:
                            reminder_time_label = f"{mins}-minute"
                    else:
                        reminder_time_label = 'scheduled'
                else:
                    reminder_time_label = 'scheduled'

                create_notification(
                    recipient=item.user,
                    actor=None,
                    notification_type=Notification.TYPE_TODO_REMINDER,
                    title=f"To-Do Reminder: {item.title}",
                    body=f"This is a {reminder_time_label} reminder for your to-do '{item.title}'{time_str}.",
                    link_url="/todos",
                    payload={
                        'todo_id': str(item.id),
                        'title': item.title,
                        'priority': item.priority,
                        'offsets_dispatched': dispatched_offsets,
                        'reminder_time_label': reminder_time_label,
                        'due_datetime': item.due_datetime.isoformat() if item.due_datetime else None,
                    },
                )
                notifications_created += 1

                if item.send_email_reminder and item.user.email:
                    try:
                        TaskEmailManager.send_todo_reminder_email(
                            todo=item,
                            reminder_time_label=reminder_time_label,
                        )
                    except Exception as email_err:
                        logger.warning("Could not send email reminder for todo %s: %s", item.id, email_err)

                item.reminders_sent = list(sent_set.union(dispatched_offsets))
                next_rem = item.compute_next_reminder()
                if next_rem:
                    item.reminder_at = next_rem
                    item.reminder_sent = False
                else:
                    item.reminder_sent = True
                    item.reminder_sent_at = now

                item.save(update_fields=['reminders_sent', 'reminder_at', 'reminder_sent', 'reminder_sent_at'])
                processed += 1
        except TodoItem.DoesNotExist:
            continue
        except Exception as e:
            logger.error("Error processing reminder for todo %s: %s", todo.id, e)

    return {'processed': processed, 'notifications_created': notifications_created}
