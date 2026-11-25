"""Email service for weekly summary notifications."""

import logging
from datetime import date
from typing import Any, Dict

from django.contrib.auth import get_user_model
from django.utils import timezone

from common.users import display_name
from emails.config import EmailConfig, EmailType
from emails.services.base_email_service import BaseEmailService
from emails.services.daily_report_emails import get_portal_base_url

User = get_user_model()

logger = logging.getLogger(__name__)


class WeeklySummaryEmailService(BaseEmailService):
    """Send weekly summary emails using the shared email service pattern."""

    email_type = EmailType.WEEKLY_SUMMARY
    template_name = "weekly_summary_notification.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        week_start = context.get('week_start_display') or context.get('week_start') or 'this week'
        if context.get('is_manager_copy'):
            user_name = context.get('user_name', 'Team Member')
            return f"Weekly Summary for {user_name} - Week of {week_start}"
        return f"Your Weekly Summary - Week of {week_start}"


def _display_date(value, with_year: bool = True) -> str:
    """'2026-11-09' -> '9 Nov 2026' (or '9 Nov'); anything else is returned as it is."""
    try:
        day = date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return value or ''
    text = f'{day.day} {day:%b}'
    return f'{text} {day.year}' if with_year else text


class SummaryEmailManager:
    @staticmethod
    def send_weekly_summary_notification(
        user: User,
        summary_data: dict,
        comparison_data: dict | None = None,
    ):
        """Send email notification when weekly summary is ready."""
        summary = dict(summary_data or {})
        # Weeks summarised before the delegated-work figures existed.
        summary.setdefault('tasks_open_during_week', summary.get('tasks_assigned', 0))
        summary.setdefault('has_own_work', True)
        summary.setdefault('has_delegated_work', False)
        summary.setdefault('lead_section', 'own')
        context = {
            'user_name': display_name(user),
            'summary': summary,
            'comparison': comparison_data or {},
            'week_start_display': _display_date(summary.get('week_start_date'), with_year=False),
            'week_end_display': _display_date(summary.get('week_end_date')),
            'dashboard_url': f'{get_portal_base_url()}/summaries',
        }

        service = WeeklySummaryEmailService()
        sent = service.send([user.email], context)

        if sent:
            logger.info(
                "Weekly summary email queued/sent to %s for week %s",
                user.email,
                summary_data.get('week_start_date'),
            )
        elif EmailConfig.is_enabled():
            logger.error(
                "Weekly summary email failed for recipient %s, week %s",
                user.email,
                summary_data.get('week_start_date'),
            )

        # Notify direct manager if applicable
        try:
            from emails.utils import get_direct_manager
            manager = get_direct_manager(user)
            if manager and manager.id != user.id and manager.email:
                manager_context = dict(context)
                manager_context['is_manager_copy'] = True
                manager_context['manager_name'] = display_name(manager)
                manager_sent = service.send([manager.email], manager_context)
                if manager_sent:
                    logger.info(
                        "Weekly summary email for %s sent to manager %s",
                        user.email,
                        manager.email,
                    )
                else:
                    logger.error(
                        "Weekly summary email for %s failed to manager %s",
                        user.email,
                        manager.email,
                    )
        except Exception as e:
            logger.error("Failed to send manager copy of weekly summary for %s: %s", user.id, str(e))

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
            'recipient_name': display_name(recipient),
            'sharer_name': display_name(sharer),
            'week_start': summary_week,
            'week_end': week_end or summary_week,
            'shared_date_display': timezone.now().strftime('%B %d, %Y at %I:%M %p'),
            'view_summary_url': view_summary_url or f'{get_portal_base_url()}/summaries',
        }

        subject = f"{display_name(sharer)} shared a summary with you"
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
        elif EmailConfig.is_enabled():
            logger.error(
                "Summary shared email failed for recipient %s, week %s",
                recipient_email,
                summary_week,
            )

        return sent
