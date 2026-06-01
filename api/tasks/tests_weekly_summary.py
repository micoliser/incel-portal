from datetime import date, datetime, timedelta, timezone as datetime_timezone
from unittest.mock import patch

from django.contrib.auth.models import User
from django.core.management import call_command
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from common.test_utils import BaseAPITestCase
from tasks.management.commands import generate_user_summaries
from tasks.models import Task, WeeklySummary, WeeklySummaryShare
from tasks.models import DailyReport, DailyReportSubreport
from tasks.services import calculate_user_weekly_summary


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
        response = self.client.get(reverse('weekly-summary-available-weeks'))

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
        response = self.client.get(
            reverse('weekly-summary-summary'),
            {'week_start_date': str(self.week_start_recent)},
        )

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

    def test_summary_endpoint_validates_missing_and_unknown_weeks(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))

        missing_week_response = self.client.get(reverse('weekly-summary-summary'))
        self.assertEqual(missing_week_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', missing_week_response.data)

        unknown_week_response = self.client.get(
            reverse('weekly-summary-summary'),
            {'week_start_date': '2026-01-05'},
        )
        self.assertEqual(unknown_week_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn('error', unknown_week_response.data)

    def test_share_endpoint_creates_link_and_share_record(self):
        summary = self.create_summary(
            self.staff_user,
            self.week_start_recent,
            self.week_end_recent,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('weekly-summary-share'),
            {'week_start_date': str(summary.week_start_date)},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(response.data['share_link'].startswith('/summaries?token='))
        self.assertEqual(response.data['share_link'], f"/summaries?token={response.data['share_token']}")
        self.assertTrue(response.data['share_token'])
        self.assertTrue(WeeklySummaryShare.objects.filter(share_token=response.data['share_token']).exists())
        self.assertEqual(WeeklySummaryShare.objects.get(share_token=response.data['share_token']).summary, summary)

    def test_shared_endpoint_returns_summary_without_authentication(self):
        summary = self.create_summary(
            self.staff_user,
            self.week_start_recent,
            self.week_end_recent,
        )
        share = WeeklySummaryShare.objects.create(
            summary=summary,
            shared_by=self.staff_user,
            share_token='shared-token-123',
        )

        self.client.credentials()
        unauthenticated_response = self.client.get(
            reverse('weekly-summary-shared'),
            {'token': share.share_token},
        )

        self.assertEqual(unauthenticated_response.status_code, status.HTTP_401_UNAUTHORIZED)

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        authenticated_response = self.client.get(
            reverse('weekly-summary-shared'),
            {'token': share.share_token},
        )

        self.assertEqual(authenticated_response.status_code, status.HTTP_200_OK)
        self.assertEqual(authenticated_response.data['summary']['week_start_date'], str(summary.week_start_date))
        self.assertEqual(authenticated_response.data['summary']['user_name'], 'Staff Member')

    def test_shared_endpoint_handles_missing_invalid_and_expired_tokens(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))

        missing_token_response = self.client.get(reverse('weekly-summary-shared'))
        self.assertEqual(missing_token_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', missing_token_response.data)

        invalid_token_response = self.client.get(
            reverse('weekly-summary-shared'),
            {'token': 'not-a-real-token'},
        )
        self.assertEqual(invalid_token_response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn('error', invalid_token_response.data)

        summary = self.create_summary(
            self.staff_user,
            self.week_start_recent,
            self.week_end_recent,
        )
        expired_share = WeeklySummaryShare.objects.create(
            summary=summary,
            shared_by=self.staff_user,
            share_token='expired-token-123',
            expires_at=timezone.now() - timedelta(minutes=1),
        )

        expired_response = self.client.get(
            reverse('weekly-summary-shared'),
            {'token': expired_share.share_token},
        )
        self.assertEqual(expired_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('error', expired_response.data)


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
