import logging
from datetime import timedelta

from django.conf import settings
from django.http import HttpResponseForbidden
from django.utils import timezone

from common.network import client_ip

logger = logging.getLogger(__name__)


class LastActivityMiddleware:
    """Update `staff_profile.last_activity_at` for authenticated users.

    To avoid writing on every single request, the middleware only updates the
    timestamp if the previous value is older than 60 seconds.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        try:
            user = getattr(request, 'user', None)
            if user and user.is_authenticated:
                profile = getattr(user, 'staff_profile', None)
                if profile is not None:
                    now = timezone.now()
                    last = profile.last_activity_at
                    if (last is None) or (now - last > timedelta(seconds=60)):
                        profile.last_activity_at = now
                        profile.save(update_fields=['last_activity_at'])
        except Exception:
            # A best-effort update must never break the response, but a
            # failure here is still worth seeing.
            logger.exception('Could not record last activity')

        return response


class AdminIPAllowlistMiddleware:
    """Restricts access to /admin/ paths based on allowed IPs in settings."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if request.path.startswith('/admin/'):
            # Bypass if DEBUG is True to ensure local dev is unaffected
            if getattr(settings, 'DEBUG', False):
                return self.get_response(request)

            if client_ip(request) not in settings.ADMIN_ALLOWED_IPS:
                return HttpResponseForbidden("Forbidden: Your IP is not allowed to access this area.")

        return self.get_response(request)

class CSPMiddleware:
    """Adds a Content-Security-Policy header to every response.

    The API returns JSON, which a browser never needs to run or style, so
    everything is refused. Django admin is real HTML and needs its own
    scripts, inline styles and images, so it gets a policy that allows them
    (and, unlike before, still no scripts from other sites).
    """

    API_POLICY = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
    ADMIN_POLICY = (
        "default-src 'none'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self'; "
        "connect-src 'self'; "
        "frame-ancestors 'none'; "
        "base-uri 'none'; "
        "form-action 'self'"
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        if 'Content-Security-Policy' not in response:
            is_admin = request.path.startswith('/admin/') or request.path.startswith('/static/')
            response['Content-Security-Policy'] = self.ADMIN_POLICY if is_admin else self.API_POLICY
        return response
