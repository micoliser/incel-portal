import datetime

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import ServiceApiKey, StaffProfile
from organization.models import Department, Role

User = get_user_model()


class ExternalUserAPITests(TestCase):
    def setUp(self):
        self.client = APIClient()

        # Create Role and Department for profiles
        self.role, _ = Role.objects.get_or_create(
            code='ADMIN',
            defaults={'name': 'Administrator', 'has_global_access': True, 'is_active': True},
        )
        self.dept, _ = Department.objects.get_or_create(
            code='EXEC',
            defaults={'name': 'Executive', 'is_active': True},
        )

        # Target user 1 (Active)
        self.user1 = User.objects.create_user(
            username='samueliwelumo@gmail.com',
            email='samueliwelumo@gmail.com',
            first_name='Samuel',
            last_name='Iwelumo',
            password='password123',
            is_active=True,
        )
        StaffProfile.objects.create(
            user=self.user1,
            role=self.role,
            department=self.dept,
            is_active=True,
        )

        # Target user 2 (Active)
        self.user2 = User.objects.create_user(
            username='samueliwelumo@incelgroup.com',
            email='samueliwelumo@incelgroup.com',
            first_name='Samuel',
            last_name='Iwelumo Staff',
            password='password123',
            is_active=True,
        )
        StaffProfile.objects.create(
            user=self.user2,
            role=self.role,
            department=self.dept,
            is_active=True,
        )

        # Other user (should NOT be returned by current restriction)
        self.other_user = User.objects.create_user(
            username='john.doe@incelgroup.com',
            email='john.doe@incelgroup.com',
            first_name='John',
            last_name='Doe',
            password='password123',
            is_active=True,
        )
        StaffProfile.objects.create(
            user=self.other_user,
            role=self.role,
            department=self.dept,
            is_active=True,
        )

        # Inactive user (should NOT be returned by default). Email addresses are
        # unique, so it has its own.
        self.inactive_user = User.objects.create_user(
            username='inactive_samuel@gmail.com',
            email='inactive_samuel@gmail.com',
            first_name='Inactive',
            last_name='Samuel',
            password='password123',
            is_active=False,
        )

        # Create a valid Service API Key
        self.api_key_obj, self.raw_key = ServiceApiKey.generate_key(name='Test Integration Client')

    def test_missing_authorization_header_returns_401(self):
        response = self.client.get('/api/v1/external/users')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_invalid_bearer_token_returns_401(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer invalid_secret_token_123')
        response = self.client.get('/api/v1/external/users')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_revoked_api_key_returns_401(self):
        self.api_key_obj.is_active = False
        self.api_key_obj.save(update_fields=['is_active'])

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.raw_key}')
        response = self.client.get('/api/v1/external/users')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_expired_api_key_returns_401(self):
        self.api_key_obj.expires_at = timezone.now() - datetime.timedelta(days=1)
        self.api_key_obj.save(update_fields=['expires_at'])

        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.raw_key}')
        response = self.client.get('/api/v1/external/users')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_valid_bearer_token_returns_unpaginated_workspace_users(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.raw_key}')
        response = self.client.get('/api/v1/external/users')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()

        # Must be an unpaginated list directly (not a dict with 'results', 'count', etc.)
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 3)

        returned_emails = {u['email'] for u in data}
        self.assertEqual(
            returned_emails,
            {'samueliwelumo@gmail.com', 'samueliwelumo@incelgroup.com', 'john.doe@incelgroup.com'},
        )

        # Inactive user is excluded by default
        returned_usernames = {u['username'] for u in data}
        self.assertNotIn('inactive_samuel@gmail.com', returned_usernames)

        # Verify serializer fields are complete
        user_item = data[0]
        self.assertIn('id', user_item)
        self.assertIn('username', user_item)
        self.assertIn('email', user_item)
        self.assertIn('first_name', user_item)
        self.assertIn('last_name', user_item)
        self.assertIn('role', user_item)
        self.assertIn('department', user_item)
        self.assertTrue(user_item['is_active'])

        # Verify last_used_at was updated
        self.api_key_obj.refresh_from_db()
        self.assertIsNotNone(self.api_key_obj.last_used_at)

    def test_is_active_all_returns_all_users_including_inactive(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.raw_key}')
        response = self.client.get('/api/v1/external/users?is_active=all')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(len(data), 4)

        returned_usernames = {u['username'] for u in data}
        self.assertIn('inactive_samuel@gmail.com', returned_usernames)

    def test_is_active_false_returns_only_inactive_users(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.raw_key}')
        response = self.client.get('/api/v1/external/users?is_active=false')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['username'], 'inactive_samuel@gmail.com')
        self.assertFalse(data[0]['is_active'])



class ServiceApiKeyHardeningTests(TestCase):
    def setUp(self):
        self.url = reverse('external-users-list')

    def _get(self, raw_key):
        return self.client.get(self.url, HTTP_AUTHORIZATION=f'Bearer {raw_key}')

    def test_a_key_without_the_scope_is_refused(self):
        _key, raw = ServiceApiKey.generate_key(name='No scope', scopes=[])
        self.assertEqual(self._get(raw).status_code, 403)

        _key, raw = ServiceApiKey.generate_key(name='Directory reader')
        self.assertEqual(self._get(raw).status_code, 200)

    def test_last_used_is_recorded_at_most_once_a_minute(self):
        key, raw = ServiceApiKey.generate_key(name='Busy client')
        with CaptureQueriesContext(connection) as first:
            self._get(raw)
        key.refresh_from_db()
        self.assertIsNotNone(key.last_used_at)
        with CaptureQueriesContext(connection) as second:
            self._get(raw)
        updates = [q for q in second.captured_queries if q['sql'].startswith('UPDATE')]
        self.assertEqual(updates, [])
        self.assertTrue(any(q['sql'].startswith('UPDATE') for q in first.captured_queries))

    def test_admin_form_refuses_a_short_custom_key(self):
        from accounts.admin import ServiceApiKeyAdminForm

        form = ServiceApiKeyAdminForm(data={'name': 'Weak', 'custom_key': 'password123', 'is_active': True})
        self.assertFalse(form.is_valid())
        self.assertIn('custom_key', form.errors)

        form = ServiceApiKeyAdminForm(data={'name': 'Strong', 'custom_key': 'x' * 40, 'is_active': True})
        self.assertTrue(form.is_valid(), form.errors)

    def test_admin_banner_escapes_the_key_name(self):
        from django.contrib.admin.sites import site
        from django.contrib.messages.storage.fallback import FallbackStorage
        from django.test import RequestFactory

        from accounts.admin import ServiceApiKeyAdmin

        key, _raw = ServiceApiKey.generate_key(name='<script>alert(1)</script>')
        request = RequestFactory().get('/')
        request.session = {}
        request._messages = FallbackStorage(request)
        request._generated_raw_api_key = 'raw-key'
        ServiceApiKeyAdmin(ServiceApiKey, site)._append_key_banner(request, key)

        rendered = str(list(request._messages)[0])
        self.assertNotIn('<script>', rendered)
        self.assertIn('&lt;script&gt;', rendered)
