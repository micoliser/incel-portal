from urllib.parse import urlsplit

from django.conf import settings
from rest_framework import serializers
from rest_framework.settings import api_settings

from notifications.models import Notification, PushSubscription


class NotificationSerializer(serializers.ModelSerializer):
    actor_username = serializers.SerializerMethodField()
    payload = serializers.JSONField(source='payload_json', read_only=True)

    class Meta:
        model = Notification
        fields = [
            'id',
            'notification_type',
            'title',
            'body',
            'link_url',
            'payload',
            'is_read',
            'read_at',
            'created_at',
            'actor_username',
        ]

    def get_actor_username(self, obj):
        if not obj.actor:
            return None
        return obj.actor.username


def is_allowed_push_endpoint(endpoint: str) -> bool:
    """A push endpoint must be an https URL on a known browser push service,
    with no credentials and no explicit port."""
    try:
        parts = urlsplit(str(endpoint).strip())
        port = parts.port
    except ValueError:
        return False
    if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password or port:
        return False

    host = parts.hostname.lower()
    for allowed in settings.WEB_PUSH_ALLOWED_HOSTS:
        if allowed.startswith('.'):
            if host.endswith(allowed):
                return True
        elif host == allowed:
            return True
    return False


class PushSubscriptionWriteSerializer(serializers.Serializer):
    endpoint = serializers.CharField(max_length=2000)
    p256dh = serializers.CharField(max_length=512)
    auth = serializers.CharField(max_length=512)
    user_agent = serializers.CharField(required=False, allow_blank=True, max_length=512)

    def validate_endpoint(self, value):
        value = value.strip()
        if not is_allowed_push_endpoint(value):
            raise serializers.ValidationError('This is not a recognised browser push service.')
        return value


class PushSubscriptionInputSerializer(PushSubscriptionWriteSerializer):
    """A browser's push subscription, in either shape the portal may send.

    `{"subscription": {"endpoint", "keys": {"p256dh", "auth"}}, "user_agent"}`
    (what `PushSubscription.toJSON()` gives, wrapped) or the same object
    unwrapped, with the keys either under `keys` or at the top level.
    """

    def to_internal_value(self, data):
        if not isinstance(data, dict):
            raise serializers.ValidationError({api_settings.NON_FIELD_ERRORS_KEY: ['Expected a subscription object.']})
        subscription = data.get('subscription', data)
        if not isinstance(subscription, dict):
            raise serializers.ValidationError({'subscription': 'Expected an object.'})
        keys = subscription.get('keys', {})
        if not isinstance(keys, dict):
            raise serializers.ValidationError({'keys': 'Expected an object.'})
        return super().to_internal_value({
            'endpoint': subscription.get('endpoint', ''),
            'p256dh': keys.get('p256dh', data.get('p256dh', '')),
            'auth': keys.get('auth', data.get('auth', '')),
            'user_agent': data.get('user_agent', ''),
        })


class PushSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushSubscription
        fields = ['id', 'endpoint', 'is_active', 'created_at', 'updated_at']
