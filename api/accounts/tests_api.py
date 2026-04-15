from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework import status

from applications.models import AuditLog, InternalApplication
from common.test_utils import BaseAPITestCase
from organization.models import Role


class AccountsApiTests(BaseAPITestCase):
    def test_login_success_returns_jwt_tokens(self):
        response = self.client.post(reverse('auth-login'), self.login_payload(), format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('tokens', response.data)
        self.assertIn('access', response.data['tokens'])
        self.assertIn('refresh', response.data['tokens'])
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

    def test_logout_requires_authentication(self):
        response = self.client.post(reverse('auth-logout'), {'refresh': 'x'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_logout_rejects_invalid_refresh_token(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(reverse('auth-logout'), {'refresh': 'invalid'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_refresh_token_success(self):
        login = self.client.post(reverse('auth-login'), self.login_payload(), format='json')
        refresh = login.data['tokens']['refresh']

        response = self.client.post(reverse('auth-refresh'), {'refresh': refresh}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('access', response.data)

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

    def test_change_password_fails_with_incorrect_old_password(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('auth-change-password'),
            {'old_password': 'WrongOldPass', 'new_password': 'AnotherStrongPass123!'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

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

    def test_me_applications_includes_access_flags(self):
        restricted = InternalApplication.objects.create(
            name='Restricted Tool',
            slug='restricted-tool',
            app_url='https://example.com/restricted',
            access_scope=InternalApplication.AccessScope.RESTRICTED,
        )
        restricted.departments.add(self.dep_hr)
        open_app = InternalApplication.objects.create(
            name='Open Tool',
            slug='open-tool',
            app_url='https://example.com/open',
            access_scope=InternalApplication.AccessScope.ALL_AUTHENTICATED,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('me-applications'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data_by_slug = {item['slug']: item for item in response.data}
        self.assertFalse(data_by_slug['restricted-tool']['can_access'])
        self.assertTrue(data_by_slug['open-tool']['can_access'])
        self.assertIn(open_app.slug, data_by_slug)

    def test_admin_users_list_requires_global_access(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('admin-users-list'))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_admin_can_create_user_defaults_role_to_staff(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        payload = {
            'first_name': 'New',
            'last_name': 'Member',
            'email': 'new.member@example.com',
            'password': 'VeryStrongPass123!',
            'department_id': self.dep_hr.id,
        }

        response = self.client.post(reverse('admin-users-list'), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created = User.objects.get(email='new.member@example.com')
        self.assertEqual(created.staff_profile.role.code, 'STAFF')
        self.assertEqual(created.staff_profile.department_id, self.dep_hr.id)
        self.assertTrue(AuditLog.objects.filter(action='ADMIN_USER_CREATED', target_id=str(created.id)).exists())

    def test_admin_user_create_rejects_duplicate_email(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        payload = {
            'first_name': 'Dup',
            'last_name': 'User',
            'email': 'staff@example.com',
            'password': 'VeryStrongPass123!',
            'department_id': self.dep_hr.id,
        }

        response = self.client.post(reverse('admin-users-list'), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_user_create_rejects_invalid_department(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        payload = {
            'first_name': 'No',
            'last_name': 'Department',
            'email': 'nodept@example.com',
            'password': 'VeryStrongPass123!',
            'department_id': 999999,
        }

        response = self.client.post(reverse('admin-users-list'), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_user_detail_not_found(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.get(reverse('admin-users-detail', kwargs={'user_id': 999999}))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_admin_can_update_user_role(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.patch(
            reverse('admin-users-role', kwargs={'user_id': self.staff_user.id}),
            {'role_id': self.role_md.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.staff_user.refresh_from_db()
        self.assertEqual(self.staff_user.staff_profile.role_id, self.role_md.id)

    def test_admin_role_update_rejects_invalid_role(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.patch(
            reverse('admin-users-role', kwargs={'user_id': self.staff_user.id}),
            {'role_id': 999999},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_admin_can_update_user_department(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.put(
            reverse('admin-users-department', kwargs={'user_id': self.staff_user.id}),
            {'department_id': self.dep_hr.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.staff_user.refresh_from_db()
        self.assertEqual(self.staff_user.staff_profile.department_id, self.dep_hr.id)

    def test_admin_department_update_requires_department(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.put(
            reverse('admin-users-department', kwargs={'user_id': self.staff_user.id}),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_can_toggle_user_status(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.patch(
            reverse('admin-users-status', kwargs={'user_id': self.staff_user.id}),
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
            reverse('admin-users-status', kwargs={'user_id': self.admin_user.id}),
            {'is_active': False},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_default_staff_role_auto_created_when_missing(self):
        # Move existing staff users away from STAFF so protected FK doesn't block deletion.
        self.staff_user.staff_profile.role = self.role_md
        self.staff_user.staff_profile.save(update_fields=['role', 'updated_at'])
        Role.objects.filter(code='STAFF').delete()
        self.client.credentials(**self.auth_headers_for(self.admin_user))

        response = self.client.post(
            reverse('admin-users-list'),
            {
                'first_name': 'Auto',
                'last_name': 'Staff',
                'email': 'autostaff@example.com',
                'password': 'VeryStrongPass123!',
                'department_id': self.dep_eng.id,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(Role.objects.filter(code='STAFF').exists())
