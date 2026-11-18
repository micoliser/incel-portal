"""Every email template must compile and render.

The other email tests mock the sender, so a broken template went unnoticed:
the weekly summary template had `{% endif %}` split across two lines by a
formatter, and every weekly summary email failed in production.
"""

from pathlib import Path
from unittest.mock import patch

from django.core import mail
from django.template.loader import get_template, render_to_string
from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings

from emails.services.base_email_service import BaseEmailService
from emails.services.summary_emails import SummaryEmailManager, WeeklySummaryEmailService

TEMPLATE_ROOT = Path(__file__).resolve().parent.parent / 'templates'


def weekly_context(comparison=None, **summary_overrides):
    summary = {
        'week_start_date': '2026-11-09',
        'week_end_date': '2026-11-15',
        'tasks_completed': 5,
        'tasks_open_during_week': 7,
        'completion_rate_percent': 71.4,
        'on_time_completion_rate_percent': 80.0,
        'comments_added': 2,
        'files_attached': 1,
        'high_priority_completed': 3,
        'summary_message': 'A good week.',
        'has_own_work': True,
        'has_delegated_work': False,
        'lead_section': 'own',
    }
    summary.update(summary_overrides)
    if comparison is None:
        comparison = {
            'trend': 'up',
            'delta_tasks_completed': 2,
            'delta_completion_rate': 12.5,
            'delta_on_time_completion_rate': -3.4,
            'delta_high_priority_completed': 1,
        }
    return {
        'user_name': 'Ada Obi',
        'summary': summary,
        'comparison': comparison,
        'week_start_display': summary['week_start_date'],
        'week_end_display': summary['week_end_date'],
        'dashboard_url': 'https://workspace.example.com/summaries',
    }


class EmailTemplatesCompileTests(SimpleTestCase):
    def test_every_email_template_compiles(self):
        names = sorted(str(p.relative_to(TEMPLATE_ROOT)) for p in TEMPLATE_ROOT.rglob('*.html'))
        self.assertTrue(names)
        for name in names:
            with self.subTest(template=name):
                get_template(name)


class WeeklySummaryTemplateTests(SimpleTestCase):
    def test_renders_week_over_week_changes(self):
        html = render_to_string(WeeklySummaryEmailService.template_name, weekly_context())

        self.assertIn('vs last week', html)
        self.assertIn('Better than last week.', html)
        self.assertIn('5 of 7', html)
        self.assertIn('+2', html)
        self.assertIn('+12.5%', html)
        self.assertIn('-3.4%', html)
        self.assertIn('+1', html)
        self.assertIn('href="https://workspace.example.com/summaries"', html)

    def test_renders_without_comparison(self):
        html = render_to_string(
            WeeklySummaryEmailService.template_name,
            weekly_context(comparison={}),
        )

        self.assertNotIn('vs last week', html)
        self.assertIn('A good week.', html)

    @override_settings(EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend')
    def test_weekly_email_is_actually_sent(self):
        sent = BaseEmailService._send_sync(
            'Your Weekly Summary',
            ['ada@example.com'],
            WeeklySummaryEmailService.template_name,
            weekly_context(),
        )

        self.assertTrue(sent)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['ada@example.com'])


class WeeklySummaryLinkTests(TestCase):
    @override_settings(PORTAL_BASE_URL='https://workspace.example.com')
    @patch('emails.services.base_email_service.BaseEmailService.send_email', return_value=True)
    def test_link_points_at_the_portal(self, send):
        user = get_user_model().objects.create_user(
            username='ada', email='ada@example.com', first_name='Ada', last_name='Obi',
        )

        SummaryEmailManager.send_weekly_summary_notification(user, {'week_start_date': '2026-11-09'})

        context = send.call_args.kwargs['context']
        self.assertEqual(context['dashboard_url'], 'https://workspace.example.com/summaries')


class EveryServiceHasATemplateTests(SimpleTestCase):
    def test_every_email_service_points_at_an_existing_template(self):
        import emails.services.application_emails  # noqa: F401
        import emails.services.daily_report_emails  # noqa: F401
        import emails.services.summary_emails  # noqa: F401
        import emails.services.support_emails  # noqa: F401
        import emails.services.task_emails  # noqa: F401
        import emails.services.user_emails  # noqa: F401

        def subclasses(cls):
            for sub in cls.__subclasses__():
                yield sub
                yield from subclasses(sub)

        services = list(subclasses(BaseEmailService))
        self.assertGreater(len(services), 10)
        for service in services:
            with self.subTest(service=service.__name__):
                get_template(service.template_name)

    def test_every_template_renders_with_no_data(self):
        from emails.services.base_email_service import render_email

        for path in sorted(TEMPLATE_ROOT.rglob('*.html')):
            name = str(path.relative_to(TEMPLATE_ROOT))
            with self.subTest(template=name):
                html, text = render_email(name, {})
                self.assertNotIn('{%', html)
                self.assertNotIn('<style', text)


class PlainTextPartTests(SimpleTestCase):
    @override_settings(PORTAL_BASE_URL='https://workspace.example.com')
    def test_text_part_has_no_css_and_keeps_links(self):
        from emails.services.base_email_service import render_email

        _, text = render_email(
            'emails/tasks/task_created.html',
            {'task_id': 7, 'task_name': 'Audit stock', 'recipient_name': 'Ada', 'assigner_name': 'Bayo'},
        )

        self.assertNotIn('{', text)
        self.assertIn('Task: Audit stock', text)
        self.assertIn('https://workspace.example.com/tasks/7', text)
