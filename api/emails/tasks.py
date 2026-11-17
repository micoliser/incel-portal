import logging

from celery import shared_task

logger = logging.getLogger(__name__)


class EmailSendFailed(RuntimeError):
    pass


@shared_task(bind=True, max_retries=3, default_retry_delay=60)
def send_email_task(self, subject, recipients, template_name, context, reply_to=None):
    """Send one email from a worker, retrying up to three times a minute apart.

    Sending, logging and the email log record are the same as for an email
    sent in-process (BaseEmailService._send_sync).
    """
    from emails.services.base_email_service import BaseEmailService

    if BaseEmailService._send_sync(subject, recipients, template_name, context, reply_to):
        return {'status': 'success', 'recipients': recipients}
    raise self.retry(exc=EmailSendFailed(f'Failed to send email: {subject}'))
