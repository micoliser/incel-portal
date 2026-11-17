"""Phase 6: data integrity, limits, background jobs and time zone."""

from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from unittest.mock import patch

from django.conf import settings
from django.contrib.admin.sites import site
from django.contrib.auth.models import User
from django.core import mail
from django.db import connection, transaction
from django.db.models import ProtectedError
from django.test import RequestFactory, override_settings
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from accounts.models import StaffProfile
from common.csv_export import csv_safe
from common.test_utils import BaseAPITestCase
from emails.services.base_email_service import BaseEmailService
from inventory.models import InventoryCategory, InventoryItem
from organization.models import Department, Role
from support.services import route_support_request
from tasks.models import RecurringSchedule, Task, TaskDraft, WeeklySummary
from tasks.serializers import MAX_ASSIGNEES, MAX_DRAFTS_PER_USER
from tasks.tasks import generate_recurring_task_occurrences, send_weekly_summary_emails


class InputLimitTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.client.credentials(**self.auth_headers_for(self.admin_user))

    def _many_users(self, count):
        return [
            User.objects.create_user(f'bulk{index}@example.com', email=f'bulk{index}@example.com').id
            for index in range(count)
        ]

    def test_a_task_can_be_assigned_to_at_most_fifty_people_at_once(self):
        payload = {
            'title': 'Everyone',
            'priority': 'low',
            'deadline': (timezone.now() + timedelta(days=2)).isoformat(),
            'assigned_to_ids': self._many_users(MAX_ASSIGNEES + 1),
        }
        response = self.client.post(reverse('task-list'), payload)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('assigned_to_ids', response.data['error']['details'])
        self.assertEqual(Task.objects.count(), 0)

    def test_inactive_people_cannot_be_given_work(self):
        self.staff_user.is_active = False
        self.staff_user.save(update_fields=['is_active'])
        payload = {
            'title': 'Ghost',
            'priority': 'low',
            'deadline': (timezone.now() + timedelta(days=2)).isoformat(),
            'assigned_to_id': self.staff_user.id,
        }
        self.assertEqual(self.client.post(reverse('task-list'), payload).status_code, 400)

    def test_recurring_schedules_are_bounded(self):
        base = {
            'title': 'Recurring',
            'assigned_to_id': self.staff_user.id,
            'priority': 'medium',
            'frequency': 'daily',
            'times': ['09:00'],
            'timezone': 'UTC',
            'start_at': (timezone.now() + timedelta(days=1)).isoformat(),
        }
        for field, value in (
            ('times', [f'{hour:02d}:{minute:02d}' for hour in range(24) for minute in (0, 30)]),
            ('interval', 1000),
            ('deadline_offset_minutes', 10 ** 7),
        ):
            response = self.client.post(reverse('recurring-schedule-list'), {**base, field: value})
            self.assertEqual(response.status_code, 400, field)
            self.assertIn(field, response.data['error']['details'])

    def test_drafts_are_limited_per_user_and_validated(self):
        url = reverse('task-draft-list')
        response = self.client.post(url, {'mode': 'single', 'assigned_to_ids': ['not', 'ids']})
        self.assertEqual(response.status_code, 400)
        response = self.client.post(url, {'mode': 'single', 'recurrence_config': {'x': 'y' * 20_000}})
        self.assertEqual(response.status_code, 400)

        TaskDraft.objects.bulk_create([TaskDraft(user=self.admin_user) for _ in range(MAX_DRAFTS_PER_USER)])
        response = self.client.post(url, {'mode': 'single', 'title': 'One more'})
        self.assertEqual(response.status_code, 400)

    def test_list_page_size_is_capped(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.get(reverse('users-list'), {'page_size': 10_000})
        self.assertEqual(response.data['page_size'], 100)


class UserRecordProtectionTests(BaseAPITestCase):
    def test_a_user_with_tasks_cannot_be_deleted(self):
        Task.objects.create(
            title='Keep me', assigned_by=self.admin_user, assigned_to=self.staff_user,
            deadline=timezone.now() + timedelta(days=1),
        )
        with self.assertRaises(ProtectedError):
            self.staff_user.delete()
        self.assertTrue(Task.objects.filter(title='Keep me').exists())

    def test_the_admin_site_offers_no_user_deletion(self):
        request = RequestFactory().get('/admin/')
        request.user = User.objects.create_superuser('root@example.com', 'root@example.com', 'x')
        self.assertFalse(site._registry[User].has_delete_permission(request))


class InventoryIntegrityTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.root = User.objects.create_superuser('root@example.com', 'root@example.com', 'RootStrongPass123!')
        self.client.force_authenticate(self.root)
        self.category = InventoryCategory.objects.create(name='Laptops')
        self.item = InventoryItem.objects.create(name='Laptop', category=self.category, status='available')

    def test_an_item_with_history_cannot_be_deleted(self):
        self.client.post(f'/api/v1/inventory/items/{self.item.id}/assign', {'assigned_to_id': self.staff_user.id})
        response = self.client.delete(f'/api/v1/inventory/items/{self.item.id}')
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertTrue(InventoryItem.objects.filter(pk=self.item.pk).exists())

    def test_retired_items_cannot_be_put_into_maintenance(self):
        InventoryItem.objects.filter(pk=self.item.pk).update(status='retired')
        response = self.client.post('/api/v1/inventory/maintenance-logs', {
            'item_id': self.item.id, 'date': '2026-09-01', 'issue_reported': 'x', 'status': 'open',
        })
        self.assertEqual(response.status_code, 400)
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, 'retired')

    def test_a_department_assigned_item_is_still_assigned_after_maintenance(self):
        self.client.post(
            f'/api/v1/inventory/items/{self.item.id}/assign', {'assigned_to_department_id': str(self.dep_hr.id)}
        )
        created = self.client.post('/api/v1/inventory/maintenance-logs', {
            'item_id': self.item.id, 'date': '2026-09-01', 'issue_reported': 'x', 'status': 'open',
        })
        self.assertEqual(created.status_code, 201, created.data)
        log = created.data
        self.client.patch(f'/api/v1/inventory/maintenance-logs/{log["id"]}', {'status': 'completed'})
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, 'assigned')

    def test_inactive_people_cannot_be_given_assets(self):
        self.staff_user.is_active = False
        self.staff_user.save(update_fields=['is_active'])
        response = self.client.post(
            f'/api/v1/inventory/items/{self.item.id}/assign', {'assigned_to_id': self.staff_user.id}
        )
        self.assertEqual(response.status_code, 400)

    def test_exports_cannot_carry_spreadsheet_formulas(self):
        InventoryItem.objects.create(name='=HYPERLINK("http://evil")', category=self.category)
        response = self.client.get('/api/v1/inventory/items/export')
        body = b''.join(response.streaming_content).decode()
        self.assertIn("'=HYPERLINK", body)
        self.assertNotIn(',=HYPERLINK', body)
        for value, expected in (('=1+1', "'=1+1"), ('+1', "'+1"), ('@SUM', "'@SUM"), ('plain', 'plain'), (5, 5)):
            self.assertEqual(csv_safe(value), expected)


class EmailAfterCommitTests(BaseAPITestCase):
    @override_settings(EMAIL_SEND_ON_COMMIT=True)
    def test_an_email_inside_a_rolled_back_transaction_is_never_sent(self):
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    BaseEmailService.send_email('Hello', ['a@example.com'], 'emails/users/user_status_changed.html', {})
                    raise RuntimeError('rolled back')
            except RuntimeError:
                pass
        self.assertEqual(len(mail.outbox), 0)

    @override_settings(EMAIL_SEND_ON_COMMIT=True)
    def test_an_email_inside_a_committed_transaction_is_sent_after_commit(self):
        with self.captureOnCommitCallbacks(execute=True):
            with transaction.atomic():
                BaseEmailService.send_email('Hello', ['a@example.com'], 'emails/users/user_status_changed.html', {})
                self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(len(mail.outbox), 1)


class BackgroundJobTests(BaseAPITestCase):
    def _schedule(self, **overrides):
        values = {
            'title': 'Daily check',
            'assigned_by': self.admin_user,
            'assigned_to': self.staff_user,
            'priority': 'medium',
            'frequency': 'daily',
            'interval': 1,
            'times': ['09:00'],
            'timezone': 'UTC',
            'start_at': timezone.now() - timedelta(days=10),
            'next_run_at': timezone.now() - timedelta(days=10),
            'include_weekends': True,
        }
        values.update(overrides)
        return RecurringSchedule.objects.create(**values)

    @override_settings(RECURRING_MAX_CATCH_UP_RUNS=1)
    def test_after_downtime_only_the_latest_missed_run_is_created(self):
        self._schedule()
        result = generate_recurring_task_occurrences()
        self.assertEqual(result['created_tasks'], 1)
        self.assertEqual(Task.objects.count(), 1)

    def test_a_paused_schedule_creates_nothing(self):
        self._schedule(is_paused=True)
        generate_recurring_task_occurrences()
        self.assertEqual(Task.objects.count(), 0)

    def test_weekly_emails_skip_deactivated_accounts(self):
        today = timezone.localdate()
        last_week = today - timedelta(days=today.weekday() + 7)
        for user in (self.staff_user, self.admin_user):
            WeeklySummary.objects.create(
                user=user, week_start_date=last_week, week_end_date=last_week + timedelta(days=6), summary_data={},
            )
        User.objects.filter(pk=self.staff_user.pk).update(is_active=False)
        with patch('tasks.tasks.SummaryEmailManager.send_weekly_summary_notification') as send:
            result = send_weekly_summary_emails()
        self.assertEqual(result['emails_sent'], 1)
        self.assertEqual(send.call_args.args[0], self.admin_user)

    def test_jobs_have_time_limits(self):
        self.assertTrue(settings.CELERY_TASK_TIME_LIMIT)
        self.assertLess(settings.CELERY_TASK_SOFT_TIME_LIMIT, settings.CELERY_TASK_TIME_LIMIT)
        self.assertIn('calculate-weekly-comparisons', settings.CELERY_BEAT_SCHEDULE)


class TimeZoneTests(BaseAPITestCase):
    def test_the_business_day_is_lagos_time(self):
        self.assertEqual(settings.TIME_ZONE, 'Africa/Lagos')
        # 23:30 UTC on 10 March is already 11 March in Lagos (UTC+1).
        late_evening_utc = datetime(2026, 3, 10, 23, 30, tzinfo=dt_timezone.utc)
        self.assertEqual(str(timezone.localdate(late_evening_utc)), '2026-03-11')


class DepartmentResponsibilityTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.it, _ = Department.objects.update_or_create(
            code='IT', defaults={'name': 'IT', 'manages_inventory': True, 'handles_it_support': True},
        )
        profile = self.staff_user.staff_profile
        profile.department = self.it
        profile.save()

    def test_renaming_the_department_keeps_its_rights(self):
        self.it.name = 'Technology Services'
        self.it.code = 'TECH'
        self.it.save()

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post('/api/v1/inventory/categories', {'name': 'Phones'})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(route_support_request('IT_SUPPORT'), self.it)

        me = self.client.get(reverse('me'))
        self.assertTrue(me.data['can_manage_inventory'])

    def test_a_department_called_it_without_the_flag_has_no_rights(self):
        other = Department.objects.create(name='it', code='it2')
        self.it.manages_inventory = False
        self.it.save()
        profile = self.staff_user.staff_profile
        profile.department = other
        profile.save()

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        self.assertEqual(self.client.post('/api/v1/inventory/categories', {'name': 'Phones'}).status_code, 403)

    def test_a_deactivated_role_confers_nothing(self):
        Role.objects.filter(pk=self.role_ed.pk).update(is_active=False)
        self.client.credentials(**self.auth_headers_for(self.admin_user))  # an ED
        self.assertEqual(self.client.get(reverse('audit-logs-list')).status_code, 403)


class UserListQueryTests(BaseAPITestCase):
    def test_the_user_list_costs_the_same_however_many_users_lead_groups(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        with CaptureQueriesContext(connection) as before:
            self.client.get(reverse('users-list'))

        for index in range(10):
            user = User.objects.create_user(f'lead{index}@example.com', email=f'lead{index}@example.com')
            StaffProfile.objects.create(user=user, role=self.role_staff, department=self.dep_eng)
            Department.objects.create(name=f'Led {index}', code=f'LED{index}', line_manager=user)

        with CaptureQueriesContext(connection) as after:
            response = self.client.get(reverse('users-list'))
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(after), len(before) + 1)
