from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import override_settings
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

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    @patch('emails.config.EmailConfig.is_debug_mode', return_value=False)
    @patch('emails.config.EmailConfig.use_celery', return_value=False)
    @patch('emails.config.EmailConfig.is_enabled', return_value=True)
    def test_owner_can_forward_daily_report_email(self, *_mocks):
        create_response = self._create_report(
            title='Morning standup',
            comment='Shipped the API changes.',
        )
        report_id = create_response.data['daily_report_id']
        report = DailyReport.objects.get(id=report_id)

        second_subreport = DailyReportSubreport.objects.create(
            daily_report=report,
            title='Afternoon sync',
            created_by=self.staff_user,
        )
        DailyReportComment.objects.create(
            subreport=second_subreport,
            author=self.staff_user,
            body='Blocked on review.',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('reports-daily-send-email', kwargs={'report_id': report_id}),
            {'recipients': ['colleague@example.com', 'manager@example.com']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('2 recipients', response.data['detail'])

        from django.core import mail

        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ['colleague@example.com', 'manager@example.com'])
        self.assertEqual(message.reply_to, ['staff@example.com'])
        self.assertIn('Morning standup', message.body)
        self.assertIn('Afternoon sync', message.body)
        self.assertIn('Shipped the API changes.', message.body)
        self.assertIn('Blocked on review.', message.body)
        self.assertIn(f'/reports/daily/{report_id}', message.body)

    def test_non_owner_cannot_forward_daily_report_email(self):
        create_response = self._create_report(
            title='Engineering update',
            comment='Team note.',
        )
        report_id = create_response.data['daily_report_id']

        self.client.credentials(**self.auth_headers_for(self.hr_user))
        response = self.client.post(
            reverse('reports-daily-send-email', kwargs={'report_id': report_id}),
            {'recipients': ['someone@example.com']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_global_admin_cannot_forward_someone_elses_report(self):
        create_response = self._create_report(
            title='Staff report',
            comment='Only owner should send.',
        )
        report_id = create_response.data['daily_report_id']

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('reports-daily-send-email', kwargs={'report_id': report_id}),
            {'recipients': ['admin-forward@example.com']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_send_email_rejects_duplicate_recipients(self):
        create_response = self._create_report()
        report_id = create_response.data['daily_report_id']

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('reports-daily-send-email', kwargs={'report_id': report_id}),
            {'recipients': ['dup@example.com', 'dup@example.com']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['error']['type'], 'validation_error')

    def test_send_email_rejects_more_than_five_recipients(self):
        create_response = self._create_report()
        report_id = create_response.data['daily_report_id']

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('reports-daily-send-email', kwargs={'report_id': report_id}),
            {
                'recipients': [
                    'a@example.com',
                    'b@example.com',
                    'c@example.com',
                    'd@example.com',
                    'e@example.com',
                    'f@example.com',
                ],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    @patch('emails.config.EmailConfig.is_enabled', return_value=False)
    def test_send_email_returns_503_when_email_disabled(self, _mock_enabled):
        create_response = self._create_report()
        report_id = create_response.data['daily_report_id']

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('reports-daily-send-email', kwargs={'report_id': report_id}),
            {'recipients': ['someone@example.com']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)

    @patch('emails.config.EmailConfig.is_enabled', return_value=True)
    @patch('emails.services.daily_report_emails.DailyReportForwardEmailService.send_email', return_value=False)
    def test_send_email_returns_502_when_delivery_fails(self, _mock_send, _mock_enabled):
        create_response = self._create_report()
        report_id = create_response.data['daily_report_id']

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('reports-daily-send-email', kwargs={'report_id': report_id}),
            {'recipients': ['someone@example.com']},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)

    @patch('emails.services.daily_report_emails.DailyReportForwardEmailService.send_email', return_value=True)
    def test_first_report_sends_manager_email(self, mock_send):
        # Create department and assign manager
        from organization.models import Department
        from accounts.models import StaffProfile
        
        dept = Department.objects.create(name='Test Dept', code='TD', line_manager_id=self.admin_user.id)
        
        profile = self.staff_user.staff_profile
        profile.department_id = dept.id
        profile.save()
        
        # First subreport should trigger email
        self._create_report(title='First')
        self.assertEqual(mock_send.call_count, 1)
        
        # Second subreport should NOT trigger email
        self._create_report(title='Second')
        self.assertEqual(mock_send.call_count, 1)
        
    @patch('emails.services.daily_report_emails.DailyReportForwardEmailService.send_email', return_value=True)
    def test_eod_report_sends_manager_email(self, mock_send):
        # Create department and assign manager
        from organization.models import Department
        from accounts.models import StaffProfile
        
        dept = Department.objects.create(name='Test Dept', code='TD', line_manager_id=self.admin_user.id)
        
        profile = self.staff_user.staff_profile
        profile.department_id = dept.id
        profile.save()
        
        self._create_report(title='First')
        
        # Reset mock call count because the first creation triggers an email
        mock_send.reset_mock()
        
        from tasks.tasks import send_eod_daily_reports
        result = send_eod_daily_reports()
        
        self.assertEqual(result['sent'], 1)
        self.assertEqual(mock_send.call_count, 1)
