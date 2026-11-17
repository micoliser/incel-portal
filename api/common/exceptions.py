from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.views import exception_handler


class AccountLocked(APIException):
    """Too many failed sign-ins. Distinct from rate limiting (429): the caller
    may retry other requests, but not this account until the lock expires."""

    status_code = status.HTTP_403_FORBIDDEN
    default_detail = 'Account is temporarily locked due to multiple failed login attempts. Please try again in 15 minutes.'
    default_code = 'account_locked'
    error_type = 'account_locked'

    def __init__(self, wait=None):
        super().__init__()
        # DRF's handler turns `wait` into a Retry-After header.
        self.wait = wait


class Conflict(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_detail = 'The request conflicts with the current state of the resource.'
    default_code = 'conflict'
    error_type = 'conflict'


class ServiceUnavailable(APIException):
    status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    default_detail = 'A service this request depends on is unavailable. Please try again.'
    default_code = 'service_unavailable'
    error_type = 'service_unavailable'


class BadGateway(APIException):
    status_code = status.HTTP_502_BAD_GATEWAY
    default_detail = 'A service this request depends on returned an error. Please try again.'
    default_code = 'bad_gateway'
    error_type = 'bad_gateway'


class Gone(APIException):
    status_code = status.HTTP_410_GONE
    default_detail = 'This resource is no longer available.'
    default_code = 'gone'
    error_type = 'gone'


def custom_exception_handler(exc, context):
    # Django's own ValidationError (raised by services, model validation, or the
    # ORM when a value such as a UUID or date is malformed) means bad input. DRF
    # does not know it, so without this it would surface as a 500.
    if isinstance(exc, DjangoValidationError):
        exc = ValidationError(exc.message_dict if hasattr(exc, 'error_dict') else exc.messages)

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

    error_type = getattr(exc, 'error_type', error_type)

    response.data = {
        'error': {
            'type': error_type,
            'message': str(detail),
        }
    }
    
    if metadata:
        response.data['error']['metadata'] = metadata

    return response
