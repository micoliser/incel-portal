from rest_framework import serializers

from notifications.models import Notification, PushSubscription


class NotificationSerializer(serializers.ModelSerializer):
    actor_username = serializers.SerializerMethodField()

    class Meta:
        model = Notification
        fields = [
            'id',
            'notification_type',
            'title',
            'body',
            'link_url',
            'payload_json',
            'is_read',
            'read_at',
            'created_at',
            'actor_username',
        ]

    def get_actor_username(self, obj):
        if not obj.actor:
            return None
        return obj.actor.username


class PushSubscriptionWriteSerializer(serializers.Serializer):
    endpoint = serializers.CharField()
    p256dh = serializers.CharField()
    auth = serializers.CharField()
    user_agent = serializers.CharField(required=False, allow_blank=True)


class PushSubscriptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PushSubscription
        fields = ['id', 'endpoint', 'is_active', 'created_at', 'updated_at']
