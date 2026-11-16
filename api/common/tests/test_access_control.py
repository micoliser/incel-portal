"""Regression tests for access-control holes closed after the security audit.

Each class covers one finding. They assert what must NOT be possible, so a
later refactor cannot quietly reopen any of them.
"""

from datetime import timedelta
from importlib import import_module

from django.apps import apps as django_apps
from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from accounts.models import StaffProfile
from applications.models import ApplicationAccessOverride, AuditLog, InternalApplication
from common.test_utils import BaseAPITestCase
from organization.models import Department
from support.models import SupportComment, SupportRequest
from tasks.models import RecurringSchedule, Task, WeeklySummary


class AccessControlTestCase(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        # In the shared fixtures `admin_user` is an executive (global access)
        # and `staff_user` is ordinary staff. Add a second staff member and a
        # superuser, which is how administrators exist in production.
        self.executive = self.admin_user
        self.other_user = User.objects.create_user(
            username='other@example.com', email='other@example.com', password='OtherStrongPass123!',
        )
        StaffProfile.objects.create(user=self.other_user, role=self.role_staff, department=self.dep_eng)
        self.superuser = User.objects.create_superuser(
            username='root@example.com', email='root@example.com', password='RootStrongPass123!',
        )
        StaffProfile.objects.create(user=self.superuser, role=self.role_staff, department=self.dep_hr)

    def act_as(self, user):
        self.client.credentials(**self.auth_headers_for(user))


class TaskOwnershipTests(AccessControlTestCase):
    """S1: the people on a task cannot be changed after it is created."""

    def setUp(self):
        super().setUp()
        self.task = Task.objects.create(
            title='Quarterly stock count',
            assigned_by=self.executive,
            assigned_to=self.staff_user,
            deadline=timezone.now() + timedelta(days=2),
        )
        self.url = reverse('task-detail', kwargs={'pk': self.task.id})

    def test_assignee_cannot_make_themselves_the_assigner(self):
        self.act_as(self.staff_user)

        response = self.client.patch(self.url, {'assigned_by_id': self.staff_user.id}, format='json')

        # The field no longer exists, so it is ignored rather than applied.
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.task.refresh_from_db()
        self.assertEqual(self.task.assigned_by, self.executive)

    def test_assignee_cannot_approve_their_own_task_after_trying_to_take_it_over(self):
        self.act_as(self.staff_user)
        self.client.patch(self.url, {'assigned_by_id': self.staff_user.id}, format='json')

        response = self.client.patch(self.url, {'status': 'completed'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.task.refresh_from_db()
        self.assertEqual(self.task.status, 'pending')
        self.assertIsNone(self.task.completed_at)

    def test_assignee_cannot_hand_the_task_to_someone_else(self):
        self.act_as(self.staff_user)

        response = self.client.patch(self.url, {'assigned_to_id': self.other_user.id}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('assigned_to_id', response.data['error']['details'])
        self.task.refresh_from_db()
        self.assertEqual(self.task.assigned_to, self.staff_user)

    def test_assigner_cannot_reassign_through_an_edit(self):
        self.act_as(self.executive)

        for payload in ({'assigned_to_id': self.other_user.id}, {'assigned_to_ids': [self.other_user.id]}):
            response = self.client.patch(self.url, payload, format='json')
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, payload)

        self.task.refresh_from_db()
        self.assertEqual(self.task.assigned_to, self.staff_user)

    def test_resending_the_current_assignee_is_accepted_and_changes_nothing(self):
        self.act_as(self.executive)

        response = self.client.patch(
            self.url, {'assigned_to_id': self.staff_user.id, 'priority': 'high'}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.task.refresh_from_db()
        self.assertEqual(self.task.assigned_to, self.staff_user)
        self.assertEqual(self.task.priority, 'high')


class TaskDeletionTests(AccessControlTestCase):
    """S4: tasks and recurring schedules cannot be deleted through the API."""

    def test_neither_party_can_delete_a_task(self):
        task = Task.objects.create(
            title='Do not delete me',
            assigned_by=self.executive,
            assigned_to=self.staff_user,
            deadline=timezone.now() + timedelta(days=2),
        )
        url = reverse('task-detail', kwargs={'pk': task.id})

        for user in (self.staff_user, self.executive):
            self.act_as(user)
            response = self.client.delete(url)
            self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED, user.username)

        self.assertTrue(Task.objects.filter(id=task.id).exists())

    def test_creator_cannot_delete_a_recurring_schedule(self):
        schedule = RecurringSchedule.objects.create(
            title='Daily check',
            assigned_by=self.executive,
            assigned_to=self.staff_user,
            frequency='daily',
            times=['09:00'],
            start_at=timezone.now(),
        )
        self.act_as(self.executive)

        response = self.client.delete(reverse('recurring-schedule-detail', kwargs={'pk': schedule.id}))

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)
        self.assertTrue(RecurringSchedule.objects.filter(id=schedule.id).exists())


class SupportTicketWorkflowBypassTests(AccessControlTestCase):
    """S3: a ticket changes only through its workflow actions."""

    def setUp(self):
        super().setUp()
        self.dep_it, _ = Department.objects.get_or_create(name='IT', defaults={'code': 'IT'})
        self.ticket = SupportRequest.objects.create(
            requester=self.staff_user,
            title='Laptop will not start',
            category='IT_SUPPORT',
            priority='medium',
            description='It was fine yesterday.',
            department=self.dep_it,
            assigned_to=self.other_user,
            status='assigned',
        )
        SupportComment.objects.create(request=self.ticket, author=self.staff_user, body='Opened', is_system=True)
        self.url = reverse('support-request-detail', kwargs={'pk': self.ticket.id})

    def assert_ticket_untouched(self):
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status, 'assigned')
        self.assertEqual(self.ticket.priority, 'medium')
        self.assertIsNone(self.ticket.line_manager)
        self.assertIsNone(self.ticket.closed_at)
        self.assertEqual(self.ticket.comments.count(), 1)

    def test_requester_and_handler_cannot_edit_a_ticket_directly(self):
        payload = {'status': 'closed', 'priority': 'urgent', 'line_manager': self.other_user.id}

        for user in (self.staff_user, self.other_user):
            self.act_as(user)
            for method in (self.client.patch, self.client.put):
                response = method(self.url, payload, format='json')
                self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED, user.username)

        self.assert_ticket_untouched()

    def test_requester_and_handler_cannot_delete_a_ticket(self):
        for user in (self.staff_user, self.other_user):
            self.act_as(user)
            response = self.client.delete(self.url)
            self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED, user.username)

        self.assertTrue(SupportRequest.objects.filter(id=self.ticket.id).exists())
        self.assert_ticket_untouched()

    def test_participants_can_still_read_the_ticket(self):
        for user in (self.staff_user, self.other_user):
            self.act_as(user)
            response = self.client.get(self.url)
            self.assertEqual(response.status_code, status.HTTP_200_OK, user.username)
            self.assertEqual(response.data['title'], 'Laptop will not start')


class AuditLogAccessTests(AccessControlTestCase):
    """S2: the audit trail and access overrides are not open to all staff."""

    def setUp(self):
        super().setUp()
        self.log = AuditLog.objects.create(
            actor_user=self.executive,
            action='AUTH_LOGIN_FAILED',
            target_type='User',
            metadata_json={'email': 'someone@example.com'},
            ip_address='203.0.113.9',
        )
        self.application = InternalApplication.objects.create(
            name='Payroll', slug='payroll', app_url='https://payroll.example.com',
        )
        ApplicationAccessOverride.objects.create(
            application=self.application, user=self.other_user,
            effect=ApplicationAccessOverride.Effect.ALLOW, reason='Covering',
        )
        self.list_url = reverse('admin-audit-logs-list')
        self.detail_url = reverse('admin-audit-logs-detail', kwargs={'log_id': self.log.id})
        self.overrides_url = reverse(
            'admin-applications-overrides-create', kwargs={'application_id': self.application.id},
        )

    def test_ordinary_staff_cannot_read_audit_logs(self):
        self.act_as(self.staff_user)

        for url in (self.list_url, self.detail_url):
            response = self.client.get(url)
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN, url)

    def test_executives_and_superusers_can_read_audit_logs(self):
        for user in (self.executive, self.superuser):
            self.act_as(user)

            listing = self.client.get(self.list_url)
            self.assertEqual(listing.status_code, status.HTTP_200_OK, user.username)
            self.assertIn(str(self.log.id), [str(item['id']) for item in listing.data['results']])

            detail = self.client.get(self.detail_url)
            self.assertEqual(detail.status_code, status.HTTP_200_OK, user.username)

    def test_only_administrators_can_list_access_overrides(self):
        for user in (self.staff_user, self.executive):
            self.act_as(user)
            response = self.client.get(self.overrides_url)
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN, user.username)

        self.act_as(self.superuser)
        response = self.client.get(self.overrides_url)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)


class ShareTokenAuditTests(AccessControlTestCase):
    """S2: a summary share token is a credential and never reaches the audit log."""

    def setUp(self):
        super().setUp()
        self.week_start = timezone.localdate() - timedelta(days=14)
        self.summary = WeeklySummary.objects.create(
            user=self.staff_user,
            week_start_date=self.week_start,
            week_end_date=self.week_start + timedelta(days=6),
            summary_data={},
        )

    def test_creating_a_share_link_does_not_log_the_token(self):
        self.act_as(self.staff_user)

        response = self.client.post(
            reverse('weekly-summary-share'), {'week_start_date': str(self.week_start)}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        token = response.data['share_token']
        log = AuditLog.objects.get(action='WEEKLY_SUMMARY_SHARED')
        self.assertNotIn('share_token', log.metadata_json)
        self.assertNotIn(token, str(log.metadata_json))
        self.assertIn('share_id', log.metadata_json)

    def test_migration_removes_tokens_already_stored(self):
        stale = AuditLog.objects.create(
            actor_user=self.staff_user,
            action='WEEKLY_SUMMARY_SHARED',
            target_type='weekly_summary',
            target_id=str(self.summary.id),
            metadata_json={'share_token': 'leaked-token', 'week_start_date': str(self.week_start)},
        )
        unrelated = AuditLog.objects.create(
            action='AUTH_LOGIN_FAILED', metadata_json={'share_token': 'not-a-share-event'},
        )
        migration = import_module('applications.migrations.0002_scrub_share_tokens_from_audit_logs')

        migration.scrub_share_tokens(django_apps, None)

        stale.refresh_from_db()
        self.assertEqual(stale.metadata_json, {'week_start_date': str(self.week_start)})
        unrelated.refresh_from_db()
        self.assertEqual(unrelated.metadata_json, {'share_token': 'not-a-share-event'})
