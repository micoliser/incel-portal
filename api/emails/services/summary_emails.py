"""Email service for weekly summary notifications."""

import logging
from typing import Any, Dict

from django.contrib.auth.models import User

from emails.config import EmailType
from emails.services.base_email_service import BaseEmailService


logger = logging.getLogger(__name__)


class WeeklySummaryEmailService(BaseEmailService):
    """Send weekly summary emails using the shared email service pattern."""

    email_type = EmailType.WEEKLY_SUMMARY
    template_name = "weekly_summary_notification.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        week_start = context.get('week_start_display') or context.get('week_start') or 'this week'
        return f"Your Weekly Summary - Week of {week_start}"


class SummaryEmailManager:
    @staticmethod
    def send_weekly_summary_notification(
        user: User,
        summary_data: dict,
        comparison_data: dict | None = None,
    ):
        """Send email notification when weekly summary is ready."""
        context = {
            'user_name': user.get_full_name() or user.username,
            'tasks_completed': summary_data.get('tasks_completed', 0),
            'tasks_assigned': summary_data.get('tasks_assigned', 0),
            'completion_rate': summary_data.get('completion_rate_percent', 0),
            'on_time_completion_rate': summary_data.get('on_time_completion_rate_percent', 0),
            'comments_added': summary_data.get('comments_added', 0),
            'files_attached': summary_data.get('files_attached', 0),
            'summary_message': summary_data.get('summary_message', ''),
            'comparison_metrics': comparison_data or {},
            'week_start_display': summary_data.get('week_start_date'),
            'week_end_display': summary_data.get('week_end_date'),
            'dashboard_url': '/summaries',
            'unsubscribe_url': '/settings/notifications',
        }

        service = WeeklySummaryEmailService()
        sent = service.send([user.email], context)

        if sent:
            logger.info(
                "Weekly summary email queued/sent to %s for week %s",
                user.email,
                summary_data.get('week_start_date'),
            )
        else:
            logger.error(
                "Weekly summary email failed for recipient %s, week %s",
                user.email,
                summary_data.get('week_start_date'),
            )

        return sent
    
    @staticmethod
    def send_summary_shared_notification(
        recipient: User,
        sharer: User,
        summary_week: str,
        view_summary_url: str | None = None,
        week_end: str | None = None,
    ) -> bool:
        """Send email when someone shares a summary with you.

        Returns True if email was queued/sent, else False.
        """
        recipient_email = (recipient.email or '').strip()
        if not recipient_email:
            logger.warning(
                "Skipped summary shared email: recipient %s has no email",
                recipient.id,
            )
            return False

        # Keep context Celery-serializable (plain scalars only) so async dispatch works.
        context = {
            'recipient_name': recipient.get_full_name() or recipient.username,
            'sharer_name': sharer.get_full_name() or sharer.username,
            'week_start': summary_week,
            'week_end': week_end or summary_week,
            'shared_date_display': timezone.now().strftime('%B %d, %Y at %I:%M %p'),
            'view_summary_url': view_summary_url or '/summaries',
        }

        subject = f"{sharer.get_full_name() or sharer.username} shared a summary with you"
        sent = BaseEmailService.send_email(
            subject=subject,
            recipients=[recipient_email],
            template_name='summary_shared_notification.html',
            context=context,
        )

        if sent:
            logger.info(
                "Summary shared email queued/sent to %s for week %s",
                recipient_email,
                summary_week,
            )
        else:
            logger.error(
                "Summary shared email failed for recipient %s, week %s",
                recipient_email,
                summary_week,
            )

        return sent
