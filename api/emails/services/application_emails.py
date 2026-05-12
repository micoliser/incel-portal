from typing import List, Dict, Any
from emails.services.base_email_service import BaseEmailService
from emails.config import EmailType


class ApplicationCreatedEmailService(BaseEmailService):
    """Send email when application is created."""

    email_type = EmailType.APPLICATION_CREATED
    template_name = "emails/applications/application_created.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        app_name = context.get('application_name', 'Application')
        return f"New application available: {app_name}"


class ApplicationAccessGrantedEmailService(BaseEmailService):
    """Send email when user is granted access to application."""

    email_type = EmailType.APPLICATION_ACCESS_GRANTED
    template_name = "emails/applications/application_access_granted.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        app_name = context.get('application_name', 'Application')
        return f"You now have access to {app_name}"


class ApplicationAccessRevokedEmailService(BaseEmailService):
    """Send email when user's access to application is revoked."""

    email_type = EmailType.APPLICATION_ACCESS_REVOKED
    template_name = "emails/applications/application_access_revoked.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        app_name = context.get('application_name', 'Application')
        return f"Your access to {app_name} has been revoked"


class ApplicationEmailManager:
    """Manager for application-related emails."""

    @staticmethod
    def send_application_created_emails(application: Any, recipients: List[str]) -> None:
        """
        Send email to all users with access to new application.

        Args:
            application: Application instance
            recipients: List of user emails who have access
        """
        context = {
            'application_id': str(application.id),
            'application_name': application.name,
            'application_url': application.app_url,
            'description': application.description,
            'logo_url': application.logo_url,
        }

        service = ApplicationCreatedEmailService()
        service.send(recipients, context)

    @staticmethod
    def send_access_granted_email(
        application: Any, user_email: str, reason: str = None
    ) -> None:
        """Send email when user is granted access via override."""
        context = {
            'application_id': str(application.id),
            'application_name': application.name,
            'application_url': application.app_url,
            'reason': reason or 'You have been granted access to this application',
            'logo_url': application.logo_url,
        }

        service = ApplicationAccessGrantedEmailService()
        service.send([user_email], context)

    @staticmethod
    def send_access_revoked_email(
        application: Any, user_email: str, reason: str = None
    ) -> None:
        """Send email when user's access is revoked via override."""
        context = {
            'application_id': str(application.id),
            'application_name': application.name,
            'reason': reason
            or 'Your access to this application has been revoked',
        }

        service = ApplicationAccessRevokedEmailService()
        service.send([user_email], context)

    @staticmethod
    def send_departmental_access_revoked_emails(
        application: Any,
        user_emails: List[str],
        reason: str = None,
    ) -> None:
        """Send revoke emails when department-based access is removed."""
        context = {
            'application_id': str(application.id),
            'application_name': application.name,
            'application_url': application.app_url,
            'reason': reason or 'Your department no longer has access to this application',
        }

        service = ApplicationAccessRevokedEmailService()
        service.send(user_emails, context)

    @staticmethod
    def send_departmental_access_emails(
        application: Any, new_user_emails: List[str]
    ) -> None:
        """
        Send email to users who gained access through department change.

        Args:
            application: Application instance
            new_user_emails: List of emails newly granted access
        """
        context = {
            'application_id': str(application.id),
            'application_name': application.name,
            'application_url': application.app_url,
            'description': application.description,
            'logo_url': application.logo_url,
        }

        service = ApplicationCreatedEmailService()
        service.send(new_user_emails, context)

    @staticmethod
    def send_application_created_to_users(application: Any) -> None:
        """Send application-created email to users who can access the app."""
        from emails.utils import EmailNotificationHelper

        if application.access_scope == application.AccessScope.ALL_AUTHENTICATED:
            recipients = EmailNotificationHelper.get_all_active_user_emails()
        else:
            recipients = []
            for department in application.departments.all():
                recipients.extend(EmailNotificationHelper.get_department_users(department.id))
            recipients = list(dict.fromkeys(recipients))

        if recipients:
            ApplicationEmailManager.send_application_created_emails(application, recipients)
