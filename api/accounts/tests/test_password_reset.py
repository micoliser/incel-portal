from unittest.mock import patch
from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework import status

from accounts.models import StaffProfile
from applications.models import AuditLog
from common.test_utils import BaseAPITestCase


class PasswordResetApiTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.inactive_user = User.objects.create_user(
            username='inactive.user@example.com',
            email='inactive.user@example.com',
            password='InitialPassword123!',
            first_name='Inactive',
            last_name='User',
            is_active=False,
        )
        StaffProfile.objects.create(
            user=self.inactive_user,
            role=self.role_staff,
            department=self.dep_eng,
            is_active=False,
        )

    def test_request_reset_nonexistent_email_returns_404_ux_transparency(self):
        url = reverse('auth-password-reset-request')
        response = self.client.post(url, {'email': 'nobody@incelgroup.com'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        self.assertIn('No account found with this email address', response.data['detail'])

        audit = AuditLog.objects.filter(action='AUTH_PASSWORD_RESET_FAILED').first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.metadata_json.get('reason'), 'user_not_found')

    def test_request_reset_inactive_user_returns_403_ux_transparency(self):
        url = reverse('auth-password-reset-request')
        response = self.client.post(url, {'email': 'inactive.user@example.com'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('currently deactivated', response.data['detail'])

        audit = AuditLog.objects.filter(action='AUTH_PASSWORD_RESET_FAILED').first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.metadata_json.get('reason'), 'user_inactive')

    @patch('accounts.views_api.UserEmailManager.send_password_reset_email')
    def test_request_reset_valid_user_sends_email_and_logs_audit(self, mock_send_email):
        url = reverse('auth-password-reset-request')
        response = self.client.post(url, {'email': self.staff_user.email}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('reset link has been sent', response.data['detail'])

        mock_send_email.assert_called_once()
        args, kwargs = mock_send_email.call_args
        self.assertEqual(kwargs['user'], self.staff_user)
        self.assertIn('reset-password?uid=', kwargs['reset_url'])

        audit = AuditLog.objects.filter(action='AUTH_PASSWORD_RESET_REQUESTED').first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.target_id, str(self.staff_user.id))

    def test_validate_token_success(self):
        uid = urlsafe_base64_encode(force_bytes(self.staff_user.pk))
        token = default_token_generator.make_token(self.staff_user)

        url = reverse('auth-password-reset-validate')
        response = self.client.get(url, {'uid': uid, 'token': token})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['valid'])
        self.assertIn('***@example.com', response.data['email'])

    def test_validate_token_tampered_or_invalid(self):
        uid = urlsafe_base64_encode(force_bytes(self.staff_user.pk))
        url = reverse('auth-password-reset-validate')
        response = self.client.get(url, {'uid': uid, 'token': 'invalid-token-123'})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertFalse(response.data['valid'])
        self.assertIn('invalid or has expired', response.data['detail'])

    @patch('accounts.views_api.UserEmailManager.send_password_changed_email')
    def test_confirm_reset_success_updates_password_and_invalidates_token(self, mock_send_changed_email):
        uid = urlsafe_base64_encode(force_bytes(self.staff_user.pk))
        token = default_token_generator.make_token(self.staff_user)

        url = reverse('auth-password-reset-confirm')
        payload = {
            'uid': uid,
            'token': token,
            'new_password': 'BrandNewSecurePassword123!',
        }
        response = self.client.post(url, payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('successfully reset', response.data['detail'])

        self.staff_user.refresh_from_db()
        self.assertTrue(self.staff_user.check_password('BrandNewSecurePassword123!'))

        # Check token is now single-use and invalid
        self.assertFalse(default_token_generator.check_token(self.staff_user, token))

        # Check password changed email sent
        mock_send_changed_email.assert_called_once_with(self.staff_user, action='reset')

        # Check audit log
        audit = AuditLog.objects.filter(action='AUTH_PASSWORD_RESET_COMPLETED').first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.target_id, str(self.staff_user.id))

    def test_confirm_reset_invalid_token_fails(self):
        uid = urlsafe_base64_encode(force_bytes(self.staff_user.pk))
        url = reverse('auth-password-reset-confirm')
        payload = {
            'uid': uid,
            'token': 'bogus-token',
            'new_password': 'BrandNewSecurePassword123!',
        }
        response = self.client.post(url, payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('invalid or has expired', response.data['detail'])

    def test_confirm_reset_weak_password_rejected(self):
        uid = urlsafe_base64_encode(force_bytes(self.staff_user.pk))
        token = default_token_generator.make_token(self.staff_user)

        url = reverse('auth-password-reset-confirm')
        payload = {
            'uid': uid,
            'token': token,
            'new_password': 'short',
        }
        response = self.client.post(url, payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
