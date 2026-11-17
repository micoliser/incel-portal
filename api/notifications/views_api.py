from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from common.pagination import page_size, paginate
from notifications.models import Notification, PushSubscription
from notifications.serializers import (
    NotificationSerializer,
    PushSubscriptionSerializer,
    PushSubscriptionWriteSerializer,
)

NotificationPagination = page_size(20, maximum=50)


class NotificationListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        queryset = Notification.objects.filter(recipient=request.user).order_by('-created_at')

        return paginate(queryset, request, NotificationSerializer, pagination_class=NotificationPagination, view=self)


class NotificationUnreadCountView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        unread_count = Notification.objects.filter(recipient=request.user, is_read=False).count()
        return Response({'unread_count': unread_count})


class NotificationMarkReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, notification_id):
        notification = Notification.objects.filter(
            id=notification_id,
            recipient=request.user,
        ).first()
        if not notification:
            raise NotFound('Notification not found.')

        if not notification.is_read:
            notification.is_read = True
            notification.read_at = timezone.now()
            notification.save(update_fields=['is_read', 'read_at'])

        return Response(NotificationSerializer(notification).data)


class NotificationMarkAllReadView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        now = timezone.now()
        updated = Notification.objects.filter(recipient=request.user, is_read=False).update(
            is_read=True,
            read_at=now,
        )
        return Response({'count': updated})


class NotificationDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, notification_id):
        deleted, _details = Notification.objects.filter(
            id=notification_id,
            recipient=request.user,
        ).delete()
        if deleted == 0:
            raise NotFound('Notification not found.')
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationClearAllView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request):
        deleted, _details = Notification.objects.filter(recipient=request.user).delete()
        return Response({'count': deleted})


class PushPublicKeyView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, _request):
        public_key = getattr(settings, 'WEB_PUSH_VAPID_PUBLIC_KEY', '')
        return Response({'public_key': public_key, 'enabled': bool(public_key)})


class PushSubscriptionListCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        subscriptions = PushSubscription.objects.filter(user=request.user).order_by('-updated_at')
        return Response(PushSubscriptionSerializer(subscriptions, many=True).data)

    def post(self, request):
        raw = request.data
        if not isinstance(raw, dict):
            raise ValidationError('Expected a subscription object.')
        subscription_data = raw.get('subscription', raw)
        if not isinstance(subscription_data, dict):
            raise ValidationError({'subscription': 'Expected an object.'})
        keys = subscription_data.get('keys', {})
        if not isinstance(keys, dict):
            raise ValidationError({'keys': 'Expected an object.'})

        payload = {
            'endpoint': subscription_data.get('endpoint', ''),
            'p256dh': keys.get('p256dh', raw.get('p256dh', '')),
            'auth': keys.get('auth', raw.get('auth', '')),
            'user_agent': raw.get('user_agent', ''),
        }

        serializer = PushSubscriptionWriteSerializer(data=payload)
        serializer.is_valid(raise_exception=True)

        endpoint = serializer.validated_data['endpoint']
        with transaction.atomic():
            subscriptions = list(
                PushSubscription.objects.select_for_update()
                .filter(endpoint=endpoint)
                .order_by('-updated_at', '-id')
            )

            created = not subscriptions
            if subscriptions:
                subscription = subscriptions[0]
                if len(subscriptions) > 1:
                    PushSubscription.objects.filter(
                        id__in=[item.id for item in subscriptions[1:]],
                    ).delete()
            else:
                subscription = PushSubscription(endpoint=endpoint)

            subscription.user = request.user
            subscription.p256dh = serializer.validated_data['p256dh']
            subscription.auth = serializer.validated_data['auth']
            subscription.user_agent = serializer.validated_data.get('user_agent', '')
            subscription.is_active = True
            subscription.save()

        return Response(
            PushSubscriptionSerializer(subscription).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class PushSubscriptionDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, subscription_id):
        subscription = PushSubscription.objects.filter(
            id=subscription_id,
            user=request.user,
        ).first()
        if not subscription:
            raise NotFound('Subscription not found.')

        subscription.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
