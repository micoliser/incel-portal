"""Malformed input must be answered with a 400 (or 404), never a server error.

Before these checks existed, each case below reached the database or a type
conversion and came back as a 500.
"""

from datetime import timedelta

from django.contrib.auth import get_user_model
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from accounts.models import StaffProfile
from common.test_utils import BaseAPITestCase
from organization.models import Department
from support.models import SupportRequest
from support.s3 import support_attachment_key_prefix
from tasks.models import Task, TodoItem

User = get_user_model()


class BadInputTestCase(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.executive = self.admin_user  # global access in the shared fixtures
        self.other_user = User.objects.create_user(
            username='other@example.com', email='other@example.com', password='OtherStrongPass123!',
        )
        StaffProfile.objects.create(user=self.other_user, role=self.role_staff, department=self.dep_eng)

    def act_as(self, user):
        self.client.credentials(**self.auth_headers_for(user))

    def assert_bad_request(self, response, field=None):
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)
        self.assertEqual(response.data['error']['type'], 'validation_error')
        if field:
            self.assertIn(field, response.data['error']['details'])


class MalformedFilterTests(BadInputTestCase):
    def test_user_lists_reject_malformed_ids(self):
        self.act_as(self.executive)

        self.assert_bad_request(self.client.get(reverse('users-list'), {'department_id': 'abc'}), 'department_id')
        for name in ('department_id', 'unit_id', 'team_id'):
            self.assert_bad_request(self.client.get(reverse('users-list'), {name: 'abc'}), name)

    def test_user_lists_still_filter_by_a_real_department(self):
        self.act_as(self.executive)

        response = self.client.get(reverse('users-list'), {'department_id': str(self.dep_hr.id)})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 0)

    def test_audit_log_rejects_a_malformed_actor(self):
        self.act_as(self.executive)

        response = self.client.get(reverse('audit-logs-list'), {'actor_user_id': 'abc'})

        self.assert_bad_request(response, 'actor_user_id')

    def test_inventory_lists_reject_malformed_ids(self):
        self.act_as(self.executive)

        self.assert_bad_request(self.client.get(reverse('inventory-item-list'), {'category_id': 'abc'}), 'category_id')
        self.assert_bad_request(
            self.client.get(reverse('inventory-maintenance-log-list'), {'item_id': 'abc'}), 'item_id',
        )
        self.assert_bad_request(
            self.client.get(reverse('inventory-maintenance-log-list'), {'category_id': 'abc'}), 'category_id',
        )

    def test_inventory_filters_reject_unknown_values(self):
        """No filter is expressed by leaving the parameter out, not by a magic word."""
        self.act_as(self.executive)

        self.assert_bad_request(self.client.get(reverse('inventory-item-list'), {'category_id': 'all'}), 'category_id')
        self.assert_bad_request(self.client.get(reverse('inventory-item-list'), {'status': 'all'}), 'status')
        self.assertEqual(self.client.get(reverse('inventory-item-list')).status_code, status.HTTP_200_OK)

    def test_reports_reject_a_malformed_department(self):
        self.act_as(self.executive)

        response = self.client.get(reverse('reports-department-all'), {'department_id': 'abc'})

        self.assert_bad_request(response, 'department_id')


class MalformedDateTests(BadInputTestCase):
    def test_summary_endpoints_do_not_match_a_malformed_week(self):
        """The week is part of the path, so a malformed one is simply not a route."""
        self.act_as(self.staff_user)

        for suffix in ('', '/comparison', '/history', '/share', '/user-shares'):
            for bad in ('not-a-date', '2026-13-45'):
                response = self.client.get(f'/api/v1/summaries/weeks/{bad}{suffix}')
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND, (suffix, bad))

        for suffix in ('/share', '/export', '/user-shares'):
            response = self.client.post(f'/api/v1/summaries/weeks/not-a-date{suffix}', {}, format='json')
            self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND, suffix)

    def test_organization_summary_rejects_a_malformed_or_missing_week(self):
        self.act_as(self.executive)

        response = self.client.get(reverse('summary-organization'), {'week_start_date': '2026-13-45'})
        self.assert_bad_request(response, 'week_start_date')

        response = self.client.get(reverse('summary-organization'))
        self.assert_bad_request(response, 'week_start_date')

    def test_history_rejects_a_malformed_week_count(self):
        self.act_as(self.staff_user)

        response = self.client.get(
            reverse('summary-history', kwargs={'week': '2026-11-02'}), {'weeks': 'many'},
        )

        self.assert_bad_request(response, 'weeks')

    def test_sharing_with_a_user_rejects_a_malformed_user_id(self):
        self.act_as(self.staff_user)

        response = self.client.post(
            '/api/v1/summaries/weeks/2026-11-02/user-shares', {'user_id': 'abc'}, format='json',
        )

        self.assert_bad_request(response, 'user_id')

    def test_goals_reject_a_malformed_week(self):
        self.act_as(self.staff_user)

        response = self.client.get(reverse('goal-list'), {'week_start_date': 'not-a-date'})

        self.assert_bad_request(response, 'week_start_date')

    def test_summary_files_with_a_malformed_id_is_not_found(self):
        self.act_as(self.staff_user)

        response = self.client.get('/api/v1/summaries/not-a-uuid/files')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class MalformedBodyTests(BadInputTestCase):
    def test_goal_target_must_be_a_real_number(self):
        self.act_as(self.staff_user)

        for value in ('nan', 'inf', '-inf'):
            response = self.client.post(
                reverse('goal-list'), {'metric': 'tasks_completed', 'target_value': value}, format='json',
            )
            self.assert_bad_request(response, 'target_value')

    def test_rejecting_a_task_needs_a_text_reason(self):
        task = Task.objects.create(
            title='Reviewable',
            assigned_by=self.executive,
            assigned_to=self.staff_user,
            status='under_review',
            deadline=timezone.now() + timedelta(days=1),
        )
        self.act_as(self.executive)

        response = self.client.post(
            reverse('task-reject', kwargs={'pk': task.id}), {'reason': ['not', 'text']}, format='json',
        )

        self.assert_bad_request(response, 'reason')
        task.refresh_from_db()
        self.assertEqual(task.status, 'under_review')

    def test_push_subscription_body_must_be_an_object(self):
        self.act_as(self.staff_user)
        url = reverse('notifications-subscriptions')

        for body in (['a', 'list'], {'subscription': 'text'}, {'endpoint': 'https://push.example', 'keys': 'text'}):
            response = self.client.post(url, body, format='json')
            self.assert_bad_request(response)

    def test_todo_reminder_offsets_must_be_a_list_of_text(self):
        self.act_as(self.staff_user)

        for value in ([[1, 2]], 'exact', [{'a': 1}]):
            response = self.client.post(
                reverse('todo-list'), {'title': 'Buy milk', 'reminder_offsets': value}, format='json',
            )
            self.assert_bad_request(response, 'reminder_offsets')

    def test_todo_still_accepts_known_reminder_offsets(self):
        self.act_as(self.staff_user)

        response = self.client.post(
            reverse('todo-list'), {'title': 'Buy milk', 'reminder_offsets': ['15m', 'exact']}, format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['reminder_offsets'], ['15m', 'exact'])

    def test_snoozing_by_an_absurd_amount_is_bounded_not_a_crash(self):
        todo = TodoItem.objects.create(user=self.staff_user, title='Snooze me')
        self.act_as(self.staff_user)
        url = reverse('todo-snooze', kwargs={'pk': todo.id})

        response = self.client.post(url, {'minutes': 10 ** 30}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        for minutes in (-5, 0, 'soon'):
            self.assert_bad_request(self.client.post(url, {'minutes': minutes}, format='json'), 'minutes')

        todo.refresh_from_db()
        self.assertGreater(todo.reminder_at, timezone.now())
        self.assertLess(todo.reminder_at, timezone.now() + timedelta(days=800))


class SupportTransitionTests(BadInputTestCase):
    def setUp(self):
        super().setUp()
        self.dep_it, _ = Department.objects.get_or_create(
            name='IT', defaults={'code': 'IT', 'manages_inventory': True, 'handles_it_support': True}
        )
        self.ticket = SupportRequest.objects.create(
            requester=self.staff_user,
            title='Printer jam',
            category='IT_SUPPORT',
            description='Paper stuck.',
            department=self.dep_it,
            assigned_to=self.other_user,
            status='assigned',
        )

    def test_an_invalid_status_change_is_a_bad_request_with_a_reason(self):
        self.act_as(self.other_user)

        # "assigned" can only move to "in progress" or back to "open".
        response = self.client.post(
            reverse('support-request-status', kwargs={'pk': self.ticket.id}),
            {'status': 'resolved'},
            format='json',
        )

        self.assert_bad_request(response)
        self.assertIn('Cannot transition', str(response.data['error']['details']))
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status, 'assigned')

    def test_resolving_before_work_starts_is_a_bad_request(self):
        self.act_as(self.other_user)

        response = self.client.post(reverse('support-request-resolve', kwargs={'pk': self.ticket.id}))

        self.assert_bad_request(response)
        self.ticket.refresh_from_db()
        self.assertEqual(self.ticket.status, 'assigned')

    def test_attaching_to_a_malformed_comment_id_is_a_bad_request(self):
        self.act_as(self.staff_user)

        response = self.client.post(
            reverse('support-request-attachments', kwargs={'pk': self.ticket.id}),
            {
                # Whatever folder is configured, so a local .env cannot change the outcome.
                'object_key': support_attachment_key_prefix(self.ticket.id) + 'a' * 32 + '.png',
                'file_name': 'jam.png',
                'content_type': 'image/png',
                'size': 100,
                'comment_id': 'not-a-uuid',
            },
            format='json',
        )

        self.assert_bad_request(response, 'comment_id')


class StaleTokenOnPublicEndpointTests(BadInputTestCase):
    """A leftover or expired token must not stop someone signing in again."""

    STALE = {'HTTP_AUTHORIZATION': 'Bearer this-token-is-not-valid'}

    def test_sign_in_works_with_a_stale_token_on_the_request(self):
        response = self.client.post(reverse('auth-login'), self.login_payload(), format='json', **self.STALE)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.cookies['access_token'].value)

    def test_wrong_password_is_still_unauthorized_not_forbidden(self):
        response = self.client.post(
            reverse('auth-login'), self.login_payload(password='WrongPassword123!'), format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_works_with_a_stale_access_token_on_the_request(self):
        login = self.client.post(reverse('auth-login'), self.login_payload(), format='json')
        refresh = login.cookies['refresh_token'].value
        self.client.cookies.clear()
        self.client.cookies.clear()

        response = self.client.post(reverse('auth-refresh'), {'refresh': refresh}, format='json', **self.STALE)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.cookies['access_token'].value)

    def test_password_reset_request_ignores_a_stale_token(self):
        response = self.client.post(
            reverse('auth-password-reset-request'), {'email': self.staff_user.email}, format='json', **self.STALE,
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
