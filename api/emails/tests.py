import os
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from unittest.mock import patch
from emails.config import EmailConfig
from emails.services.user_emails import UserEmailManager
from emails.services.summary_emails import SummaryEmailManager
from emails.services.task_emails import TaskEmailManager
from tasks.models import Task

User = get_user_model()


class EmailServiceTestCase(TestCase):
    """Test email services."""

    def setUp(self):
        # Ensure tests don't attempt to use Celery/Redis broker
        os.environ['SEND_EMAILS_CELERY'] = 'False'

        self.user = User.objects.create_user(
            username='testuser',
            email='test@example.com',
            password='testpass123'
        )

    def test_email_config_enabled(self):
        """Test email config is properly enabled."""
        self.assertTrue(EmailConfig.is_enabled())

    @override_settings(PORTAL_BASE_URL='http://localhost:3000')
    @patch('emails.services.base_email_service.BaseEmailService._send_sync')
    def test_user_created_email(self, mock_send):
        """Test user created email is sent."""
        mock_send.return_value = True
        
        UserEmailManager.send_user_created_email(
            self.user, 'temporary_password'
        )
        
        # Verify email was sent
        self.assertTrue(mock_send.called)

    @patch('emails.services.base_email_service.BaseEmailService._send_sync')
    def test_task_completed_email_uses_task_assignment_fields(self, mock_send):
        """Test task completed email sends for assigned_by/assigned_to models."""
        mock_send.return_value = True

        assignee = User.objects.create_user(
            username='assignee',
            email='assignee@example.com',
            password='testpass123'
        )
        task = Task.objects.create(
            title='Complete report',
            description='Finish the monthly report',
            assigned_by=self.user,
            assigned_to=assignee,
            status='completed',
        )

        mock_send.reset_mock()

        TaskEmailManager.send_task_completed_emails(task)

        self.assertEqual(mock_send.call_count, 1)

    @patch('emails.services.base_email_service.BaseEmailService._send_sync')
    def test_user_status_changed_email(self, mock_send):
        """Test enabled/disabled email sends when user is reactivated."""
        mock_send.return_value = True

        self.user.is_active = False
        self.user.save()
        self.user.refresh_from_db()

        self.user.is_active = True
        self.user.save()

        self.assertTrue(mock_send.called)

    @patch('emails.services.base_email_service.BaseEmailService._send_sync')
    def test_weekly_summary_email_uses_base_email_service(self, mock_send):
        """Test weekly summary email goes through the shared email service path."""
        mock_send.return_value = True

        summary_data = {
            'tasks_created': 4,
            'tasks_assigned': 7,
            'tasks_completed': 5,
            'completion_rate_percent': 71.43,
            'on_time_completion_rate_percent': 80.0,
            'comments_added': 2,
            'files_attached': 1,
            'summary_message': 'Test summary message',
            'week_start_date': '2026-05-11',
            'week_end_date': '2026-05-17',
        }

        result = SummaryEmailManager.send_weekly_summary_notification(
            self.user,
            summary_data,
            comparison_data={'trend': 'flat'},
        )

        self.assertTrue(result)
        self.assertEqual(mock_send.call_count, 1)

    def test_email_config_format_from_email(self):
        """Test email from address formatting."""
        from_email = EmailConfig.format_from_email()
        self.assertIn('Incel Portal', from_email)
        self.assertIn('noreply', from_email)


class ManagerEmailNotificationTestCase(TestCase):
    """Test manager notifications for tasks, recurring tasks, and weekly summaries."""

    def setUp(self):
        os.environ['SEND_EMAILS_CELERY'] = 'False'
        from organization.models import Role, Department, Unit, Team
        from accounts.models import StaffProfile

        self.role = Role.objects.create(name='Staff', code='STAFF')

        self.manager_a = User.objects.create_user(
            username='manager_a', email='manager_a@example.com', password='password123'
        )
        self.manager_b = User.objects.create_user(
            username='manager_b', email='manager_b@example.com', password='password123'
        )
        self.user_a = User.objects.create_user(
            username='user_a', email='user_a@example.com', password='password123'
        )
        self.user_b = User.objects.create_user(
            username='user_b', email='user_b@example.com', password='password123'
        )

        self.dept_a = Department.objects.create(name='Dept A', code='DA', line_manager=self.manager_a)
        self.dept_b = Department.objects.create(name='Dept B', code='DB', line_manager=self.manager_b)

        StaffProfile.objects.create(user=self.user_a, role=self.role, department=self.dept_a)
        StaffProfile.objects.create(user=self.user_b, role=self.role, department=self.dept_b)
        StaffProfile.objects.create(user=self.manager_a, role=self.role, department=self.dept_a)
        StaffProfile.objects.create(user=self.manager_b, role=self.role, department=self.dept_b)

    @patch('emails.services.base_email_service.BaseEmailService._send_sync')
    def test_task_created_notifies_both_different_managers(self, mock_send):
        """When user_a assigns task to user_b, assignee gets email, and both managers get tailored emails."""
        mock_send.return_value = True

        task = Task.objects.create(
            title='Prepare Financials',
            description='Q3 budget',
            assigned_by=self.user_a,
            assigned_to=self.user_b,
        )

        mock_send.reset_mock()
        TaskEmailManager.send_task_created_emails(task)

        # 1 to user_b, 1 to manager_b, 1 to manager_a
        self.assertEqual(mock_send.call_count, 3)

        recipients_contacted = [call_args[0][1][0] for call_args in mock_send.call_args_list]
        self.assertIn('user_b@example.com', recipients_contacted)
        self.assertIn('manager_b@example.com', recipients_contacted)
        self.assertIn('manager_a@example.com', recipients_contacted)

        subjects = {call_args[0][1][0]: call_args[0][0] for call_args in mock_send.call_args_list}
        self.assertIn("You've been assigned", subjects['user_b@example.com'])
        self.assertIn("[Task Assigned]", subjects['manager_b@example.com'])
        self.assertIn("[Task Delegation]", subjects['manager_a@example.com'])

    @patch('emails.services.base_email_service.BaseEmailService._send_sync')
    def test_task_created_shared_manager_sends_one_combined_email(self, mock_send):
        """When assignee and assigner share the same manager, manager receives exactly 1 combined email."""
        mock_send.return_value = True
        from accounts.models import StaffProfile

        user_a2 = User.objects.create_user(
            username='user_a2', email='user_a2@example.com', password='password123'
        )
        StaffProfile.objects.create(user=user_a2, role=self.role, department=self.dept_a)

        task = Task.objects.create(
            title='Internal Peer Task',
            assigned_by=self.user_a,
            assigned_to=user_a2,
        )

        mock_send.reset_mock()
        TaskEmailManager.send_task_created_emails(task)

        # 1 to user_a2, 1 combined to manager_a (not 2 separate emails to manager_a!)
        self.assertEqual(mock_send.call_count, 2)

        recipients = [call_args[0][1][0] for call_args in mock_send.call_args_list]
        self.assertEqual(recipients.count('manager_a@example.com'), 1)
        self.assertEqual(recipients.count('user_a2@example.com'), 1)

        subjects = {call_args[0][1][0]: call_args[0][0] for call_args in mock_send.call_args_list}
        self.assertIn("[Team Task]", subjects['manager_a@example.com'])

    @patch('emails.services.base_email_service.BaseEmailService._send_sync')
    def test_task_created_when_assigner_is_direct_manager_does_not_redundantly_notify(self, mock_send):
        """When manager directly assigns task to their report, manager is not redundantly emailed."""
        mock_send.return_value = True

        task = Task.objects.create(
            title='Direct Assignment',
            assigned_by=self.manager_b,
            assigned_to=self.user_b,
        )

        mock_send.reset_mock()
        TaskEmailManager.send_task_created_emails(task)

        # Only user_b receives an email, manager_b does not get an oversight email for their own assignment
        self.assertEqual(mock_send.call_count, 1)
        recipients = [call_args[0][1][0] for call_args in mock_send.call_args_list]
        self.assertIn('user_b@example.com', recipients)
        self.assertNotIn('manager_b@example.com', recipients)

    @patch('emails.services.base_email_service.BaseEmailService._send_sync')
    def test_task_completed_notifies_managers(self, mock_send):
        """When task is completed, assigner and both managers receive emails."""
        mock_send.return_value = True

        task = Task.objects.create(
            title='Audit Report',
            assigned_by=self.user_a,
            assigned_to=self.user_b,
            status='completed',
        )

        mock_send.reset_mock()
        TaskEmailManager.send_task_completed_emails(task)

        # 1 to assigner (user_a), 1 to manager_b, 1 to manager_a
        self.assertEqual(mock_send.call_count, 3)

        subjects = {call_args[0][1][0]: call_args[0][0] for call_args in mock_send.call_args_list}
        self.assertIn("Task completed:", subjects['user_a@example.com'])
        self.assertIn("[Task Completed]", subjects['manager_b@example.com'])
        self.assertIn("[Task Completed] Task delegated by", subjects['manager_a@example.com'])

    @patch('emails.services.base_email_service.BaseEmailService._send_sync')
    def test_recurring_task_lifecycle_notifies_managers(self, mock_send):
        """Recurring task events notify both assignee and direct managers."""
        mock_send.return_value = True
        from django.utils import timezone
        from tasks.models import RecurringSchedule

        schedule = RecurringSchedule.objects.create(
            title='Weekly Audit',
            assigned_by=self.user_a,
            assigned_to=self.user_b,
            frequency='weekly',
            interval=1,
            weekdays=[0],
            times=['09:00'],
            timezone='UTC',
            deadline_offset_minutes=120,
            start_at=timezone.now(),
        )

        mock_send.reset_mock()
        TaskEmailManager.send_recurring_task_created_emails(schedule)
        self.assertEqual(mock_send.call_count, 3)

        mock_send.reset_mock()
        TaskEmailManager.send_recurring_task_updated_emails(schedule)
        self.assertEqual(mock_send.call_count, 3)

        mock_send.reset_mock()
        TaskEmailManager.send_recurring_task_paused_emails(schedule)
        self.assertEqual(mock_send.call_count, 3)

        mock_send.reset_mock()
        TaskEmailManager.send_recurring_task_resumed_emails(schedule)
        self.assertEqual(mock_send.call_count, 3)

        mock_send.reset_mock()
        TaskEmailManager.send_recurring_task_ended_emails(schedule)
        self.assertEqual(mock_send.call_count, 3)

    @patch('emails.services.base_email_service.BaseEmailService._send_sync')
    def test_weekly_summary_notifies_user_and_direct_manager(self, mock_send):
        """Weekly summary sends email to user and a copy to their direct manager."""
        mock_send.return_value = True

        summary_data = {
            'tasks_completed': 5,
            'tasks_assigned': 6,
            'completion_rate_percent': 83.33,
            'on_time_completion_rate_percent': 100.0,
            'week_start_date': '2026-05-11',
            'week_end_date': '2026-05-17',
        }

        SummaryEmailManager.send_weekly_summary_notification(self.user_b, summary_data)

        # 1 to user_b, 1 to manager_b
        self.assertEqual(mock_send.call_count, 2)
        recipients = [call_args[0][1][0] for call_args in mock_send.call_args_list]
        self.assertIn('user_b@example.com', recipients)
        self.assertIn('manager_b@example.com', recipients)

        subjects = {call_args[0][1][0]: call_args[0][0] for call_args in mock_send.call_args_list}
        self.assertIn("Your Weekly Summary", subjects['user_b@example.com'])
        self.assertIn("Weekly Summary for", subjects['manager_b@example.com'])

    def test_team_lead_escalates_to_supervisor_direct_manager(self):
        """If user is a Team Lead, their direct manager escalates to the Unit Supervisor."""
        from organization.models import Unit, Team
        from accounts.models import StaffProfile

        supervisor = User.objects.create_user(
            username='sup', email='sup@example.com', password='password123'
        )
        team_lead = User.objects.create_user(
            username='lead', email='lead@example.com', password='password123'
        )

        unit = Unit.objects.create(name='Dev Unit', code='DEV_U', department=self.dept_a, supervisor=supervisor)
        team = Team.objects.create(name='Dev Team', code='DEV_T', unit=unit, team_lead=team_lead)

        profile = StaffProfile.objects.create(user=team_lead, role=self.role, team=team)
        profile.clean()

        from emails.utils import get_direct_manager
        resolved_manager = get_direct_manager(team_lead)
        self.assertEqual(resolved_manager, supervisor)

