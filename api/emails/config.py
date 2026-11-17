from enum import Enum

from django.conf import settings


class EmailType(Enum):
    """Email types supported by the system."""
    TASK_CREATED = "task_created"
    TASK_COMPLETED = "task_completed"
    TASK_UPDATED = "task_updated"
    TASK_SUBMITTED_FOR_REVIEW = "task_submitted_for_review"
    TASK_REVISION_REQUESTED = "task_revision_requested"
    WEEKLY_SUMMARY = "weekly_summary"
    RECURRING_TASK_CREATED = "recurring_task_created"
    RECURRING_TASK_UPDATED = "recurring_task_updated"
    RECURRING_TASK_PAUSED = "recurring_task_paused"
    RECURRING_TASK_RESUMED = "recurring_task_resumed"
    RECURRING_TASK_ENDED = "recurring_task_ended"
    APPLICATION_CREATED = "application_created"
    APPLICATION_ACCESS_GRANTED = "application_access_granted"
    APPLICATION_ACCESS_REVOKED = "application_access_revoked"
    USER_CREATED = "user_created"
    USER_PASSWORD_RESET = "user_password_reset"
    USER_PASSWORD_CHANGED = "user_password_changed"
    USER_STATUS_CHANGED = "user_status_changed"
    DAILY_REPORT_FORWARD = "daily_report_forward"
    SUPPORT_REQUEST_SUBMITTED = "support_request_submitted"
    SUPPORT_REQUEST_ASSIGNED = "support_request_assigned"
    SUPPORT_STATUS_UPDATED = "support_status_updated"
    SUPPORT_COMMENT_ADDED = "support_comment_added"
    SUPPORT_REQUEST_RESOLVED = "support_request_resolved"
    SUPPORT_REQUEST_CLOSED = "support_request_closed"
    TODO_REMINDER = "todo_reminder"


class EmailConfig:
    """Email configuration, read from Django settings."""

    @staticmethod
    def is_enabled():
        """Check if email sending is enabled."""
        return settings.EMAIL_ENABLED

    @staticmethod
    def is_debug_mode():
        """Check if running in debug mode (emails are logged, not sent)."""
        return settings.EMAIL_DEBUG

    @staticmethod
    def use_celery():
        """Check if Celery should be used for async sending."""
        return settings.SEND_EMAILS_CELERY

    @staticmethod
    def get_sender_name():
        """Get the email sender name."""
        return settings.EMAIL_SENDER_NAME

    @staticmethod
    def get_default_from_email():
        """Get the default from email."""
        return settings.DEFAULT_FROM_EMAIL

    @staticmethod
    def format_from_email():
        """Format the from email with sender name."""
        sender_name = EmailConfig.get_sender_name()
        from_email = EmailConfig.get_default_from_email()
        return f"{sender_name} <{from_email}>"

    @staticmethod
    def get_backend():
        """Return the email backend in use, for management commands to report."""
        return settings.EMAIL_BACKEND
