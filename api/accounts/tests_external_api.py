import datetime
from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from accounts.models import ServiceApiKey
from organization.models import Department, Role
from accounts.models import StaffProfile

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

        # Inactive user matching email (should NOT be returned because is_active=False)
        self.inactive_user = User.objects.create_user(
            username='inactive_samuel@gmail.com',
            email='samueliwelumo@gmail.com',
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

    def test_valid_bearer_token_returns_unpaginated_restricted_users(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self.raw_key}')
        response = self.client.get('/api/v1/external/users')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()

        # Must be an unpaginated list directly (not a dict with 'results', 'count', etc.)
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 2)

        returned_emails = {u['email'] for u in data}
        self.assertEqual(returned_emails, {'samueliwelumo@gmail.com', 'samueliwelumo@incelgroup.com'})

        # Verify other active user is excluded
        self.assertNotIn('john.doe@incelgroup.com', returned_emails)

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

