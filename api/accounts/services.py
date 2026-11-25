"""Account security helpers: session revocation, password links and sign-in protection."""

import hashlib
import logging
import time

from django.conf import settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.contrib.auth.tokens import PasswordResetTokenGenerator, default_token_generator
from django.core.cache import cache
from django.utils.crypto import constant_time_compare
from django.utils.encoding import force_bytes, force_str
from django.utils.http import base36_to_int, urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from emails.services.user_emails import UserEmailManager

User = get_user_model()

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

def revoke_user_sessions(user):
    """Invalidate every refresh token issued to the user.

    Call this whenever a credential stops being trustworthy: password change,
    password reset, deactivation. Access tokens already issued stay valid until
    they expire (minutes); nothing can be refreshed after this.
    """
    tokens = OutstandingToken.objects.filter(user=user).exclude(blacklistedtoken__isnull=False)
    BlacklistedToken.objects.bulk_create(
        [BlacklistedToken(token=token) for token in tokens],
        ignore_conflicts=True,
    )


# ---------------------------------------------------------------------------
# Password links
# ---------------------------------------------------------------------------

class AccountSetupTokenGenerator(PasswordResetTokenGenerator):
    """Tokens for links an administrator sends (new account, admin-requested reset).

    Identical to Django's reset tokens, including becoming invalid once the
    password changes, but valid for ACCOUNT_SETUP_LINK_TIMEOUT instead of
    PASSWORD_RESET_TIMEOUT, because the recipient is not waiting for the email.
    """

    key_salt = 'accounts.services.AccountSetupTokenGenerator'

    def check_token(self, user, token):
        if not (user and token):
            return False
        try:
            ts_b36, _ = token.split('-')
            ts = base36_to_int(ts_b36)
        except ValueError:
            return False

        for secret in [self.secret, *self.secret_fallbacks]:
            if constant_time_compare(self._make_token_with_timestamp(user, ts, secret), token):
                break
        else:
            return False

        return (self._num_seconds(self._now()) - ts) <= settings.ACCOUNT_SETUP_LINK_TIMEOUT


account_setup_token_generator = AccountSetupTokenGenerator()


def password_link(user, generator):
    uid = urlsafe_base64_encode(force_bytes(user.pk))
    token = generator.make_token(user)
    return f"{settings.PORTAL_BASE_URL}/reset-password?uid={uid}&token={token}"


def user_for_password_link(raw_uid, token):
    """The active user a password link belongs to, or None if the link is not valid."""
    try:
        user = User.objects.get(pk=force_str(urlsafe_base64_decode(raw_uid)))
    except (TypeError, ValueError, OverflowError, User.DoesNotExist):
        return None

    if not user.is_active or not isinstance(token, str):
        return None
    if default_token_generator.check_token(user, token) or account_setup_token_generator.check_token(user, token):
        return user
    return None


def _setup_link_hours():
    return max(1, settings.ACCOUNT_SETUP_LINK_TIMEOUT // 3600)


def send_account_setup_link(user):
    """Email a new user the link with which they choose their own password."""
    UserEmailManager.send_user_created_email(
        user,
        setup_url=password_link(user, account_setup_token_generator),
        expiry_hours=_setup_link_hours(),
    )


def send_admin_password_reset_link(user):
    """Email a user a reset link at an administrator's request."""
    UserEmailManager.send_password_reset_email(
        user=user,
        reset_url=password_link(user, account_setup_token_generator),
        expiry_minutes=settings.ACCOUNT_SETUP_LINK_TIMEOUT // 60,
    )


def send_self_service_reset_link(user):
    """Email a reset link the user asked for. Returns False when the account has
    already been sent as many as it may receive this hour."""
    key = f'pwreset_sent:{user.pk}'
    sent = cache.get(key, 0)
    if sent >= settings.PASSWORD_RESET_EMAILS_PER_HOUR:
        return False
    cache.set(key, sent + 1, 3600)

    UserEmailManager.send_password_reset_email(
        user=user,
        reset_url=password_link(user, default_token_generator),
        expiry_minutes=settings.PASSWORD_RESET_TIMEOUT // 60,
    )
    return True


# ---------------------------------------------------------------------------
# Sign-in protection
# ---------------------------------------------------------------------------

def burn_password_check(password):
    """Spend as long as a real password check, so a response for an email with
    no account takes the same time as one for a wrong password."""
    make_password(password)


class LoginGuard:
    """Counts wrong passwords for one email from one client address.

    The pair is locked out after LOGIN_MAX_ATTEMPTS failures. Failures from
    every address also count towards a higher per-account ceiling. Sign-in and
    every password check made by a signed-in user (chat, changing the
    password) share these counters, so guesses cannot be spread across them.
    """

    def __init__(self, email, ip):
        digest = hashlib.sha256(email.strip().lower().encode('utf-8')).hexdigest()[:32]
        pair = f'{digest}:{ip or "unknown"}'
        self._fails_key = f'login_fails:{pair}'
        self._lock_key = f'login_lock:{pair}'
        self._account_key = f'login_account_fails:{digest}'
        self._account_until_key = f'login_account_until:{digest}'

    @staticmethod
    def _left(until, fallback):
        # Locks written before the expiry time was stored hold True.
        if until is True or not isinstance(until, (int, float)):
            return fallback
        return max(0, int(until - time.time() + 0.999))

    def seconds_left(self):
        """How long until this pair may try again; 0 when not locked."""
        left = 0
        until = cache.get(self._lock_key)
        if until:
            left = self._left(until, settings.LOGIN_LOCKOUT_SECONDS)
        if cache.get(self._account_key, 0) >= settings.LOGIN_ACCOUNT_MAX_ATTEMPTS_PER_HOUR:
            left = max(left, self._left(cache.get(self._account_until_key), 3600))
        return left

    def is_locked(self):
        return self.seconds_left() > 0

    def record_failure(self):
        """Record a failure and return how many attempts are left before lockout."""
        now = time.time()
        account_fails = cache.get(self._account_key, 0) + 1
        cache.set(self._account_key, account_fails, 3600)
        cache.set(self._account_until_key, now + 3600, 3600)

        fails = cache.get(self._fails_key, 0) + 1
        if fails >= settings.LOGIN_MAX_ATTEMPTS:
            cache.set(self._lock_key, now + settings.LOGIN_LOCKOUT_SECONDS, settings.LOGIN_LOCKOUT_SECONDS)
            cache.delete(self._fails_key)
            return 0
        if account_fails >= settings.LOGIN_ACCOUNT_MAX_ATTEMPTS_PER_HOUR:
            return 0

        cache.set(self._fails_key, fails, settings.LOGIN_LOCKOUT_SECONDS)
        return settings.LOGIN_MAX_ATTEMPTS - fails

    def record_success(self):
        cache.delete(self._fails_key)


def check_signed_in_password(request, password, *, audit_action, where):
    """Check a signed-in user's portal password under the sign-in lockout.

    Returns None when the password is right, otherwise how many tries are left.
    Raises AccountLocked while locked, including straight after the try that
    used up the last attempt, so the portal can count down at once.
    """
    from audit import log_audit
    from common.exceptions import AccountLocked
    from common.network import client_ip

    user = request.user
    guard = LoginGuard(user.email, client_ip(request))
    if guard.is_locked():
        raise AccountLocked(wait=guard.seconds_left())
    if user.check_password(password):
        guard.record_success()
        return None
    log_audit(
        action=audit_action,
        request=request,
        actor_user=user,
        target_type='User',
        target_id=user.id,
        metadata={'where': where},
    )
    left = guard.record_failure()
    if left <= 0:
        raise AccountLocked(wait=guard.seconds_left())
    return left


def tries_left_text(left):
    return f'{left} {"try" if left == 1 else "tries"} left before a lockout.'


def should_log_unknown_login(email, ip):
    """Limit audit rows for sign-in attempts against emails with no account to
    one per email and address every ten minutes, so the audit log cannot be
    filled by guessing."""
    digest = hashlib.sha256(f'{email}|{ip}'.encode('utf-8')).hexdigest()[:32]
    return cache.add(f'login_unknown_logged:{digest}', True, 600)
