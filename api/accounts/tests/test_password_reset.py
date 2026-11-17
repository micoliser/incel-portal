from unittest.mock import patch

from django.contrib.auth.models import User
from django.contrib.auth.tokens import default_token_generator
from django.core import mail
from django.core.cache import cache
from django.test import override_settings
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
        cache.clear()
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

    def test_request_reset_answers_the_same_for_every_email(self):
        """The response must not reveal whether an email has an account or its status."""
        url = reverse('auth-password-reset-request')
        responses = [
            self.client.post(url, {'email': email}, format='json')
            for email in ('nobody@incelgroup.com', 'inactive.user@example.com', self.staff_user.email)
        ]

        for response in responses:
            self.assertEqual(response.status_code, status.HTTP_200_OK)
            self.assertEqual(response.data, responses[0].data)

        # Only the real, active account is sent anything.
        self.assertEqual([message.to for message in mail.outbox], [[self.staff_user.email]])

        reasons = set(
            AuditLog.objects.filter(action='AUTH_PASSWORD_RESET_FAILED').values_list('metadata_json__reason', flat=True)
        )
        self.assertEqual(reasons, {'user_not_found', 'user_inactive'})

    def test_request_reset_valid_user_sends_email_and_logs_audit(self):
        url = reverse('auth-password-reset-request')
        response = self.client.post(url, {'email': self.staff_user.email}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('reset link has been sent', response.data['detail'])

        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('reset-password?uid=', mail.outbox[0].body + str(mail.outbox[0].alternatives))

        audit = AuditLog.objects.filter(action='AUTH_PASSWORD_RESET_REQUESTED').first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.target_id, str(self.staff_user.id))

    @override_settings(PASSWORD_RESET_EMAILS_PER_HOUR=3)
    def test_one_account_is_sent_a_limited_number_of_reset_emails(self):
        url = reverse('auth-password-reset-request')
        for _ in range(5):
            response = self.client.post(url, {'email': self.staff_user.email}, format='json')
            self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.assertEqual(len(mail.outbox), 3)

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
        self.assertIn('invalid or has expired', str(response.data['error']['details']))

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
