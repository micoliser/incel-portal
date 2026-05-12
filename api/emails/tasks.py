import logging
from celery import shared_task
from django.template.loader import render_to_string
from django.core.mail import EmailMultiAlternatives
from django.utils.html import strip_tags
from emails.config import EmailConfig

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_email_task(
    self, subject, recipients, template_name, context, reply_to=None
):
    """
    Celery task to send emails asynchronously.

    Args:
        subject: Email subject
        recipients: List of recipient emails
        template_name: Email template path
        context: Template context
        reply_to: Optional reply-to email
    """
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

        logger.info(f"Email sent successfully: {subject} to {recipients}")
        return {'status': 'success', 'recipients': recipients}

    except Exception as exc:
        logger.error(f"Failed to send email: {subject}. Error: {str(exc)}")
        # Retry with exponential backoff
        raise self.retry(exc=exc)
