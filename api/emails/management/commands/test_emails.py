"""Management command to test the email system."""

from django.core.management.base import BaseCommand, CommandError
from django.contrib.auth import get_user_model
from emails.config import EmailConfig
from emails.services.user_emails import UserEmailManager
from emails.services.task_emails import TaskEmailManager
from emails.services.application_emails import ApplicationEmailManager

User = get_user_model()


class Command(BaseCommand):
    help = 'Test the email notification system'

    def add_arguments(self, parser):
        parser.add_argument(
            '--type',
            type=str,
            default='user_created',
            help='Email type to test: user_created, password_changed, user_status_changed, task_created, app_created',
        )
        parser.add_argument(
            '--email',
            type=str,
            help='Email address to send test email to',
        )
        parser.add_argument(
            '--user-id',
            type=str,
            help='User ID for user-related tests',
        )
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Verbose output',
        )

    def handle(self, *args, **options):
        email_type = options['type']
        email_address = options['email']
        user_id = options['user_id']
        verbose = options['verbose']

        # Check if email is enabled
        if not EmailConfig.is_enabled():
            self.stdout.write(
                self.style.WARNING('⚠️  Email notifications are disabled (EMAIL_ENABLED=False)')
            )
            return

        self.stdout.write(self.style.HTTP_INFO(f'🔍 Testing email system...'))
        self.stdout.write(f'Email Backend: {EmailConfig.get_backend()}')
        self.stdout.write(f'Debug Mode: {EmailConfig.is_debug_mode()}')
        self.stdout.write(f'Async (Celery): {EmailConfig.use_celery()}')
        self.stdout.write('')

        try:
            if email_type == 'user_created':
                self._test_user_created(email_address, verbose)
            elif email_type == 'password_changed':
                self._test_password_changed(user_id, verbose)
            elif email_type == 'user_status_changed':
                self._test_user_status_changed(user_id, verbose)
            elif email_type == 'task_created':
                self._test_task_created(verbose)
            elif email_type == 'app_created':
                self._test_app_created(verbose)
            else:
                raise CommandError(f'Unknown email type: {email_type}')

            self.stdout.write(self.style.SUCCESS('✅ Email test completed!'))
            
            if EmailConfig.is_debug_mode():
                self.stdout.write(
                    self.style.WARNING(
                        '💡 Running in debug mode - email was logged to console instead of being sent'
                    )
                )

        except Exception as e:
            raise CommandError(f'Error testing email: {str(e)}')

    def _test_user_created(self, email_address=None, verbose=False):
        """Test user created email."""
        self.stdout.write('📧 Testing: User Created Email')
        
        # Get or create test user
        if email_address:
            user = User.objects.filter(email=email_address).first()
            if not user:
                raise CommandError(f'User with email {email_address} not found')
        else:
            user = User.objects.first()
            if not user:
                raise CommandError('No users found in database. Create a user first.')

        self.stdout.write(f'Recipient: {user.email}')
        
        # Send test email
        UserEmailManager.send_user_created_email(user, 'TempPassword123!')
        self.stdout.write(self.style.SUCCESS('✓ User created email sent'))

    def _test_password_changed(self, user_id=None, verbose=False):
        """Test password changed email."""
        self.stdout.write('📧 Testing: Password Changed Email')
        
        # Get user
        if user_id:
            user = User.objects.filter(id=user_id).first()
            if not user:
                raise CommandError(f'User with ID {user_id} not found')
        else:
            user = User.objects.first()
            if not user:
                raise CommandError('No users found in database')

        self.stdout.write(f'Recipient: {user.email}')
        
        # Send test email
        UserEmailManager.send_password_changed_email(user, action='changed')
        self.stdout.write(self.style.SUCCESS('✓ Password changed email sent'))

    def _test_user_status_changed(self, user_id=None, verbose=False):
        """Test user status changed email."""
        self.stdout.write('📧 Testing: User Status Changed Email')
        
        # Get user
        if user_id:
            user = User.objects.filter(id=user_id).first()
            if not user:
                raise CommandError(f'User with ID {user_id} not found')
        else:
            user = User.objects.first()
            if not user:
                raise CommandError('No users found in database')

        self.stdout.write(f'Recipient: {user.email}')
        self.stdout.write(f'Status: {"Active" if user.is_active else "Inactive"}')
        
        # Send test email
        UserEmailManager.send_user_status_changed_email(user)
        self.stdout.write(self.style.SUCCESS('✓ User status changed email sent'))

    def _test_task_created(self, verbose=False):
        """Test task created email."""
        self.stdout.write('📧 Testing: Task Created Email')
        
        from tasks.models import Task
        
        # Get a sample task
        task = Task.objects.first()
        if not task:
            raise CommandError('No tasks found in database. Create a task first.')

        self.stdout.write(f'Task: {task.title}')
        self.stdout.write(f'Assigned to: {task.assigned_to.email}')
        self.stdout.write(f'Created by: {task.created_by.email}')
        
        # Send test email
        TaskEmailManager.send_task_created_emails(task)
        self.stdout.write(self.style.SUCCESS('✓ Task created email sent'))

    def _test_app_created(self, verbose=False):
        """Test application created email."""
        self.stdout.write('📧 Testing: Application Created Email')
        
        from applications.models import Application
        
        # Get a sample application
        app = Application.objects.first()
        if not app:
            raise CommandError('No applications found in database')

        self.stdout.write(f'Application: {app.name}')
        
        # Get admin users or first users
        users = User.objects.filter(is_staff=True)[:5]
        if not users:
            users = User.objects.all()[:5]
        
        emails = [user.email for user in users]
        self.stdout.write(f'Recipients: {", ".join(emails)}')
        
        # Send test email
        ApplicationEmailManager.send_application_created_emails(app, emails)
        self.stdout.write(self.style.SUCCESS('✓ Application created email sent'))
