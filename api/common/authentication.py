import hashlib
from datetime import timedelta
from urllib.parse import urlsplit

from django.conf import settings
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed, PermissionDenied
from rest_framework.permissions import BasePermission
from rest_framework_simplejwt.authentication import JWTAuthentication

from accounts.models import ServiceApiKey

SAFE_METHODS = ('GET', 'HEAD', 'OPTIONS')


def _origin_of(url):
    parts = urlsplit(url)
    if not parts.scheme or not parts.netloc:
        return None
    return f'{parts.scheme}://{parts.netloc}'


class CookieJWTAuthentication(JWTAuthentication):
    """JWT from the Authorization header, or from the HttpOnly cookie set at sign-in.

    A browser attaches cookies to requests made by any site, so a request that
    is authenticated by cookie and changes something must come from the portal.
    Browsers state the calling site in the Origin header and a page cannot
    forge it; a request from anywhere else is refused. Requests authenticated
    by the Authorization header are not affected, because no browser adds that
    header on a site's behalf.
    """

    def authenticate(self, request):
        header = self.get_header(request)
        if header is not None:
            return super().authenticate(request)

        raw_token = request.COOKIES.get('access_token') or None
        if raw_token is None:
            return None

        validated_token = self.get_validated_token(raw_token)
        user = self.get_user(validated_token)
        self._enforce_same_site(request)
        return user, validated_token

    @staticmethod
    def _enforce_same_site(request):
        if request.method in SAFE_METHODS:
            return

        origin = request.META.get('HTTP_ORIGIN')
        if origin is None:
            referer = request.META.get('HTTP_REFERER')
            if referer is None:
                # Neither header: not a browser page (browsers always send
                # Origin with cross-site writes), so there is no site to forge from.
                return
            origin = _origin_of(referer)

        if origin not in settings.CORS_ALLOWED_ORIGINS:
            raise PermissionDenied('This request did not come from the portal.')


class PublicEndpointAuthentication(BaseAuthentication):
    """For endpoints used by people who are not signed in (sign-in, token refresh,
    password recovery).

    It never authenticates anyone, so a stale or expired token sent along with
    the request is ignored instead of being rejected before the view runs. It
    still declares a challenge header: without one, DRF would report a failed
    sign-in as 403 instead of 401.
    """

    def authenticate(self, request):
        return None

    def authenticate_header(self, request):
        return 'Bearer realm="api"'


class ServiceApiKeyAuthentication(BaseAuthentication):
    """
    Standard Bearer token authentication against the ServiceApiKey model.
    Expected header:
        Authorization: Bearer <service_token>
    """
    keyword = 'Bearer'

    def authenticate(self, request):
        auth = get_authorization_header(request).split()

        if not auth:
            return None

        if auth[0].lower() != self.keyword.lower().encode():
            return None

        if len(auth) == 1:
            raise AuthenticationFailed('Invalid Authorization header. No token provided.')
        elif len(auth) > 2:
            raise AuthenticationFailed('Invalid Authorization header. Token string should not contain spaces.')

        try:
            raw_token = auth[1].decode('utf-8')
        except UnicodeError:
            raise AuthenticationFailed('Invalid Authorization header. Token contains invalid characters.')

        hashed = hashlib.sha256(raw_token.encode('utf-8')).hexdigest()

        try:
            api_key = ServiceApiKey.objects.get(hashed_key=hashed, is_active=True)
        except ServiceApiKey.DoesNotExist:
            raise AuthenticationFailed('Invalid or revoked service API key.')

        if api_key.is_expired():
            raise AuthenticationFailed('Service API key has expired.')

        # Record use at most once a minute, not on every request.
        now = timezone.now()
        if api_key.last_used_at is None or now - api_key.last_used_at > timedelta(minutes=1):
            ServiceApiKey.objects.filter(id=api_key.id).update(last_used_at=now)

        return (api_key, raw_token)

    def authenticate_header(self, request):
        return f'{self.keyword} realm="api"'


class HasValidServiceApiKey(BasePermission):
    """The request carries a valid service API key holding the view's
    `required_scope`. A view that sets no scope accepts no key."""

    message = 'This API key does not have access to this endpoint.'

    def has_permission(self, request, view):
        required_scope = getattr(view, 'required_scope', None)
        return bool(
            isinstance(request.user, ServiceApiKey)
            and request.user.is_active
            and not request.user.is_expired()
            and required_scope
            and request.user.has_scope(required_scope)
        )
