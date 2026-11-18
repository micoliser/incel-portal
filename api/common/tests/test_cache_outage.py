"""A broken cache must not take the API down (the 2026-11-17 production incident:
a wrong CACHE_URL host made every request a 500)."""

import socket
import time
import uuid

from django.contrib.auth.models import User
from django.core.cache import cache, caches
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import StaffProfile
from common.cache import ResilientRedisCache
from organization.models import Department, Role

UNREACHABLE = {
    'default': {
        'BACKEND': 'common.cache.ResilientRedisCache',
        # .invalid never resolves: the same failure as the wrong host in production.
        'LOCATION': 'redis://cache.invalid:6379/14',
        'OPTIONS': {'socket_connect_timeout': 1, 'socket_timeout': 1},
    }
}


def _local_redis_running():
    try:
        with socket.create_connection(('127.0.0.1', 6379), timeout=0.5):
            return True
    except OSError:
        return False


@override_settings(CACHES=UNREACHABLE)
class UnreachableCacheTests(TestCase):
    def setUp(self):
        role = Role.objects.create(name='Staff', code='STAFF')
        department = Department.objects.create(name='Engineering', code='ENG')
        self.user = User.objects.create_user('staff@example.com', email='staff@example.com', password='StrongPass123!x')
        StaffProfile.objects.create(user=self.user, role=role, department=department)
        # Real rate limiting runs here: these tests do not switch throttles off.
        self.client = APIClient()

    def test_the_cache_behaves_as_empty_instead_of_raising(self):
        self.assertIsInstance(caches['default'], ResilientRedisCache)
        self.assertEqual(cache.get('anything', 'fallback'), 'fallback')
        self.assertIsNone(cache.set('anything', 1))
        self.assertTrue(cache.add('lock', 1))
        self.assertFalse(cache.delete('anything'))
        self.assertEqual(cache.get_many(['a', 'b']), {})
        with self.assertRaises(ValueError):
            cache.incr('counter')

    def test_signing_in_and_using_the_api_still_work(self):
        response = self.client.post(
            '/api/v1/auth/login', {'email': 'staff@example.com', 'password': 'StrongPass123!x'}, format='json'
        )
        self.assertEqual(response.status_code, 200)

        self.assertEqual(self.client.get('/api/v1/me').status_code, 200)
        self.assertEqual(self.client.get('/api/v1/tasks').status_code, 200)

    def test_a_wrong_password_is_still_refused(self):
        response = self.client.post(
            '/api/v1/auth/login', {'email': 'staff@example.com', 'password': 'wrong'}, format='json'
        )
        self.assertEqual(response.status_code, 401)

    def test_a_dead_cache_does_not_slow_requests_to_a_crawl(self):
        started = time.monotonic()
        for _ in range(3):
            self.client.post('/api/v1/auth/password-reset', {'email': 'nobody@example.com'}, format='json')
        self.assertLess(time.monotonic() - started, 15)

    def test_the_health_check_reports_the_cache_without_failing(self):
        response = self.client.get('/health/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'status': 'degraded', 'cache': 'unreachable'})


class ReachableCacheTests(TestCase):
    """With Redis up, the backend is Django's own: values are stored and read back."""

    def test_values_round_trip_through_redis(self):
        if not _local_redis_running():
            self.skipTest('No Redis on 127.0.0.1:6379')

        backend = ResilientRedisCache('redis://127.0.0.1:6379/13', {'KEY_PREFIX': f'test-{uuid.uuid4().hex}'})
        self.assertTrue(backend.is_available())
        backend.set('greeting', 'hello', 30)
        self.assertEqual(backend.get('greeting'), 'hello')
        self.assertFalse(backend.add('greeting', 'again', 30))
        self.assertTrue(backend.delete('greeting'))
        self.assertIsNone(backend.get('greeting'))
