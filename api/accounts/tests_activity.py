from datetime import timedelta

from django.utils import timezone
from django.contrib.auth.models import User
from rest_framework import status

from common.test_utils import BaseAPITestCase
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken


class ActivityTests(BaseAPITestCase):
    def test_heartbeat_updates_last_activity(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        resp = self.client.post('/api/v1/auth/heartbeat')
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)

        profile = self.staff_user.staff_profile
        profile.refresh_from_db()
        self.assertIsNotNone(profile.last_activity_at)
        self.assertTrue(timezone.now() - profile.last_activity_at < timedelta(seconds=30))

    def test_middleware_updates_last_activity_on_request(self):
        # Ensure initial value is None
        profile = self.staff_user.staff_profile
        profile.last_activity_at = None
        profile.save(update_fields=['last_activity_at'])

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        resp = self.client.get('/api/v1/me')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)

        profile.refresh_from_db()
        self.assertIsNotNone(profile.last_activity_at)

    def test_refresh_rejected_after_inactivity(self):
        # Create a refresh token and set last_activity_at to >1 hour ago
        refresh = RefreshToken.for_user(self.staff_user)
        profile = self.staff_user.staff_profile
        profile.last_activity_at = timezone.now() - timedelta(hours=2)
        profile.save(update_fields=['last_activity_at'])

        resp = self.client.post('/api/v1/auth/refresh', {'refresh': str(refresh)}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertIn('Session expired', resp.data.get('detail', ''))

        # The refresh token should be blacklisted
        jti = refresh['jti']
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=jti).exists())
