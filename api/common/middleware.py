from datetime import timedelta

from django.conf import settings
from django.http import HttpResponseForbidden
from django.utils import timezone


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
            # Never raise from middleware for best-effort update
            pass

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

            client_ip = request.META.get('REMOTE_ADDR')
            x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
            
            if x_forwarded_for:
                # The rightmost IP is appended by the proxy connecting to Django,
                # making it much harder to spoof than the leftmost IP.
                client_ip = x_forwarded_for.split(',')[-1].strip()

            allowed_ips = getattr(settings, 'ADMIN_ALLOWED_IPS', ['127.0.0.1'])
            
            if client_ip not in allowed_ips:
                return HttpResponseForbidden("Forbidden: Your IP is not allowed to access this area.")

        return self.get_response(request)

class CSPMiddleware:
    """Adds a Content-Security-Policy header to every response."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        csp = (
            "default-src 'none'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https://*; "
            "font-src 'self'; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "base-uri 'none'; "
            "form-action 'self';"
        )
        if 'Content-Security-Policy' not in response:
            response['Content-Security-Policy'] = csp
        return response
