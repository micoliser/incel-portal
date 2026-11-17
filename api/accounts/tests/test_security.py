"""Sign-in protection, sessions, password links and who may manage whom."""

import re
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

from django.contrib.auth.models import User
from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.throttling import ScopedRateThrottle
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import StaffProfile
from accounts.services import account_setup_token_generator, revoke_user_sessions
from accounts.tasks import flush_expired_tokens, prune_auth_failure_audit_logs
from applications.models import AuditLog
from common.test_utils import BaseAPITestCase
from organization.models import Role

PORTAL = 'http://localhost:3000'
STAFF_PASSWORD = 'StaffStrongPass123!'


def email_text(message):
    parts = [message.body] + [body for body, _mimetype in getattr(message, 'alternatives', [])]
    return '\n'.join(str(part) for part in parts)


def link_parts(message):
    match = re.search(r'/reset-password\?uid=([^&"\s]+)&(?:amp;)?token=([^"\s<]+)', email_text(message))
    assert match, 'the email should contain a password link'
    return match.group(1), match.group(2)


class SecurityTestCase(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        cache.clear()

    def login(self, email='staff@example.com', password=STAFF_PASSWORD, **extra):
        return self.client.post(reverse('auth-login'), {'email': email, 'password': password}, format='json', **extra)


class LoginProtectionTests(SecurityTestCase):
    def test_attempts_remaining_counts_down_and_success_clears_it(self):
        first = self.login(password='wrong')
        second = self.login(password='wrong')
        self.assertEqual(int(first.data['error']['metadata']['attempts_remaining']), 9)
        self.assertEqual(int(second.data['error']['metadata']['attempts_remaining']), 8)

        self.assertEqual(self.login().status_code, status.HTTP_200_OK)
        self.client.cookies.clear()
        self.assertEqual(int(self.login(password='wrong').data['error']['metadata']['attempts_remaining']), 9)

    @override_settings(LOGIN_MAX_ATTEMPTS=3)
    def test_lockout_is_a_403_with_its_own_type_and_retry_after(self):
        for _ in range(3):
            self.login(password='wrong')

        response = self.login()  # even the right password is refused while locked
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['error']['type'], 'account_locked')
        self.assertIn('temporarily locked', response.data['error']['message'])
        self.assertTrue(response.headers.get('Retry-After'))

    @override_settings(LOGIN_MAX_ATTEMPTS=3, TRUSTED_PROXY_COUNT=1)
    def test_lockout_from_one_address_does_not_lock_the_account_for_others(self):
        for _ in range(3):
            self.login(password='wrong', HTTP_X_FORWARDED_FOR='203.0.113.9')
        self.assertEqual(
            self.login(HTTP_X_FORWARDED_FOR='203.0.113.9').status_code, status.HTTP_403_FORBIDDEN
        )

        # The real user, somewhere else, still gets in.
        self.assertEqual(self.login(HTTP_X_FORWARDED_FOR='198.51.100.7').status_code, status.HTTP_200_OK)

    @override_settings(LOGIN_MAX_ATTEMPTS=3, TRUSTED_PROXY_COUNT=1)
    def test_forged_forwarded_addresses_share_one_counter(self):
        """The caller controls everything left of the last X-Forwarded-For entry."""
        for forged in ('1.1.1.1', '2.2.2.2', '3.3.3.3'):
            self.login(password='wrong', HTTP_X_FORWARDED_FOR=f'{forged}, 203.0.113.9')

        response = self.login(HTTP_X_FORWARDED_FOR='4.4.4.4, 203.0.113.9')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    @override_settings(LOGIN_MAX_ATTEMPTS=100, LOGIN_ACCOUNT_MAX_ATTEMPTS_PER_HOUR=4, TRUSTED_PROXY_COUNT=1)
    def test_guessing_spread_over_many_addresses_hits_the_account_ceiling(self):
        for index in range(4):
            self.login(password='wrong', HTTP_X_FORWARDED_FOR=f'203.0.113.{index}')

        response = self.login(HTTP_X_FORWARDED_FOR='198.51.100.7')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_disabled_account_is_only_revealed_to_someone_with_the_password(self):
        self.staff_user.is_active = False
        self.staff_user.save(update_fields=['is_active'])

        wrong = self.login(password='wrong')
        self.assertEqual(wrong.status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(wrong.data['error']['message'], 'Invalid credentials.')

        right = self.login()
        self.assertEqual(right.status_code, status.HTTP_403_FORBIDDEN)
        self.assertIn('disabled', right.data['error']['message'])
        self.assertNotIn('access_token', right.cookies)

    def test_unknown_and_wrong_password_look_the_same(self):
        unknown = self.login(email='nobody@example.com', password='wrong')
        wrong = self.login(password='wrong')
        self.assertEqual(unknown.status_code, wrong.status_code)
        self.assertEqual(unknown.data['error']['message'], wrong.data['error']['message'])

    def test_repeated_attempts_on_an_unknown_email_write_one_audit_row(self):
        for _ in range(8):
            self.login(email='nobody@example.com', password='wrong')
        self.assertEqual(AuditLog.objects.filter(action='AUTH_LOGIN_FAILED').count(), 1)

    def test_login_throttle_uses_the_proxy_reported_address(self):
        self.throttle_patcher.stop()
        self.addCleanup(self.throttle_patcher.start)
        with override_settings(TRUSTED_PROXY_COUNT=1):
            from rest_framework.settings import api_settings

            with override_settings(REST_FRAMEWORK={**api_settings.user_settings, 'NUM_PROXIES': 1}):
                request_a = self.client.post(
                    reverse('auth-login'), {}, format='json', HTTP_X_FORWARDED_FOR='1.1.1.1, 203.0.113.9'
                ).wsgi_request
                request_b = self.client.post(
                    reverse('auth-login'), {}, format='json', HTTP_X_FORWARDED_FOR='2.2.2.2, 203.0.113.9'
                ).wsgi_request
                throttle = ScopedRateThrottle()
                self.assertEqual(throttle.get_ident(request_a), throttle.get_ident(request_b))
                self.assertEqual(throttle.get_ident(request_a), '203.0.113.9')


class CookieAndOriginTests(SecurityTestCase):
    @override_settings(DEBUG=False)
    def test_cookies_are_secure_outside_debug(self):
        response = self.login()
        for name in ('access_token', 'refresh_token'):
            cookie = response.cookies[name]
            self.assertTrue(cookie['secure'])
            self.assertTrue(cookie['httponly'])
            self.assertEqual(cookie['samesite'], 'Lax')

    def _sign_in_with_cookies(self):
        self.assertEqual(self.login().status_code, status.HTTP_200_OK)

    @override_settings(CORS_ALLOWED_ORIGINS=[PORTAL])
    def test_cookie_write_from_another_site_is_refused(self):
        self._sign_in_with_cookies()
        url = reverse('auth-heartbeat')

        self.assertEqual(self.client.post(url, {}, format='json', HTTP_ORIGIN=PORTAL).status_code, 204)
        self.assertEqual(
            self.client.post(url, {}, format='json', HTTP_ORIGIN='https://evil.example.com').status_code, 403
        )
        self.assertEqual(self.client.post(url, {}, format='json', HTTP_ORIGIN='null').status_code, 403)
        self.assertEqual(
            self.client.post(url, {}, format='json', HTTP_REFERER='https://evil.example.com/page').status_code, 403
        )
        self.assertEqual(self.client.post(url, {}, format='json', HTTP_REFERER=f'{PORTAL}/tasks').status_code, 204)

    @override_settings(CORS_ALLOWED_ORIGINS=[PORTAL])
    def test_cookie_reads_and_header_authenticated_writes_are_not_affected(self):
        self._sign_in_with_cookies()
        self.assertEqual(self.client.get(reverse('me'), HTTP_ORIGIN='https://evil.example.com').status_code, 200)

        self.client.cookies.clear()
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(reverse('auth-heartbeat'), {}, format='json', HTTP_ORIGIN='https://evil.example.com')
        self.assertEqual(response.status_code, 204)

    def test_form_encoded_bodies_are_not_accepted(self):
        """A cross-site HTML form can only send form encodings, never JSON."""
        response = self.client.post(
            reverse('auth-login'), {'email': 'staff@example.com', 'password': STAFF_PASSWORD}, format='multipart'
        )
        self.assertEqual(response.status_code, status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)

        self._sign_in_with_cookies()
        response = self.client.post(
            reverse('auth-change-password'),
            'old_password=a&new_password=b',
            content_type='application/x-www-form-urlencoded',
        )
        self.assertEqual(response.status_code, status.HTTP_415_UNSUPPORTED_MEDIA_TYPE)


class SessionRevocationTests(SecurityTestCase):
    def _refresh(self, token):
        self.client.cookies.clear()
        return self.client.post(reverse('auth-refresh'), {'refresh': token}, format='json')

    def test_change_password_ends_other_sessions_and_keeps_this_one(self):
        other_device = self.login().cookies['refresh_token'].value
        self.client.cookies.clear()
        self.login()

        response = self.client.post(
            reverse('auth-change-password'),
            {'old_password': STAFF_PASSWORD, 'new_password': 'EvenStrongerPass123!'},
            format='json',
            HTTP_ORIGIN=PORTAL,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertNotIn('tokens', response.data)
        this_device = response.cookies['refresh_token'].value

        self.assertEqual(self._refresh(other_device).status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(self._refresh(this_device).status_code, status.HTTP_200_OK)

    def test_password_reset_ends_every_session(self):
        session = self.login().cookies['refresh_token'].value
        self.client.cookies.clear()

        self.client.post(reverse('auth-password-reset-request'), {'email': 'staff@example.com'}, format='json')
        uid, token = link_parts(mail.outbox[-1])
        response = self.client.post(
            reverse('auth-password-reset-confirm'),
            {'uid': uid, 'token': token, 'new_password': 'BrandNewSecurePassword123!'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(self._refresh(session).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_deactivation_ends_every_session(self):
        session = self.login().cookies['refresh_token'].value
        self.client.cookies.clear()

        admin = User.objects.create_superuser('root@example.com', 'root@example.com', 'RootStrongPass123!')
        self.client.credentials(**self.auth_headers_for(admin))
        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}), {'is_active': False}, format='json'
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.client.credentials()

        self.assertEqual(self._refresh(session).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_refresh_is_refused_for_a_deactivated_user_even_with_a_live_token(self):
        token = str(RefreshToken.for_user(self.staff_user))
        User.objects.filter(pk=self.staff_user.pk).update(is_active=False)
        self.assertEqual(self._refresh(token).status_code, status.HTTP_401_UNAUTHORIZED)

    def test_revoke_is_safe_to_repeat(self):
        RefreshToken.for_user(self.staff_user)
        revoke_user_sessions(self.staff_user)
        revoke_user_sessions(self.staff_user)

    def test_expired_token_records_are_flushed(self):
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

        RefreshToken.for_user(self.staff_user)
        RefreshToken.for_user(self.admin_user)
        OutstandingToken.objects.filter(user=self.staff_user).update(expires_at=timezone.now() - timedelta(days=1))

        self.assertEqual(flush_expired_tokens(), 1)
        self.assertEqual(OutstandingToken.objects.count(), 1)


class PasswordLinkTests(SecurityTestCase):
    def setUp(self):
        super().setUp()
        self.root = User.objects.create_superuser('root@example.com', 'root@example.com', 'RootStrongPass123!')

    def _create_user(self):
        self.client.credentials(**self.auth_headers_for(self.root))
        response = self.client.post(
            reverse('users-list'),
            {'first_name': 'New', 'last_name': 'Starter', 'email': 'new.starter@example.com'},
            format='json',
        )
        self.client.credentials()
        return response

    def test_new_user_gets_a_link_and_chooses_their_own_password(self):
        response = self._create_user()
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

        user = User.objects.get(email='new.starter@example.com')
        self.assertFalse(user.has_usable_password())

        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ['new.starter@example.com'])
        self.assertNotIn('Initial Password', email_text(message))
        uid, token = link_parts(message)

        validate = self.client.get(reverse('auth-password-reset-validate'), {'uid': uid, 'token': token})
        self.assertEqual(validate.status_code, status.HTTP_200_OK)

        confirm = self.client.post(
            reverse('auth-password-reset-confirm'),
            {'uid': uid, 'token': token, 'new_password': 'ChosenByTheUser123!'},
            format='json',
        )
        self.assertEqual(confirm.status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.login(email='new.starter@example.com', password='ChosenByTheUser123!').status_code,
            status.HTTP_200_OK,
        )

        # A link works once.
        self.client.cookies.clear()
        again = self.client.post(
            reverse('auth-password-reset-confirm'),
            {'uid': uid, 'token': token, 'new_password': 'AnotherPassword123!'},
            format='json',
        )
        self.assertEqual(again.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_ignores_a_password_sent_by_the_administrator(self):
        self.client.credentials(**self.auth_headers_for(self.root))
        self.client.post(
            reverse('users-list'),
            {'first_name': 'New', 'last_name': 'Starter', 'email': 'new.starter@example.com', 'password': 'AdminChose123!'},
            format='json',
        )
        self.client.credentials()
        self.assertEqual(
            self.login(email='new.starter@example.com', password='AdminChose123!').status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    @override_settings(PASSWORD_RESET_TIMEOUT=3600, ACCOUNT_SETUP_LINK_TIMEOUT=72 * 3600)
    def test_setup_link_outlives_the_one_hour_reset_window_but_does_expire(self):
        token = account_setup_token_generator.make_token(self.staff_user)
        generator = account_setup_token_generator
        real_now = generator._now

        try:
            generator._now = lambda: real_now() + timedelta(hours=48)
            self.assertTrue(generator.check_token(self.staff_user, token))
            generator._now = lambda: real_now() + timedelta(hours=73)
            self.assertFalse(generator.check_token(self.staff_user, token))
        finally:
            del generator._now

    def test_account_emails_never_contain_a_password(self):
        self._create_user()
        self.client.credentials(**self.auth_headers_for(self.root))
        self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}), {'send_reset_link': True}, format='json'
        )
        for message in mail.outbox:
            self.assertNotRegex(email_text(message), r'(?i)temporary password|initial password')


class UserManagementRankTests(SecurityTestCase):
    """An administrator must not be able to take over a more senior account."""

    def setUp(self):
        super().setUp()
        role_admin = Role.objects.create(name='Admin', code='ADMIN', has_global_access=False)
        self.admin = User.objects.create_user('it.admin@example.com', 'it.admin@example.com', 'AdminStrongPass123!')
        StaffProfile.objects.create(user=self.admin, role=role_admin, department=self.dep_eng)
        self.root = User.objects.create_superuser('root@example.com', 'root@example.com', 'RootStrongPass123!')
        # self.admin_user (from the base class) is an Executive Director.

    def _patch(self, actor, target, payload):
        self.client.credentials(**self.auth_headers_for(actor))
        return self.client.patch(reverse('users-detail', kwargs={'user_id': target.id}), payload, format='json')

    def test_admin_cannot_manage_a_superuser_or_an_executive(self):
        for target in (self.root, self.admin_user):
            for payload in (
                {'email': 'taken.over@example.com'},
                {'send_reset_link': True},
                {'role_id': str(self.role_staff.id)},
                {'is_active': False},
            ):
                response = self._patch(self.admin, target, payload)
                self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN, (target.username, payload))

            target.refresh_from_db()
            self.assertTrue(target.is_active)
            self.assertNotEqual(target.email, 'taken.over@example.com')

        self.assertEqual(len(mail.outbox), 0)
        self.assertTrue(AuditLog.objects.filter(action='ADMIN_USER_ACTION_DENIED').exists())

    def test_admin_can_manage_ordinary_staff(self):
        response = self._patch(self.admin, self.staff_user, {'first_name': 'Edited'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_superuser_can_manage_an_executive(self):
        response = self._patch(self.root, self.admin_user, {'first_name': 'Edited'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_nobody_changes_their_own_role_or_status(self):
        role_admin_id = str(self.admin.staff_profile.role_id)
        self.assertEqual(self._patch(self.admin, self.admin, {'role_id': str(self.role_md.id)}).status_code, 403)
        self.assertEqual(self._patch(self.admin, self.admin, {'is_active': False}).status_code, 403)
        self.assertEqual(self._patch(self.root, self.root, {'is_active': False}).status_code, 403)

        # Re-sending the current values (as the edit form does) is fine.
        response = self._patch(self.admin, self.admin, {'first_name': 'Same', 'role_id': role_admin_id, 'is_active': True})
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_last_active_superuser_cannot_be_deactivated(self):
        second = User.objects.create_superuser('root2@example.com', 'root2@example.com', 'RootStrongPass123!')

        self.assertEqual(self._patch(self.root, second, {'is_active': False}).status_code, 200)
        second.refresh_from_db()
        self.assertFalse(second.is_active)

        # `second` is inactive now, so `root` is the last one; an inactive
        # superuser cannot act, and no one else may deactivate root.
        self.assertEqual(self._patch(self.admin, self.root, {'is_active': False}).status_code, 403)


class AuditRetentionTests(SecurityTestCase):
    @override_settings(AUDIT_AUTH_FAILURE_RETENTION_DAYS=90)
    def test_only_old_authentication_failures_are_deleted(self):
        old = timezone.now() - timedelta(days=120)
        rows = {
            'old_failure': AuditLog.objects.create(action='AUTH_LOGIN_FAILED'),
            'old_reset_failure': AuditLog.objects.create(action='AUTH_PASSWORD_RESET_FAILED'),
            'old_success': AuditLog.objects.create(action='AUTH_LOGIN_SUCCESS'),
            'new_failure': AuditLog.objects.create(action='AUTH_LOGIN_FAILED'),
        }
        AuditLog.objects.filter(
            pk__in=[rows['old_failure'].pk, rows['old_reset_failure'].pk, rows['old_success'].pk]
        ).update(created_at=old)

        self.assertEqual(prune_auth_failure_audit_logs(), 2)
        remaining = set(AuditLog.objects.values_list('pk', flat=True))
        self.assertEqual(remaining, {rows['old_success'].pk, rows['new_failure'].pk})


class SecretConfigurationTests(SecurityTestCase):
    """Outside debug and tests, the process must not start on the public fallback secrets."""

    def _settings_import(self, **env):
        api_dir = Path(__file__).resolve().parents[2]
        base = {'PATH': '/usr/bin:/bin', 'DJANGO_DEBUG': 'False', 'DJANGO_SECRET_KEY': 'k' * 50, 'DB_PASSWORD': 'p' * 20}
        base.update(env)
        return subprocess.run(
            [sys.executable, '-c', 'import portalapi.settings'],
            cwd=api_dir,
            env={key: value for key, value in base.items() if value is not None},
            capture_output=True,
            text=True,
        )

    def test_settings_refuse_placeholder_secrets_in_production(self):
        # python-dotenv does not override variables that are already set, so an
        # explicit empty value stands in for "not configured" even with a local .env.
        self.assertEqual(self._settings_import().returncode, 0)

        for missing in ({'DJANGO_SECRET_KEY': 'change-me-in-env'}, {'DB_PASSWORD': 'change-this-password'}, {'DB_PASSWORD': ''}):
            result = self._settings_import(**missing)
            self.assertNotEqual(result.returncode, 0, missing)
            self.assertIn('ImproperlyConfigured', result.stderr)

    def test_debug_may_use_the_fallbacks(self):
        result = self._settings_import(DJANGO_DEBUG='True', DJANGO_SECRET_KEY='change-me-in-env')
        self.assertEqual(result.returncode, 0, result.stderr)


class UniqueEmailTests(SecurityTestCase):
    def test_the_database_refuses_a_second_account_with_the_same_email_in_any_case(self):
        from django.db import IntegrityError, transaction

        with self.assertRaises(IntegrityError), transaction.atomic():
            User.objects.create_user('copy', email='STAFF@example.com')

        # Accounts without an email are not affected.
        User.objects.create_user('no-email-1', email='')
        User.objects.create_user('no-email-2', email='')

    def test_changing_an_email_to_one_in_use_is_a_validation_error(self):
        root = User.objects.create_superuser('root@example.com', 'root@example.com', 'RootStrongPass123!')
        self.client.credentials(**self.auth_headers_for(root))
        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}), {'email': 'ADMIN@example.com'}
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('email', response.data['error']['details'])
