from datetime import timedelta

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
