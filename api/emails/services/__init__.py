import logging
from typing import List, Dict, Any, Optional
from django.template.loader import render_to_string
from django.core.mail import EmailMultiAlternatives
from django.utils.html import strip_tags
from emails.config import EmailConfig, EmailType

logger = logging.getLogger(__name__)


class BaseEmailService:
    """
    Base class for all email services.
    Provides common functionality for sending emails.
    """

    email_type: EmailType = None
    template_name: str = None

    def __init__(self):
        if not self.email_type or not self.template_name:
            raise NotImplementedError(
                "Subclasses must define email_type and template_name"
            )

    @staticmethod
    def send_email(
        subject: str,
        recipients: List[str],
        template_name: str,
        context: Dict[str, Any],
        reply_to: Optional[str] = None,
    ) -> bool:
        """
        Send an email asynchronously using Celery or synchronously.

        Args:
            subject: Email subject
            recipients: List of recipient email addresses
            template_name: Path to email template (relative to templates/)
            context: Context data for template rendering
            reply_to: Optional reply-to email address

        Returns:
            bool: True if email was queued/sent, False otherwise
        """
        if not EmailConfig.is_enabled():
            logger.warning(
                f"Email sending disabled. Would send {subject} to {recipients}"
            )
            return False

        if not recipients:
            logger.warning("No recipients provided for email")
            return False

        if EmailConfig.use_celery():
            # Import here to avoid circular imports
            from emails.tasks import send_email_task
            send_email_task.delay(
                subject=subject,
                recipients=recipients,
                template_name=template_name,
                context=context,
                reply_to=reply_to,
            )
            return True
        else:
            # Send synchronously
            return BaseEmailService._send_sync(
                subject, recipients, template_name, context, reply_to
            )

    @staticmethod
    def _send_sync(
        subject: str,
        recipients: List[str],
        template_name: str,
        context: Dict[str, Any],
        reply_to: Optional[str] = None,
    ) -> bool:
        """Send email synchronously."""
        try:
            # Render template
            html_message = render_to_string(template_name, context)
            text_message = strip_tags(html_message)

            # Create email
            from_email = EmailConfig.format_from_email()
            email = EmailMultiAlternatives(
                subject=subject,
                body=text_message,
                from_email=from_email,
                to=recipients,
                reply_to=[reply_to] if reply_to else None,
            )
            email.attach_alternative(html_message, "text/html")

            # Send
            if EmailConfig.is_debug_mode():
                logger.info(
                    f"[DEBUG EMAIL] To: {recipients}\n"
                    f"Subject: {subject}\n"
                    f"Body:\n{text_message}"
                )
            else:
                email.send(fail_silently=False)

            logger.info(f"Email sent: {subject} to {recipients}")
            return True

        except Exception as e:
            logger.error(f"Failed to send email: {subject}. Error: {str(e)}")
            return False

    def send(self, recipients: List[str], context: Dict[str, Any]) -> bool:
        """
        Send email using the configured template and type.

        Args:
            recipients: List of recipient emails
            context: Context for template rendering

        Returns:
            bool: True if email was sent/queued successfully
        """
        subject = self._get_subject(context)
        return self.send_email(
            subject=subject,
            recipients=recipients,
            template_name=self.template_name,
            context=context,
        )

    def _get_subject(self, context: Dict[str, Any]) -> str:
        """
        Override in subclass to customize subject generation.
        """
        raise NotImplementedError("Subclasses must implement _get_subject()")
