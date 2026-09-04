"""Email service for forwarding daily reports."""

import logging
import os
from typing import Any, Dict, List

from django.contrib.auth.models import User
from django.utils import timezone
from django.utils.formats import date_format

from emails.config import EmailType
from emails.services.base_email_service import BaseEmailService
from tasks.models import DailyReport

logger = logging.getLogger(__name__)


def get_portal_base_url() -> str:
    return os.getenv('PORTAL_BASE_URL', 'https://workspace.incelgroup.com').rstrip('/')


def build_daily_report_email_context(report: DailyReport, sender: User) -> Dict[str, Any]:
    base_url = get_portal_base_url()
    subreports_payload: List[Dict[str, Any]] = []

    for subreport in report.subreports.all().order_by('created_at'):
        comments_payload = []
        for comment in subreport.comments.all().order_by('created_at'):
            comments_payload.append({
                'author_name': comment.author.get_full_name() or comment.author.username,
                'created_at_display': date_format(
                    timezone.localtime(comment.created_at),
                    'M j, Y, g:i a',
                ),
                'body': comment.body,
            })

        subreports_payload.append({
            'title': subreport.title,
            'created_by_name': subreport.created_by.get_full_name() or subreport.created_by.username,
            'created_at_display': date_format(
                timezone.localtime(subreport.created_at),
                'M j, Y, g:i a',
            ),
            'comments': comments_payload,
            'view_url': f'{base_url}/reports/subreports/{subreport.id}',
        })

    report_date = report.report_date
    return {
        'sender_name': sender.get_full_name() or sender.username,
        'sender_email': sender.email,
        'report_date_display': date_format(report_date, 'l, F j, Y'),
        'department_name': report.department.name,
        'subreports': subreports_payload,
        'subreport_count': len(subreports_payload),
        'report_view_url': f'{base_url}/reports/daily/{report.id}',
    }


class DailyReportForwardEmailService(BaseEmailService):
    email_type = EmailType.DAILY_REPORT_FORWARD
    template_name = 'emails/reports/daily_report_forward.html'

    def _get_subject(self, context: Dict[str, Any]) -> str:
        report_date = context.get('report_date_display', 'Daily report')
        sender_name = context.get('sender_name', 'A colleague')
        return f'Daily report – {report_date} – {sender_name}'


class DailyReportEmailManager:
    @staticmethod
    def send_forward(report: DailyReport, sender: User, recipients: List[str]) -> bool:
        context = build_daily_report_email_context(report, sender)
        service = DailyReportForwardEmailService()
        reply_to = (sender.email or '').strip() or None
        sent = service.send_email(
            subject=service._get_subject(context),
            recipients=recipients,
            template_name=service.template_name,
            context=context,
            reply_to=reply_to,
        )
        if sent:
            logger.info(
                'Daily report %s forwarded by %s to %s',
                report.id,
                sender.id,
                recipients,
            )
        else:
            logger.error(
                'Daily report %s forward failed for sender %s to %s',
                report.id,
                sender.id,
                recipients,
            )
        return sent

    @staticmethod
    def get_manager_for_user(user):
        """Helper to find the direct manager: team lead -> supervisor -> line manager."""
        if not hasattr(user, 'staff_profile'):
            return None
            
        profile = user.staff_profile
        if not profile.department_id:
            return None
            
        from organization.models import Department, Unit, Team
        
        # Check team lead
        if profile.team_id:
            team = Team.objects.filter(id=profile.team_id).first()
            if team and team.team_lead_id and team.team_lead_id != user.id:
                return team.team_lead
                
        # Check supervisor
        if profile.unit_id:
            unit = Unit.objects.filter(id=profile.unit_id).first()
            if unit and unit.supervisor_id and unit.supervisor_id != user.id:
                return unit.supervisor
                
        # Check line manager
        dept = Department.objects.filter(id=profile.department_id).first()
        if dept and dept.line_manager_id and dept.line_manager_id != user.id:
            return dept.line_manager
            
        return None

    @staticmethod
    def send_manager_notification(report, sender, is_eod=False) -> bool:
        """Sends an email to the direct manager. If is_eod is True, it's the 5:05 PM report."""
        manager = DailyReportEmailManager.get_manager_for_user(sender)
        if not manager or not manager.email:
            return False
            
        context = build_daily_report_email_context(report, sender)
        
        # Override the subject based on the requirement
        if is_eod:
            subject = f"Daily report for {sender.first_name} {sender.last_name}"
        else:
            subject = f"{sender.first_name} {sender.last_name} created a daily report"
            
        service = DailyReportForwardEmailService()
        
        context['subject'] = subject
        
        sent = service.send_email(
            subject=subject,
            recipients=[manager.email],
            template_name=service.template_name,
            context=context,
        )
        return sent
