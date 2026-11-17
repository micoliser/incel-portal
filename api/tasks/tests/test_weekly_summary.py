from datetime import date, datetime, timedelta
from datetime import timezone as datetime_timezone
from unittest.mock import patch

from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from common.test_utils import BaseAPITestCase
from tasks.models import (
    DailyReport,
    DailyReportSubreport,
    Task,
    WeeklySummary,
    WeeklySummaryShare,
)
from tasks.services import calculate_user_weekly_summary
from tasks.views_api.summaries import hash_share_token


def build_summary_data(**overrides):
    data = {
        'tasks_created': 8,
        'tasks_assigned': 11,
        'tasks_completed': 6,
        'completion_rate_percent': 54.5,
        'on_time_completion_rate_percent': 81.25,
        'high_priority_tasks': 3,
        'high_priority_completed': 2,
        'comments_added': 9,
        'files_attached': 4,
        'files_received': 2,
        'recurring_schedules_created': 2,
        'active_recurring_schedules': 5,
        'priority_distribution': {
            'high': 3,
            'medium': 4,
            'low': 2,
        },
        'status_distribution': {
            'pending': 4,
            'in_progress': 3,
            'completed': 2,
        },
        'summary_message': 'Solid progress this week.',
    }
    data.update(overrides)
    return data


class WeeklySummaryApiTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.week_start_recent = date(2026, 5, 11)
        self.week_start_older = date(2026, 5, 4)
        self.week_end_recent = self.week_start_recent + timedelta(days=6)
        self.week_end_older = self.week_start_older + timedelta(days=6)

    def create_summary(self, user, week_start_date, week_end_date, **summary_overrides):
        return WeeklySummary.objects.create(
            user=user,
            week_start_date=week_start_date,
            week_end_date=week_end_date,
            summary_data=build_summary_data(**summary_overrides),
        )

    def test_available_weeks_returns_only_authenticated_users_summaries_newest_first(self):
        self.create_summary(self.staff_user, self.week_start_older, self.week_end_older)
        self.create_summary(self.staff_user, self.week_start_recent, self.week_end_recent)
        self.create_summary(self.admin_user, date(2026, 4, 27), date(2026, 5, 3))

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('summary-weeks'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 2)
        self.assertEqual(response.data[0]['week_start_date'], self.week_start_recent)
        self.assertEqual(response.data[1]['week_start_date'], self.week_start_older)
        self.assertIn('created_at', response.data[0])

    def test_summary_endpoint_returns_flattened_summary_payload(self):
        self.create_summary(
            self.staff_user,
            self.week_start_recent,
            self.week_end_recent,
            tasks_created=13,
            tasks_assigned=15,
            tasks_completed=10,
            completion_rate_percent=66.67,
            on_time_completion_rate_percent=92.5,
            high_priority_tasks=5,
            high_priority_completed=4,
            comments_added=12,
            files_attached=7,
            files_received=3,
            recurring_schedules_created=3,
            active_recurring_schedules=6,
            priority_distribution={'high': 5, 'medium': 4, 'low': 3},
            status_distribution={'pending': 3, 'in_progress': 4, 'completed': 6},
            summary_message='Great week overall.',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('summary-detail', kwargs={'week': self.week_start_recent}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['week_start_date'], str(self.week_start_recent))
        self.assertEqual(response.data['week_end_date'], str(self.week_end_recent))
        self.assertEqual(response.data['user_id'], self.staff_user.id)
        self.assertEqual(response.data['user_name'], 'Staff Member')
        self.assertEqual(response.data['tasks_created'], 13)
        self.assertEqual(response.data['tasks_assigned'], 15)
        self.assertEqual(response.data['tasks_completed'], 10)
        self.assertEqual(response.data['completion_rate_percent'], 66.67)
        self.assertEqual(response.data['on_time_completion_rate_percent'], 92.5)
        self.assertEqual(response.data['high_priority_tasks'], 5)
        self.assertEqual(response.data['high_priority_completed'], 4)
        self.assertEqual(response.data['comments_added'], 12)
        self.assertEqual(response.data['files_attached'], 7)
        self.assertEqual(response.data['files_received'], 3)
        self.assertEqual(response.data['recurring_schedules_created'], 3)
        self.assertEqual(response.data['active_recurring_schedules'], 6)
        self.assertEqual(response.data['priority_distribution'], {'high': 5, 'medium': 4, 'low': 3})
        self.assertEqual(response.data['status_distribution'], {'pending': 3, 'in_progress': 4, 'completed': 6})
        self.assertEqual(response.data['summary_message'], 'Great week overall.')

    def test_summary_endpoint_rejects_unknown_and_malformed_weeks(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))

        unknown_week_response = self.client.get(reverse('summary-detail', kwargs={'week': date(2026, 1, 5)}))
        self.assertEqual(unknown_week_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(unknown_week_response.data['error']['type'], 'not_found')

        for bad in ('not-a-date', '2026-13-45', '11-05-2026'):
            response = self.client.get(f'/api/v1/summaries/weeks/{bad}')
            self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND, bad)

    def test_another_users_week_is_not_found(self):
        self.create_summary(self.admin_user, self.week_start_recent, self.week_end_recent)
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('summary-detail', kwargs={'week': self.week_start_recent}))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def _share_url(self, week=None):
        return reverse('summary-share', kwargs={'week': week or self.week_start_recent})

    def test_share_endpoint_creates_link_and_stores_only_a_hash(self):
        summary = self.create_summary(self.staff_user, self.week_start_recent, self.week_end_recent)

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(self._share_url())

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['share_link'].startswith('/summaries?token='))
        self.assertNotIn('share_token', response.data)
        token = response.data['share_link'].split('token=')[1]

        share = WeeklySummaryShare.objects.get(summary=summary)
        self.assertNotEqual(share.share_token, token)
        self.assertEqual(share.share_token, hash_share_token(token))
        # Links expire.
        self.assertGreater(share.expires_at, timezone.now() + timedelta(days=29))
        self.assertLess(share.expires_at, timezone.now() + timedelta(days=31))

    def test_share_status_never_returns_the_link(self):
        self.create_summary(self.staff_user, self.week_start_recent, self.week_end_recent)
        self.client.credentials(**self.auth_headers_for(self.staff_user))

        self.assertEqual(self.client.get(self._share_url()).data, {'shared': False})
        self.client.post(self._share_url())

        status_response = self.client.get(self._share_url())
        self.assertEqual(set(status_response.data), {'shared', 'created_at', 'expires_at'})
        self.assertTrue(status_response.data['shared'])

    def test_creating_a_new_link_replaces_the_old_one_and_revoke_removes_it(self):
        self.create_summary(self.staff_user, self.week_start_recent, self.week_end_recent)
        self.client.credentials(**self.auth_headers_for(self.staff_user))

        first = self.client.post(self._share_url()).data['share_link'].split('token=')[1]
        second = self.client.post(self._share_url()).data['share_link'].split('token=')[1]
        self.assertEqual(WeeklySummaryShare.objects.count(), 1)

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        self.assertEqual(self.client.get(reverse('summary-shared', kwargs={'token': first})).status_code, 404)
        self.assertEqual(self.client.get(reverse('summary-shared', kwargs={'token': second})).status_code, 200)

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        self.assertEqual(self.client.delete(self._share_url()).status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(self.client.get(self._share_url()).data, {'shared': False})

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        self.assertEqual(self.client.get(reverse('summary-shared', kwargs={'token': second})).status_code, 404)

    def test_only_the_owner_can_share_or_revoke_a_summary(self):
        self.create_summary(self.staff_user, self.week_start_recent, self.week_end_recent)
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        self.assertEqual(self.client.post(self._share_url()).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.delete(self._share_url()).status_code, status.HTTP_404_NOT_FOUND)

    def test_shared_endpoint_requires_sign_in_and_returns_the_summary(self):
        summary = self.create_summary(self.staff_user, self.week_start_recent, self.week_end_recent)
        WeeklySummaryShare.objects.create(
            summary=summary,
            shared_by=self.staff_user,
            share_token=hash_share_token('shared-token-123'),
        )
        url = reverse('summary-shared', kwargs={'token': 'shared-token-123'})

        self.client.credentials()
        self.assertEqual(self.client.get(url).status_code, status.HTTP_401_UNAUTHORIZED)

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        authenticated_response = self.client.get(url)

        self.assertEqual(authenticated_response.status_code, status.HTTP_200_OK)
        self.assertEqual(authenticated_response.data['summary']['week_start_date'], str(summary.week_start_date))
        self.assertEqual(authenticated_response.data['summary']['user_name'], 'Staff Member')

    def test_a_stored_hash_cannot_be_used_as_the_link(self):
        """Someone who can read the table still cannot open the summary."""
        summary = self.create_summary(self.staff_user, self.week_start_recent, self.week_end_recent)
        stored = hash_share_token('shared-token-123')
        WeeklySummaryShare.objects.create(summary=summary, shared_by=self.staff_user, share_token=stored)

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.get(reverse('summary-shared', kwargs={'token': stored}))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_shared_endpoint_handles_invalid_and_expired_tokens(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))

        invalid_token_response = self.client.get(reverse('summary-shared', kwargs={'token': 'not-a-real-token'}))
        self.assertEqual(invalid_token_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(invalid_token_response.data['error']['message'], 'Invalid share link')

        summary = self.create_summary(self.staff_user, self.week_start_recent, self.week_end_recent)
        WeeklySummaryShare.objects.create(
            summary=summary,
            shared_by=self.staff_user,
            share_token=hash_share_token('expired-token-123'),
            expires_at=timezone.now() - timedelta(minutes=1),
        )

        expired_response = self.client.get(reverse('summary-shared', kwargs={'token': 'expired-token-123'}))
        self.assertEqual(expired_response.status_code, status.HTTP_410_GONE)
        self.assertEqual(expired_response.data['error']['type'], 'gone')


class TaskDashboardApiTests(BaseAPITestCase):
    def create_task(self, *, assigned_by, assigned_to, status_value, priority, deadline_days, title):
        return Task.objects.create(
            title=title,
            description=f'Description for {title}',
            assigned_by=assigned_by,
            assigned_to=assigned_to,
            status=status_value,
            priority=priority,
            deadline=timezone.now() + timedelta(days=deadline_days),
        )

    def test_dashboard_endpoint_requires_authentication(self):
        response = self.client.get(reverse('task-dashboard'))

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_dashboard_endpoint_returns_aggregated_counts_without_page_crawling(self):
        for index in range(21):
            if index < 7:
                status_value = 'pending'
                priority = 'high'
            elif index < 14:
                status_value = 'in_progress'
                priority = 'medium'
            else:
                status_value = 'completed'
                priority = 'low'

            self.create_task(
                assigned_by=self.admin_user,
                assigned_to=self.staff_user,
                status_value=status_value,
                priority=priority,
                deadline_days=1,
                title=f'Assigned to staff {index}',
            )

        for index in range(6):
            if index < 3:
                status_value = 'pending'
                priority = 'high'
            elif index < 5:
                status_value = 'in_progress'
                priority = 'medium'
            else:
                status_value = 'completed'
                priority = 'low'

            self.create_task(
                assigned_by=self.staff_user,
                assigned_to=self.admin_user,
                status_value=status_value,
                priority=priority,
                deadline_days=1,
                title=f'Assigned by staff {index}',
            )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('task-dashboard'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)

        assigned_to = response.data['assigned_to']
        self.assertEqual(assigned_to['count'], 21)
        self.assertEqual(assigned_to['pending'], 7)
        self.assertEqual(assigned_to['in_progress'], 7)
        self.assertEqual(assigned_to['completed'], 7)
        self.assertEqual(assigned_to['high_priority'], 7)
        self.assertEqual(assigned_to['due_soon_or_overdue'], 14)
        self.assertEqual(len(assigned_to['tasks']), 5)

        assigned_by = response.data['assigned_by']
        self.assertEqual(assigned_by['count'], 6)
        self.assertEqual(assigned_by['pending'], 3)
        self.assertEqual(assigned_by['in_progress'], 2)
        self.assertEqual(assigned_by['completed'], 1)
        self.assertEqual(assigned_by['high_priority'], 3)
        self.assertEqual(assigned_by['due_soon_or_overdue'], 5)
        self.assertEqual(len(assigned_by['tasks']), 5)

        total = response.data['total']
        self.assertEqual(total['count'], 27)
        self.assertEqual(total['pending'], 10)
        self.assertEqual(total['in_progress'], 9)
        self.assertEqual(total['completed'], 8)
        self.assertEqual(total['overdue'], 0)

    def test_dashboard_endpoint_top_task_lists_are_limited_to_five_items(self):
        for index in range(8):
            self.create_task(
                assigned_by=self.admin_user,
                assigned_to=self.staff_user,
                status_value='pending',
                priority='medium',
                deadline_days=2,
                title=f'Top list task {index}',
            )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('task-dashboard'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['assigned_to']['tasks']), 5)


class GenerateUserSummariesCommandTests(BaseAPITestCase):
    def test_generate_user_summaries_skips_current_week(self):
        fixed_now = timezone.make_aware(datetime(2026, 5, 18, 12, 0, 0), datetime_timezone.utc)
        previous_week_monday = date(2026, 5, 11)
        week_before_previous_monday = date(2026, 5, 4)
        current_week_monday = date(2026, 5, 18)

        with patch(
            'tasks.management.commands.generate_user_summaries.timezone.now',
            return_value=fixed_now,
        ), patch(
            'tasks.management.commands.generate_user_summaries.calculate_user_weekly_summary',
            return_value=build_summary_data(),
        ) as mock_calculate:
            call_command('generate_user_summaries', '--weeks', '2', '--user-id', str(self.staff_user.id))

        self.assertEqual(mock_calculate.call_count, 2)
        self.assertEqual(mock_calculate.call_args_list[0].args[1], previous_week_monday)
        self.assertEqual(mock_calculate.call_args_list[1].args[1], week_before_previous_monday)
        self.assertFalse(WeeklySummary.objects.filter(week_start_date=current_week_monday).exists())
        self.assertTrue(WeeklySummary.objects.filter(week_start_date=previous_week_monday).exists())
        self.assertTrue(WeeklySummary.objects.filter(week_start_date=week_before_previous_monday).exists())


class WeeklySummaryDailyReportsTests(BaseAPITestCase):
    def test_weekly_summary_includes_daily_report_breakdown(self):
        week_start = date(2026, 5, 11)
        week_end = week_start + timedelta(days=6)

        daily_report = DailyReport.objects.create(
            user=self.staff_user,
            department=self.dep_eng,
            report_date=week_start,
        )
        DailyReportSubreport.objects.create(
            daily_report=daily_report,
            title='Morning update',
            created_by=self.staff_user,
        )
        DailyReportSubreport.objects.create(
            daily_report=daily_report,
            title='Afternoon follow-up',
            created_by=self.staff_user,
        )

        summary_data = calculate_user_weekly_summary(self.staff_user, week_start, week_end)

        self.assertEqual(summary_data['daily_reports_created'], 1)
        self.assertEqual(summary_data['daily_reports_subreports_created'], 2)
        self.assertEqual(len(summary_data['daily_reports']), 1)
        self.assertEqual(summary_data['daily_reports'][0]['title'], 'Morning update')
        self.assertEqual(summary_data['daily_reports'][0]['subreport_count'], 2)
