import html as html_lib
import logging
import re
from typing import Any, Dict, List, Optional

from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db import transaction
from django.template.loader import render_to_string
from django.utils.html import strip_tags

from emails.config import EmailConfig, EmailType

logger = logging.getLogger(__name__)

_NON_TEXT_BLOCKS = re.compile(r'<(head|style|script)\b.*?</\1>', re.IGNORECASE | re.DOTALL)
_HIDDEN_PREHEADER = re.compile(r'<div style="display: none[^>]*>.*?</div>', re.IGNORECASE | re.DOTALL)
_LINK = re.compile(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.IGNORECASE | re.DOTALL)
_BREAKS = re.compile(r'<br\s*/?>|</(p|h1|h2|h3|tr|li|table)>', re.IGNORECASE)


def render_email(template_name: str, context: Dict[str, Any]) -> tuple[str, str]:
    """Render an email template to (html, plain text).

    Every template gets `portal_url` (the portal's address, no trailing
    slash) so links in emails are always absolute.
    """
    full_context = {'portal_url': settings.PORTAL_BASE_URL.rstrip('/'), **context}
    html = render_to_string(template_name, full_context)
    return html, html_to_text(html)


def html_to_text(html: str) -> str:
    """Readable plain-text part: no CSS, links kept as "label: url"."""
    text = _NON_TEXT_BLOCKS.sub('', html)
    text = _HIDDEN_PREHEADER.sub('', text)

    def link(match):
        url, label = match.group(1), strip_tags(match.group(2)).strip()
        return url if not label or label == url else f'{label}: {url}'

    text = _LINK.sub(link, text)
    text = re.sub(r'</th>', ': ', text, flags=re.IGNORECASE)
    text = re.sub(r'</td>', ' ', text, flags=re.IGNORECASE)
    text = _BREAKS.sub('\n', text)
    text = strip_tags(text)
    lines = [' '.join(line.split()) for line in text.splitlines()]
    text = '\n'.join(lines)
    text = re.sub(r'\n{3,}', '\n\n', text)
    return html_lib.unescape(text).strip() + '\n'


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

        # Inside a database transaction the email waits for the commit: if the
        # work is rolled back, nobody is told about something that never happened.
        if settings.EMAIL_SEND_ON_COMMIT and transaction.get_connection().in_atomic_block:
            transaction.on_commit(
                lambda: BaseEmailService._dispatch(subject, recipients, template_name, context, reply_to)
            )
            return True

        return BaseEmailService._dispatch(subject, recipients, template_name, context, reply_to)

    @staticmethod
    def _dispatch(
        subject: str,
        recipients: List[str],
        template_name: str,
        context: Dict[str, Any],
        reply_to: Optional[str] = None,
    ) -> bool:
        """Queue the email on Celery, or send it now when Celery is not in use."""
        if EmailConfig.use_celery():
            # Import here to avoid circular imports
            try:
                from emails.tasks import send_email_task

                send_email_task.delay(
                    subject=subject,
                    recipients=recipients,
                    template_name=template_name,
                    context=context,
                    reply_to=reply_to,
                )
                return True
            except Exception as e:
                # If Celery is unavailable (tests or broker down), fall back
                # to synchronous sending to avoid hard failures.
                logger.warning(
                    "Celery dispatch failed, falling back to sync send: %s", str(e)
                )
                return BaseEmailService._send_sync(
                    subject, recipients, template_name, context, reply_to
                )
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
            html_message, text_message = render_email(template_name, context)

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
                # Account emails carry password links, which must not reach
                # server logs. They are only printed on a developer's machine.
                is_account_email = template_name.startswith('emails/users/')
                body = '(not logged)' if is_account_email and not settings.DEBUG else text_message
                logger.info(
                    f"[DEBUG EMAIL] To: {recipients}\n"
                    f"Subject: {subject}\n"
                    f"Body:\n{body}"
                )
            else:
                email.send(fail_silently=False)

            logger.info(f"Email sent: {subject} to {recipients}")
            BaseEmailService._record(template_name, subject, recipients, 'sent')
            return True

        except Exception as e:
            logger.exception(f"Failed to send email: {subject}")
            BaseEmailService._record(template_name, subject, recipients, 'failed', str(e))
            return False

    @staticmethod
    def _record(template_name, subject, recipients, status, error=None):
        """Keep a row per send attempt (Django admin: Email logs), so a missing
        email can be traced without searching server logs."""
        from django.utils import timezone

        from emails.models import EmailLog

        try:
            EmailLog.objects.create(
                email_type=template_name.rsplit('/', 1)[-1].removesuffix('.html'),
                subject=subject[:255],
                recipients=list(recipients),
                status=status,
                error_message=error,
                sent_at=timezone.now() if status == 'sent' else None,
            )
        except Exception:
            logger.exception('Could not record the email log entry')

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
