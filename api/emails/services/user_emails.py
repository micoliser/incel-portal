from django.conf import settings
from typing import Dict, Any
from emails.services.base_email_service import BaseEmailService
from emails.config import EmailType


class UserCreatedEmailService(BaseEmailService):
    """Send email when user account is created."""

    email_type = EmailType.USER_CREATED
    template_name = "emails/users/user_created.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        return "Welcome to Incel Portal - Account Created"


class UserPasswordChangedEmailService(BaseEmailService):
    """Send email when user password is changed/reset."""

    email_type = EmailType.USER_PASSWORD_CHANGED
    template_name = "emails/users/user_password_changed.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        action = context.get('action', 'reset')
        return f"Your password has been {action}"


class UserStatusChangedEmailService(BaseEmailService):
    """Send email when user is enabled/disabled."""

    email_type = EmailType.USER_STATUS_CHANGED
    template_name = "emails/users/user_status_changed.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        is_active = context.get('is_active', False)
        status = "activated" if is_active else "deactivated"
        return f"Your account has been {status}"


class UserEmailManager:
    """Manager for user-related emails."""

    @staticmethod
    def send_user_created_email(user: Any, temporary_password: str) -> None:
        """
        Send welcome email with account creation details.

        Args:
            user: User instance
            temporary_password: Temporary password or reset link
        """
        context = {
            'user_id': str(user.id),
            'username': user.username,
            'email': user.email,
            'first_name': user.first_name or user.username,
            'temporary_password': temporary_password,
            'login_url': f"{settings.PORTAL_BASE_URL.rstrip('/')}/login",
        }

        service = UserCreatedEmailService()
        service.send([user.email], context)

    @staticmethod
    def send_password_changed_email(
        user: Any,
        action: str = 'changed',
        temporary_password: str = None,
    ) -> None:
        """
        Send email when password is changed or reset.

        Args:
            user: User instance
            action: 'changed' or 'reset'
            temporary_password: Temporary password for reset flows
        """
        context = {
            'username': user.username,
            'email': user.email,
            'first_name': user.first_name or user.username,
            'action': action.lower(),
            'temporary_password': temporary_password,
        }

        service = UserPasswordChangedEmailService()
        service.send([user.email], context)

    @staticmethod
    def send_user_status_changed_email(user: Any) -> None:
        """Send email when user account is enabled/disabled."""
        context = {
            'username': user.username,
            'email': user.email,
            'first_name': user.first_name or user.username,
            'is_active': user.is_active,
            'status': 'activated' if user.is_active else 'deactivated',
        }

        service = UserStatusChangedEmailService()
        service.send([user.email], context)
