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

    detail = response.data.get('detail', 'Request failed.') if isinstance(response.data, dict) else 'Request failed.'

    error_type = 'api_error'
    if response.status_code == status.HTTP_401_UNAUTHORIZED:
        error_type = 'authentication_error'
    elif response.status_code == status.HTTP_403_FORBIDDEN:
        error_type = 'authorization_error'
    elif response.status_code == status.HTTP_404_NOT_FOUND:
        error_type = 'not_found'

    response.data = {
        'error': {
            'type': error_type,
            'message': str(detail),
        }
    }
    return response
