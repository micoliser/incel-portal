import hashlib

from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.permissions import BasePermission
from rest_framework_simplejwt.authentication import JWTAuthentication

from accounts.models import ServiceApiKey


class CookieJWTAuthentication(JWTAuthentication):
    def authenticate(self, request):
        # Fallback to the default header-based authentication for clients not using cookies
        header = self.get_header(request)
        if header is not None:
            return super().authenticate(request)

        # Check for access_token cookie
        raw_token = request.COOKIES.get('access_token') or None
        if raw_token is None:
            return None

        validated_token = self.get_validated_token(raw_token)
        return self.get_user(validated_token), validated_token


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

        # Update last_used_at timestamp
        ServiceApiKey.objects.filter(id=api_key.id).update(last_used_at=timezone.now())

        return (api_key, raw_token)

    def authenticate_header(self, request):
        return f'{self.keyword} realm="api"'


class HasValidServiceApiKey(BasePermission):
    """
    Permission check ensuring the request was authenticated with a valid ServiceApiKey.
    """
    def has_permission(self, request, view):
        return (
            isinstance(request.user, ServiceApiKey)
            and request.user.is_active
            and not request.user.is_expired()
        )
