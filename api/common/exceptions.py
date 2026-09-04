from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.views import exception_handler


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)
    if response is None:
        return response

    if isinstance(exc, ValidationError):
        response.data = {
            'error': {
                'type': 'validation_error',
                'message': 'Validation failed.',
                'details': response.data,
            }
        }
        return response

    metadata = {}
    if isinstance(response.data, dict):
        detail = response.data.get('detail', 'Request failed.')
        metadata = {k: v for k, v in response.data.items() if k != 'detail'}
    else:
        detail = str(response.data) if response.data else 'Request failed.'

    error_type = 'api_error'
    if response.status_code == status.HTTP_401_UNAUTHORIZED:
        error_type = 'authentication_error'
    elif response.status_code == status.HTTP_403_FORBIDDEN:
        error_type = 'authorization_error'
    elif response.status_code == status.HTTP_404_NOT_FOUND:
        error_type = 'not_found'
    elif response.status_code == status.HTTP_429_TOO_MANY_REQUESTS:
        error_type = 'rate_limited'
        detail = str(detail).replace("Request was throttled.", "Request was rate limited.")
        
        request = context.get('request')
        if request and request.path.endswith('/login') and request.method == 'POST':
            email = request.data.get('email', '')
            if isinstance(email, str) and email:
                from django.core.cache import cache
                if cache.get(f"login_lockout_{email.strip().lower()}"):
                    detail = 'Account is temporarily locked due to multiple failed login attempts. Please try again in 15 minutes.'

    response.data = {
        'error': {
            'type': error_type,
            'message': str(detail),
        }
    }
    
    if metadata:
        response.data['error']['metadata'] = metadata

    return response
