from rest_framework_simplejwt.authentication import JWTAuthentication

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
