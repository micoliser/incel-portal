import logging
from typing import Any

from emails.config import EmailType
from emails.services.base_email_service import BaseEmailService

logger = logging.getLogger(__name__)


class SupportRequestSubmittedEmailService(BaseEmailService):
    email_type = EmailType.SUPPORT_REQUEST_SUBMITTED
    template_name = "emails/support/request_submitted.html"

    def _get_subject(self, context: dict[str, Any]) -> str:
        title = context.get('title', 'Support Request')
        return f'New Support Request: {title}'


class SupportRequestAssignedEmailService(BaseEmailService):
    email_type = EmailType.SUPPORT_REQUEST_ASSIGNED
    template_name = "emails/support/request_assigned.html"

    def _get_subject(self, context: dict[str, Any]) -> str:
        title = context.get('title', 'Support Request')
        return f'Support Request Assigned: {title}'


class SupportRequestResolvedEmailService(BaseEmailService):
    email_type = EmailType.SUPPORT_REQUEST_RESOLVED
    template_name = "emails/support/request_resolved.html"

    def _get_subject(self, context: dict[str, Any]) -> str:
        title = context.get('title', 'Support Request')
        return f'Support Request Resolved: {title}'


class SupportRequestClosedEmailService(BaseEmailService):
    email_type = EmailType.SUPPORT_REQUEST_CLOSED
    template_name = "emails/support/request_closed.html"

    def _get_subject(self, context: dict[str, Any]) -> str:
        title = context.get('title', 'Support Request')
        return f'Support Request Closed: {title}'
