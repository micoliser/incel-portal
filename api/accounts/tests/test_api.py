from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core import mail
from django.urls import reverse
from rest_framework import status

from accounts.models import StaffProfile
from applications.models import AuditLog
from common.test_utils import BaseAPITestCase
from organization.models import Role

User = get_user_model()


def _email_html(message):
    """Everything the recipient can read: the plain body and any HTML part."""
    parts = [message.body] + [body for body, _mimetype in getattr(message, 'alternatives', [])]
    return '\n'.join(str(part) for part in parts)


class AccountsApiTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.role_admin = Role.objects.create(name='Admin', code='ADMIN', has_global_access=True)
        self.admin_writer = User.objects.create_user(
            username='admin.writer@example.com',
            email='admin.writer@example.com',
            password='AdminWriterStrongPass123!',
            first_name='Admin',
            last_name='Writer',
        )
        StaffProfile.objects.create(
            user=self.admin_writer,
            role=self.role_admin,
            department=self.dep_eng,
            is_active=True,
        )

    def test_login_success_sets_token_cookies(self):
        response = self.client.post(reverse('auth-login'), self.login_payload(), format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Tokens travel only in HttpOnly cookies, never in the body.
        self.assertNotIn('tokens', response.data)
        for name in ('access_token', 'refresh_token'):
            self.assertTrue(response.cookies[name].value)
            self.assertTrue(response.cookies[name]['httponly'])
        self.assertEqual(response.data['user']['email'], 'staff@example.com')

    def test_login_is_case_insensitive_for_email(self):
        response = self.client.post(
            reverse('auth-login'),
            self.login_payload(email='STAFF@EXAMPLE.COM'),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_login_fails_for_wrong_password(self):
        response = self.client.post(
            reverse('auth-login'),
            self.login_payload(password='WrongPass!'),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_works_without_an_access_token(self):
        login = self.client.post(reverse('auth-login'), self.login_payload(), format='json')
        refresh = login.cookies['refresh_token'].value
        self.client.cookies.clear()

        response = self.client.post(reverse('auth-logout'), {'refresh': refresh}, format='json')
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        # The session is over: its refresh token no longer works.
        response = self.client.post(reverse('auth-refresh'), {'refresh': refresh}, format='json')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertTrue(AuditLog.objects.filter(action='AUTH_LOGOUT', target_id=str(self.staff_user.id)).exists())

    def test_logout_with_an_invalid_refresh_token_still_clears_cookies(self):
        response = self.client.post(reverse('auth-logout'), {'refresh': 'invalid'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(response.cookies['access_token'].value, '')
        self.assertEqual(response.cookies['refresh_token'].value, '')

    def test_refresh_token_success(self):
        login = self.client.post(reverse('auth-login'), self.login_payload(), format='json')
        refresh = login.cookies['refresh_token'].value
        self.client.cookies.clear()

        response = self.client.post(reverse('auth-refresh'), {'refresh': refresh}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn('access', response.data)
        self.assertTrue(response.cookies['access_token'].value)
        self.assertTrue(response.cookies['refresh_token'].value)

    def test_change_password_success(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('auth-change-password'),
            {'old_password': 'StaffStrongPass123!', 'new_password': 'EvenStrongerPass123!'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.staff_user.refresh_from_db()
        self.assertTrue(self.staff_user.check_password('EvenStrongerPass123!'))

    @patch('accounts.views_api.UserEmailManager.send_password_changed_email')
    def test_change_password_sends_email(self, mock_send_email):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('auth-change-password'),
            {'old_password': 'StaffStrongPass123!', 'new_password': 'EvenStrongerPass123!'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(mock_send_email.called)
        _, kwargs = mock_send_email.call_args
        self.assertEqual(kwargs.get('action'), 'changed')

    def test_change_password_fails_with_incorrect_old_password(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('auth-change-password'),
            {'old_password': 'WrongOldPass', 'new_password': 'AnotherStrongPass123!'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertTrue(
            AuditLog.objects.filter(
                action='AUTH_PASSWORD_CHANGE_FAILED',
                target_type='User',
                target_id=str(self.staff_user.id),
            ).exists()
        )

    def test_me_endpoint_returns_profile(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('me'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['email'], 'staff@example.com')
        self.assertEqual(response.data['department_id'], self.dep_eng.id)

    def test_me_permissions_shows_global_access_for_ed(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.get(reverse('me-permissions'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['has_global_access'])
        self.assertEqual(response.data['role_code'], 'ED')

    def test_users_list_requires_authentication(self):
        response = self.client.get(reverse('users-list'))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_users_list_returns_active_users_for_authenticated(self):
        inactive_user = User.objects.create_user(
            username='inactive@example.com',
            email='inactive@example.com',
            password='InactiveStrongPass123!',
            is_active=False,
        )
        StaffProfile.objects.create(
            user=inactive_user,
            role=self.role_staff,
            department=self.dep_eng,
            is_active=False,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('users-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get('results', response.data)
        emails = [item['email'] for item in results]
        self.assertIn('admin@example.com', emails)
        self.assertIn('staff@example.com', emails)
        self.assertNotIn('inactive@example.com', emails)

    def test_users_list_filters_by_department(self):
        hr_user = User.objects.create_user(
            username='hr.user@example.com',
            email='hr.user@example.com',
            password='HrStrongPass123!',
            first_name='Hr',
            last_name='User',
            is_active=True,
        )
        StaffProfile.objects.create(
            user=hr_user,
            role=self.role_staff,
            department=self.dep_hr,
            is_active=True,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('users-list'), {'department_id': self.dep_hr.id})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        results = response.data.get('results', response.data)
        self.assertTrue(all(item['department_id'] == self.dep_hr.id for item in results))
        emails = [item['email'] for item in results]
        self.assertIn('hr.user@example.com', emails)
        self.assertNotIn('staff@example.com', emails)

    def test_users_list_supports_search_by_name_or_email(self):
        user = User.objects.create_user(
            username='john.doe@example.com',
            email='john.doe@example.com',
            password='JohnStrongPass123!',
            first_name='John',
            last_name='Doe',
            is_active=True,
        )
        StaffProfile.objects.create(
            user=user,
            role=self.role_staff,
            department=self.dep_eng,
            is_active=True,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))

        by_name = self.client.get(reverse('users-list'), {'search': 'John'})
        self.assertEqual(by_name.status_code, status.HTTP_200_OK)
        results_by_name = by_name.data.get('results', by_name.data)
        self.assertIn('john.doe@example.com', [item['email'] for item in results_by_name])

        by_email = self.client.get(reverse('users-list'), {'search': 'john.doe@example.com'})
        self.assertEqual(by_email.status_code, status.HTTP_200_OK)
        results_by_email = by_email.data.get('results', by_email.data)
        self.assertIn('john.doe@example.com', [item['email'] for item in results_by_email])

    def test_staff_cannot_create_user_via_admin_users_route(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        payload = {
            'first_name': 'Blocked',
            'last_name': 'Create',
            'email': 'blocked.create@example.com',
            'department_id': self.dep_hr.id,
        }

        response = self.client.post(reverse('users-list'), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_only_admins_and_executives_can_list_inactive_users(self):
        self.admin_writer.is_active = False
        self.admin_writer.save(update_fields=['is_active'])

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('users-list'), {'include_inactive': 'true'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn('admin.writer@example.com', [u['email'] for u in response.data['results']])

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.get(reverse('users-list'))
        self.assertNotIn('admin.writer@example.com', [u['email'] for u in response.data['results']])
        response = self.client.get(reverse('users-list'), {'include_inactive': 'true'})
        self.assertIn('admin.writer@example.com', [u['email'] for u in response.data['results']])

    def test_user_detail_requires_global_access(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('users-detail', kwargs={'user_id': self.admin_user.id}))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_create_user_defaults_role_to_staff(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))
        payload = {
            'first_name': 'New',
            'last_name': 'Member',
            'email': 'new.member@example.com',
            'department_id': self.dep_hr.id,
        }

        response = self.client.post(reverse('users-list'), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created = User.objects.get(email='new.member@example.com')
        self.assertEqual(created.staff_profile.role.code, 'STAFF')
        self.assertEqual(created.staff_profile.department_id, self.dep_hr.id)
        self.assertTrue(AuditLog.objects.filter(action='ADMIN_USER_CREATED', target_id=str(created.id)).exists())

    def test_admin_user_create_rejects_duplicate_email(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))
        payload = {
            'first_name': 'Dup',
            'last_name': 'User',
            'email': 'staff@example.com',
            'department_id': self.dep_hr.id,
        }

        response = self.client.post(reverse('users-list'), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_user_create_rejects_invalid_department(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))
        payload = {
            'first_name': 'No',
            'last_name': 'Department',
            'email': 'nodept@example.com',
            'department_id': 999999,
        }

        response = self.client.post(reverse('users-list'), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_user_detail_not_found(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))
        response = self.client.get(reverse('users-detail', kwargs={'user_id': 999999}))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_admin_can_update_user_role(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))
        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}),
            {'role_id': self.role_md.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.staff_user.refresh_from_db()
        self.assertEqual(self.staff_user.staff_profile.role_id, self.role_md.id)

    def test_admin_role_update_rejects_invalid_role(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))
        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}),
            {'role_id': '00000000-0000-0000-0000-000000000000'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_can_update_user_department(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))
        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}),
            {'department_id': self.dep_hr.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.staff_user.refresh_from_db()
        self.assertEqual(self.staff_user.staff_profile.department_id, self.dep_hr.id)

    def test_user_update_changes_only_the_fields_sent(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))
        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}),
            {'first_name': 'Renamed'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.staff_user.refresh_from_db()
        self.assertEqual(self.staff_user.first_name, 'Renamed')
        self.assertEqual(self.staff_user.last_name, 'Member')
        self.assertEqual(self.staff_user.email, 'staff@example.com')
        self.assertEqual(self.staff_user.staff_profile.department_id, self.dep_eng.id)
        self.assertEqual(self.staff_user.staff_profile.role_id, self.role_staff.id)

    def test_user_update_does_not_accept_put(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))
        response = self.client.put(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}),
            {'first_name': 'Renamed'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_admin_can_toggle_user_status(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))
        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}),
            {'is_active': False},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.staff_user.refresh_from_db()
        self.assertFalse(self.staff_user.is_active)
        self.assertFalse(self.staff_user.staff_profile.is_active)

    def test_staff_cannot_call_admin_mutation_endpoints(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.admin_user.id}),
            {'is_active': False},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_default_staff_role_auto_created_when_missing(self):
        # Move existing staff users away from STAFF so protected FK doesn't block deletion.
        self.staff_user.staff_profile.role = self.role_md
        self.staff_user.staff_profile.save(update_fields=['role', 'updated_at'])
        Role.objects.filter(code='STAFF').delete()
        self.client.credentials(**self.auth_headers_for(self.admin_writer))

        response = self.client.post(
            reverse('users-list'),
            {
                'first_name': 'Auto',
                'last_name': 'Staff',
                'email': 'autostaff@example.com',
                    'department_id': self.dep_eng.id,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Role.objects.filter(code='STAFF').exists())

    def test_global_access_non_admin_cannot_call_admin_mutation_endpoints(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}),
            {'is_active': False},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_password_reset_sends_a_link_and_leaves_the_password_alone(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))

        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}),
            {'send_reset_link': True},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.staff_user.refresh_from_db()
        self.assertTrue(self.staff_user.check_password('StaffStrongPass123!'))
        self.assertTrue(
            AuditLog.objects.filter(
                action='ADMIN_USER_PASSWORD_RESET',
                target_type='User',
                target_id=str(self.staff_user.id),
            ).exists()
        )
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['staff@example.com'])
        self.assertIn('/reset-password?uid=', _email_html(mail.outbox[0]))

    def test_admin_cannot_set_a_password_directly(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))

        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}),
            {'reset_password': True, 'new_password': 'N9!vQ2@tLm7#', 'confirm_password': 'N9!vQ2@tLm7#'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.staff_user.refresh_from_db()
        self.assertTrue(self.staff_user.check_password('StaffStrongPass123!'))

    def test_admin_user_update_requires_last_name(self):
        self.client.credentials(**self.auth_headers_for(self.admin_writer))
        url = reverse('users-detail', kwargs={'user_id': self.staff_user.id})
        base = {
            'first_name': self.staff_user.first_name,
            'email': self.staff_user.email,
            'department_id': self.dep_eng.id,
        }

        for last_name in ('', '   '):
            response = self.client.patch(url, {**base, 'last_name': last_name}, format='json')
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, last_name)
            self.assertIn('last_name', response.data['error']['details'])

        self.staff_user.refresh_from_db()
        self.assertEqual(self.staff_user.last_name, 'Member')

        response = self.client.patch(url, {**base, 'last_name': '  Renamed  '}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.staff_user.refresh_from_db()
        self.assertEqual(self.staff_user.last_name, 'Renamed')
