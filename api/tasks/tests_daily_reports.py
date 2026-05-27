from datetime import timedelta

from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from accounts.models import StaffProfile
from common.test_utils import BaseAPITestCase
from tasks.models import DailyReport, DailyReportComment, DailyReportSubreport


class DailyReportsApiTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.hr_user = User.objects.create_user(
            username='hr@example.com',
            email='hr@example.com',
            password='HrStrongPass123!',
            first_name='HR',
            last_name='Member',
        )
        StaffProfile.objects.create(
            user=self.hr_user,
            role=self.role_staff,
            department=self.dep_hr,
        )

    def _create_report(self, report_date=None, title='Morning update', comment='Initial note'):
        if report_date is None:
            report_date = timezone.localdate().isoformat()

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('reports-day-hub'),
            {
                'report_date': report_date,
                'title': title,
                'comment': comment,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return response

    def test_day_hub_does_not_create_reports_on_get_and_excludes_other_departments(self):
        today = timezone.localdate()
        today_str = today.isoformat()

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(
            reverse('reports-day-hub'),
            {'report_date': today_str},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIsNone(response.data['your_report'])
        self.assertEqual(response.data['all_reports'], [])
        self.assertEqual(
            DailyReport.objects.filter(report_date=today).count(),
            0,
        )

        self._create_report(title='Engineering update', comment='Engineering note')

        self.client.credentials(**self.auth_headers_for(self.hr_user))
        hr_response = self.client.post(
            reverse('reports-day-hub'),
            {
                'report_date': today_str,
                'title': 'HR update',
                'comment': 'HR note',
            },
            format='json',
        )
        self.assertEqual(hr_response.status_code, status.HTTP_201_CREATED)

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(
            reverse('reports-day-hub'),
            {'report_date': today_str},
        )

        report_creator_ids = {item['creator']['id'] for item in response.data['all_reports']}
        self.assertIn(self.staff_user.id, report_creator_ids)
        self.assertNotIn(self.hr_user.id, report_creator_ids)

        self.assertEqual(
            DailyReport.objects.filter(report_date=today, department=self.dep_eng).count(),
            1,
        )

    def test_month_calendar_returns_dates_with_reports(self):
        today = timezone.localdate()
        self._create_report()

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(
            reverse('reports-month-calendar'),
            {'month': today.strftime('%Y-%m')},
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        report_dates = {item['report_date']: item for item in response.data['dates']}
        today_str = today.isoformat()
        self.assertIn(today_str, report_dates)
        self.assertEqual(report_dates[today_str]['report_count'], 1)
        self.assertEqual(report_dates[today_str]['subreport_count'], 1)
        self.assertTrue(report_dates[today_str]['has_your_report'])

    def test_create_report_adds_subreport_and_initial_comment(self):
        response = self._create_report(title='Daily sync', comment='Finished the initial draft.')

        report = DailyReport.objects.get(user=self.staff_user, report_date=timezone.localdate())
        subreports = report.subreports.all()
        self.assertEqual(subreports.count(), 1)
        subreport = subreports.first()
        self.assertEqual(subreport.title, 'Daily sync')
        self.assertEqual(subreport.comments.count(), 1)
        self.assertEqual(subreport.comments.first().body, 'Finished the initial draft.')
        self.assertEqual(response.data['title'], 'Daily sync')
        self.assertEqual(response.data['comments'][0]['body'], 'Finished the initial draft.')

    def test_additional_report_can_be_created_without_report_date(self):
        self._create_report(title='Daily sync', comment='Finished the initial draft.')
        daily_report = DailyReport.objects.get(user=self.staff_user, report_date=timezone.localdate())

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('reports-daily-subreports-create', kwargs={'report_id': daily_report.id}),
            {
                'title': 'Follow-up update',
                'comment': 'Second report without a date payload.',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['title'], 'Follow-up update')
        self.assertEqual(response.data['comments'][0]['body'], 'Second report without a date payload.')
        self.assertEqual(daily_report.subreports.count(), 2)

    def test_daily_report_detail_lists_subreports(self):
        create_response = self._create_report(title='Top level title', comment='Initial body')
        daily_report = DailyReport.objects.get(user=self.staff_user, report_date=timezone.localdate())

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('reports-daily-detail', kwargs={'report_id': daily_report.id}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['id'], str(daily_report.id))
        self.assertEqual(response.data['subreports'][0]['title'], 'Top level title')
        self.assertEqual(response.data['subreports'][0]['view_url'], f'/reports/subreports/{create_response.data["id"]}')

    def test_subreport_detail_returns_comments_and_allows_append_owner_only(self):
        create_response = self._create_report(title='Standup', comment='First comment')
        subreport_id = create_response.data['id']

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('reports-subreport-detail', kwargs={'subreport_id': subreport_id}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data['comments']), 1)
        self.assertEqual(response.data['comments'][0]['body'], 'First comment')

        append_response = self.client.post(
            reverse('reports-subreport-comments', kwargs={'subreport_id': subreport_id}),
            {'body': 'Second comment'},
            format='json',
        )
        self.assertEqual(append_response.status_code, status.HTTP_201_CREATED)

        response = self.client.get(reverse('reports-subreport-detail', kwargs={'subreport_id': subreport_id}))
        self.assertEqual(len(response.data['comments']), 2)
        self.assertEqual(response.data['comments'][0]['body'], 'First comment')
        self.assertEqual(response.data['comments'][1]['body'], 'Second comment')

        self.client.credentials(**self.auth_headers_for(self.hr_user))
        forbidden_response = self.client.post(
            reverse('reports-subreport-comments', kwargs={'subreport_id': subreport_id}),
            {'body': 'Should not be allowed'},
            format='json',
        )
        self.assertEqual(forbidden_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_department_user_cannot_view_other_department_report(self):
        self._create_report()
        daily_report = DailyReport.objects.get(user=self.staff_user, report_date=timezone.localdate())

        self.client.credentials(**self.auth_headers_for(self.hr_user))
        response = self.client.get(reverse('reports-daily-detail', kwargs={'report_id': daily_report.id}))

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_cannot_create_report_for_past_or_future_date(self):
        today = timezone.localdate()
        past_date = (today - timedelta(days=1)).isoformat()
        future_date = (today + timedelta(days=1)).isoformat()

        self.client.credentials(**self.auth_headers_for(self.staff_user))

        past_response = self.client.post(
            reverse('reports-day-hub'),
            {
                'report_date': past_date,
                'title': 'Past report',
                'comment': 'Should be rejected.',
            },
            format='json',
        )
        future_response = self.client.post(
            reverse('reports-day-hub'),
            {
                'report_date': future_date,
                'title': 'Future report',
                'comment': 'Should also be rejected.',
            },
            format='json',
        )

        self.assertEqual(past_response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(future_response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_cannot_add_subreport_to_non_current_day_report(self):
        past_report = DailyReport.objects.create(
            user=self.staff_user,
            department=self.dep_eng,
            report_date=timezone.localdate() - timedelta(days=1),
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('reports-daily-subreports-create', kwargs={'report_id': past_report.id}),
            {
                'title': 'Past day subreport',
                'comment': 'Should not be allowed.',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(past_report.subreports.count(), 0)

    def test_cannot_add_comment_to_non_current_day_subreport(self):
        past_report = DailyReport.objects.create(
            user=self.staff_user,
            department=self.dep_eng,
            report_date=timezone.localdate() - timedelta(days=1),
        )
        past_subreport = DailyReportSubreport.objects.create(
            daily_report=past_report,
            title='Past report entry',
            created_by=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('reports-subreport-comments', kwargs={'subreport_id': past_subreport.id}),
            {'body': 'Should be blocked.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(past_subreport.comments.count(), 0)
