import json

from applications.models import AuditLog


def _client_ip(request):
    if request is None:
        return None

    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.META.get('REMOTE_ADDR')


def log_audit(*, action, request=None, actor_user=None, target_type='', target_id='', metadata=None):
    if actor_user is None and request is not None and getattr(request, 'user', None):
        if request.user.is_authenticated:
            actor_user = request.user

    metadata_json = metadata or {}
    if metadata_json:
        def _stringify(value):
            if isinstance(value, dict):
                return {k: _stringify(v) for k, v in value.items()}
            if isinstance(value, list):
                return [_stringify(v) for v in value]
            return str(value)

        metadata_json = _stringify(metadata_json)

    AuditLog.objects.create(
        actor_user=actor_user,
        action=action,
        target_type=target_type,
        target_id=str(target_id) if target_id else '',
        metadata_json=metadata_json,
        ip_address=_client_ip(request),
    )
