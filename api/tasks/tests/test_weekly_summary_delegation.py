"""Weekly summaries: own work, work given to other people, and the completion rate."""

from datetime import date, datetime, timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.template.loader import render_to_string
from django.test import TestCase
from django.utils import timezone

from tasks.models import Task, TaskActivity, WeeklySummary
from tasks.services import calculate_user_weekly_summary, calculate_weekly_comparison

User = get_user_model()

WEEK_START = date(2026, 11, 9)  # Monday
WEEK_END = date(2026, 11, 15)  # Sunday


def at(day, hour=9, minute=0):
    return timezone.make_aware(datetime(2026, 11, day, hour, minute))


class DelegationFixture(TestCase):
    """A manager who delegates to two people, with a week of history."""

    def setUp(self):
        self.manager = User.objects.create_user(username='manager', email='m@example.com', password='x')
        self.ada = User.objects.create_user(username='ada', email='a@example.com', password='x')
        self.bayo = User.objects.create_user(username='bayo', email='b@example.com', password='x')

        # Given out this week, approved on time.
        self.t1 = self.task(self.ada, created=at(10), status='completed', completed=at(12, 14), deadline=at(13, 17))
        self.history(self.t1, self.ada, 'in_progress', 'under_review', at(12, 8))
        self.history(self.t1, self.manager, 'under_review', 'completed', at(12, 14))

        # Given out this week, sent back once, then approved after its deadline.
        self.t2 = self.task(self.bayo, created=at(11), status='completed', completed=at(15, 12), deadline=at(13, 17))
        self.history(self.t2, self.bayo, 'in_progress', 'under_review', at(13, 9))
        self.history(self.t2, self.manager, 'under_review', 'in_progress', at(13, 13))
        self.history(self.t2, self.bayo, 'in_progress', 'under_review', at(15, 10))
        self.history(self.t2, self.manager, 'under_review', 'completed', at(15, 12))

        # Given out the week before, still open and overdue at the end of the week.
        self.t3 = self.task(self.ada, created=at(2), deadline=at(12, 17))

        # Given out this week, waiting for review at the end of the week, approved the next Tuesday.
        self.t4 = self.task(self.bayo, created=at(12), status='completed', completed=at(17, 10))
        self.history(self.t4, self.bayo, 'in_progress', 'under_review', at(13, 10))
        self.history(self.t4, self.manager, 'under_review', 'completed', at(17, 10))

        # The manager's own task (self-assigned): own work, not delegation.
        self.t5 = self.task(self.manager, created=at(10))

        # Finished before the week started: not on anyone's list this week.
        self.t6 = self.task(self.ada, created=at(2), status='completed', completed=at(5))

        # Given out the week before, completed this week (no deadline).
        self.t7 = self.task(self.ada, created=at(3), status='completed', completed=at(10, 15))

    def task(self, assignee, *, created, status='pending', completed=None, deadline=None):
        task = Task.objects.create(
            title=f'Task for {assignee.username}',
            assigned_by=self.manager,
            assigned_to=assignee,
            status=status,
            deadline=deadline,
        )
        Task.objects.filter(pk=task.pk).update(created_at=created, completed_at=completed)
        task.refresh_from_db()
        return task

    def history(self, task, user, old, new, when):
        activity = TaskActivity.objects.create(
            task=task, user=user, activity_type='status_change', old_value=old, new_value=new,
        )
        TaskActivity.objects.filter(pk=activity.pk).update(created_at=when)


class DelegatedWorkTests(DelegationFixture):
    def test_delegated_figures(self):
        data = calculate_user_weekly_summary(self.manager, WEEK_START, WEEK_END)

        self.assertTrue(data['has_delegated_work'])
        self.assertEqual(data['delegated_tasks_given'], 3)  # t1, t2, t4 (t5 is self-assigned)
        self.assertEqual(data['delegated_people'], 2)
        self.assertEqual(data['delegated_tasks_open_during_week'], 5)  # t1, t2, t3, t4, t7
        self.assertEqual(data['delegated_tasks_completed'], 3)  # t1, t2, t7
        self.assertEqual(data['delegated_completion_rate_percent'], 60.0)
        self.assertEqual(data['delegated_on_time_completion_rate_percent'], 66.67)  # t2 was late
        self.assertEqual(data['delegated_reviews_total'], 3)
        self.assertEqual(data['delegated_reviews_approved'], 2)
        self.assertEqual(data['delegated_reviews_sent_back'], 1)
        self.assertEqual(data['delegated_avg_review_hours'], 4.0)  # (6 + 4 + 2) / 3
        self.assertEqual(data['delegated_waiting_for_review'], 1)  # t4, from history
        self.assertEqual(data['delegated_overdue'], 1)  # t3

    def test_a_manager_who_mostly_delegates_leads_with_delegated_work(self):
        data = calculate_user_weekly_summary(self.manager, WEEK_START, WEEK_END)

        self.assertEqual(data['lead_section'], 'delegated')
        self.assertTrue(data['has_own_work'])
        self.assertEqual(data['tasks_open_during_week'], 1)  # t5
        self.assertTrue(data['summary_message'].startswith('3 of 5 tasks you delegated were completed'))
        self.assertIn('you reviewed 3 submissions', data['summary_message'])

    def test_someone_who_only_does_their_own_work_has_no_delegated_section(self):
        data = calculate_user_weekly_summary(self.ada, WEEK_START, WEEK_END)

        self.assertFalse(data['has_delegated_work'])
        self.assertEqual(data['lead_section'], 'own')
        self.assertEqual(data['delegated_reviews_total'], 0)
        self.assertIsNone(data['delegated_avg_review_hours'])

    def test_completion_rate_counts_the_same_tasks_and_never_exceeds_100(self):
        data = calculate_user_weekly_summary(self.ada, WEEK_START, WEEK_END)

        # Ada's list this week: t1, t3, t7 (t6 finished the week before).
        # She completed t1 and t7. Only t1 was given to her this week, so the
        # old calculation (completed / given this week) said 200%.
        self.assertEqual(data['tasks_assigned'], 1)
        self.assertEqual(data['tasks_open_during_week'], 3)
        self.assertEqual(data['tasks_completed'], 2)
        self.assertEqual(data['completion_rate_percent'], 66.67)

    def test_nothing_happened(self):
        idle = User.objects.create_user(username='idle', password='x')

        data = calculate_user_weekly_summary(idle, WEEK_START, WEEK_END)

        self.assertFalse(data['has_own_work'])
        self.assertFalse(data['has_delegated_work'])
        self.assertEqual(data['summary_message'], 'No task activity this week.')


class DelegatedComparisonTests(TestCase):
    def summary(self, **overrides):
        data = {
            'tasks_completed': 2, 'completion_rate_percent': 50, 'on_time_completion_rate_percent': 100,
            'high_priority_completed': 0, 'comments_added': 0, 'files_attached': 0,
            'has_delegated_work': True, 'lead_section': 'delegated',
            'delegated_tasks_given': 4, 'delegated_tasks_completed': 2, 'delegated_reviews_total': 3,
            'delegated_completion_rate_percent': 40.0, 'delegated_on_time_completion_rate_percent': 50.0,
            'delegated_avg_review_hours': 6.0,
        }
        data.update(overrides)
        return data

    def test_delegated_deltas_and_trend_follow_the_leading_section(self):
        current = self.summary(
            delegated_tasks_given=6, delegated_completion_rate_percent=70.0, delegated_avg_review_hours=2.5,
            completion_rate_percent=40,
        )

        comparison = calculate_weekly_comparison(current, self.summary())

        self.assertEqual(comparison['delta_delegated_tasks_given'], 2)
        self.assertEqual(comparison['delta_delegated_completion_rate'], 30.0)
        self.assertEqual(comparison['delta_delegated_avg_review_hours'], -3.5)
        # Own completion fell, but this week was led by delegated work, which improved.
        self.assertEqual(comparison['trend'], 'up')

    def test_weeks_from_before_the_change_get_no_delegated_deltas(self):
        old_week = {'tasks_completed': 1, 'completion_rate_percent': 50}

        comparison = calculate_weekly_comparison(self.summary(), old_week)

        self.assertNotIn('delta_delegated_tasks_given', comparison)
        self.assertIn('delta_tasks_completed', comparison)

    def test_no_review_time_comparison_when_a_week_had_no_reviews(self):
        comparison = calculate_weekly_comparison(
            self.summary(delegated_avg_review_hours=None), self.summary(),
        )

        self.assertNotIn('delta_delegated_avg_review_hours', comparison)


class WeeklyEmailSectionsTests(DelegationFixture):
    def render(self, user, comparison=None):
        from emails.services.summary_emails import SummaryEmailManager

        data = calculate_user_weekly_summary(user, WEEK_START, WEEK_END)
        with patch('emails.services.base_email_service.BaseEmailService.send_email', return_value=True) as send:
            SummaryEmailManager.send_weekly_summary_notification(user, data, comparison)
        context = send.call_args_list[0].kwargs['context']
        return render_to_string('weekly_summary_notification.html', {'portal_url': 'https://p.example', **context})

    def test_delegated_section_comes_first_for_a_manager(self):
        html = self.render(self.manager)

        self.assertIn('Work you delegated', html)
        self.assertIn('Your own work', html)
        self.assertLess(html.index('Work you delegated'), html.index('Your own work'))
        self.assertIn('2 approved, 1 sent back', html)
        self.assertIn('4.0 h', html)

    def test_staff_member_sees_only_their_own_work(self):
        html = self.render(self.ada)

        self.assertIn('Your own work', html)
        self.assertNotIn('Work you delegated', html)
        self.assertIn('2 of 3', html)

    def test_a_summary_stored_before_the_change_still_renders(self):
        from emails.services.summary_emails import SummaryEmailManager

        old = {'week_start_date': '2026-11-02', 'week_end_date': '2026-11-08', 'tasks_completed': 1,
               'tasks_assigned': 2, 'completion_rate_percent': 50, 'on_time_completion_rate_percent': 100,
               'high_priority_completed': 0, 'comments_added': 0, 'files_attached': 0}
        with patch('emails.services.base_email_service.BaseEmailService.send_email', return_value=True) as send:
            SummaryEmailManager.send_weekly_summary_notification(self.ada, old, {'delta_tasks_completed': 1})
        html = render_to_string('weekly_summary_notification.html', send.call_args_list[0].kwargs['context'])

        self.assertIn('1 of 2', html)
        self.assertNotIn('Work you delegated', html)


class RecalculateCommandTests(DelegationFixture):
    def test_recalculates_recent_weeks_with_comparisons_and_sends_nothing(self):
        today = WEEK_END + timedelta(days=2)  # Tuesday after the fixture's week
        with patch('django.utils.timezone.localdate', return_value=today), \
                patch('emails.services.base_email_service.BaseEmailService.send_email') as send:
            call_command('recalculate_weekly_summaries', '--weeks', '2', stdout=open('/dev/null', 'w'))

        send.assert_not_called()
        latest = WeeklySummary.objects.get(user=self.manager, week_start_date=WEEK_START)
        self.assertEqual(latest.summary_data['delegated_reviews_total'], 3)
        self.assertEqual(latest.previous_week_summary.week_start_date, WEEK_START - timedelta(days=7))
        self.assertIn('delta_delegated_tasks_given', latest.comparison_metrics)
