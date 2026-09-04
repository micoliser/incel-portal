import logging
from typing import Any

from emails.services.base_email_service import BaseEmailService
from emails.config import EmailType

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


class SupportStatusUpdatedEmailService(BaseEmailService):
    email_type = EmailType.SUPPORT_STATUS_UPDATED
    template_name = "emails/support/status_updated.html"

    def _get_subject(self, context: dict[str, Any]) -> str:
        title = context.get('title', 'Support Request')
        return f'Support Request Updated: {title}'


class SupportCommentAddedEmailService(BaseEmailService):
    email_type = EmailType.SUPPORT_COMMENT_ADDED
    template_name = "emails/support/comment_added.html"

    def _get_subject(self, context: dict[str, Any]) -> str:
        title = context.get('title', 'Support Request')
        return f'New Comment on: {title}'


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
