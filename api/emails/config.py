import os
from enum import Enum


class EmailType(Enum):
    """Email types supported by the system."""
    TASK_CREATED = "task_created"
    TASK_COMPLETED = "task_completed"
    RECURRING_TASK_CREATED = "recurring_task_created"
    RECURRING_TASK_UPDATED = "recurring_task_updated"
    RECURRING_TASK_PAUSED = "recurring_task_paused"
    RECURRING_TASK_RESUMED = "recurring_task_resumed"
    RECURRING_TASK_ENDED = "recurring_task_ended"
    APPLICATION_CREATED = "application_created"
    APPLICATION_ACCESS_GRANTED = "application_access_granted"
    APPLICATION_ACCESS_REVOKED = "application_access_revoked"
    USER_CREATED = "user_created"
    USER_PASSWORD_CHANGED = "user_password_changed"
    USER_STATUS_CHANGED = "user_status_changed"


class EmailConfig:
    """Centralized email configuration."""

    @staticmethod
    def is_enabled():
        """Check if email sending is enabled."""
        return os.getenv('EMAIL_ENABLED', 'True').lower() == 'true'

    @staticmethod
    def is_debug_mode():
        """Check if running in debug mode (console output)."""
        return os.getenv('EMAIL_DEBUG', 'False').lower() == 'true'

    @staticmethod
    def use_celery():
        """Check if Celery should be used for async sending."""
        return os.getenv('SEND_EMAILS_CELERY', 'True').lower() == 'true'

    @staticmethod
    def get_sender_name():
        """Get the email sender name."""
        return os.getenv('EMAIL_SENDER_NAME', 'Incel Portal')

    @staticmethod
    def get_default_from_email():
        """Get the default from email."""
        return os.getenv('DEFAULT_FROM_EMAIL', 'noreply@localhost')

    @staticmethod
    def format_from_email():
        """Format the from email with sender name."""
        sender_name = EmailConfig.get_sender_name()
        from_email = EmailConfig.get_default_from_email()
        return f"{sender_name} <{from_email}>"

    @staticmethod
    def get_backend():
        """Return the configured email backend (Django setting or env).

        This is used by management commands and tests to report which
        backend will be used for sending emails.
        """
        return os.getenv('EMAIL_BACKEND', 'django.core.mail.backends.smtp.EmailBackend')
