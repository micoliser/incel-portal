import os
from django.test import TestCase
from django.contrib.auth import get_user_model
from unittest.mock import patch
from emails.config import EmailConfig
from emails.services.user_emails import UserEmailManager
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

        self.assertEqual(mock_send.call_count, 2)

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

    def test_email_config_format_from_email(self):
        """Test email from address formatting."""
        from_email = EmailConfig.format_from_email()
        self.assertIn('Incel Portal', from_email)
        self.assertIn('noreply', from_email)
