from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from common.pagination import page_size, paginate
from common.viewsets import GenericViewSet
from notifications.models import Notification, PushSubscription
from notifications.serializers import (
    NotificationSerializer,
    PushSubscriptionInputSerializer,
    PushSubscriptionSerializer,
)

NotificationPagination = page_size(20, maximum=50)


class NotificationViewSet(GenericViewSet):
    """The signed-in user's notifications. Wired in `api_urls.py`."""

    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        queryset = Notification.objects.filter(recipient=request.user).order_by('-created_at')

        return paginate(queryset, request, NotificationSerializer, pagination_class=NotificationPagination, view=self)

    def unread_count(self, request):
        unread_count = Notification.objects.filter(recipient=request.user, is_read=False).count()
        return Response({'unread_count': unread_count})

    def mark_read(self, request, notification_id):
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

    def read_all(self, request):
        now = timezone.now()
        updated = Notification.objects.filter(recipient=request.user, is_read=False).update(
            is_read=True,
            read_at=now,
        )
        return Response({'count': updated})

    def destroy(self, request, notification_id):
        deleted, _details = Notification.objects.filter(
            id=notification_id,
            recipient=request.user,
        ).delete()
        if deleted == 0:
            raise NotFound('Notification not found.')
        return Response(status=status.HTTP_204_NO_CONTENT)

    def clear_all(self, request):
        deleted, _details = Notification.objects.filter(recipient=request.user).delete()
        return Response({'count': deleted})

    def push_public_key(self, _request):
        public_key = getattr(settings, 'WEB_PUSH_VAPID_PUBLIC_KEY', '')
        return Response({'public_key': public_key, 'enabled': bool(public_key)})


class PushSubscriptionViewSet(GenericViewSet):
    """The signed-in user's browser push subscriptions. Wired in `api_urls.py`."""

    permission_classes = [permissions.IsAuthenticated]

    def list(self, request):
        subscriptions = PushSubscription.objects.filter(user=request.user).order_by('-updated_at')
        return Response(PushSubscriptionSerializer(subscriptions, many=True).data)

    def create(self, request):
        serializer = PushSubscriptionInputSerializer(data=request.data)
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

    def destroy(self, request, subscription_id):
        subscription = PushSubscription.objects.filter(
            id=subscription_id,
            user=request.user,
        ).first()
        if not subscription:
            raise NotFound('Subscription not found.')

        subscription.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
