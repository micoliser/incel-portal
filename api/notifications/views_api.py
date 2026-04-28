from django.conf import settings
from django.core.paginator import Paginator
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from notifications.models import Notification, PushSubscription
from notifications.serializers import (
    NotificationSerializer,
    PushSubscriptionSerializer,
    PushSubscriptionWriteSerializer,
)


class NotificationListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        queryset = Notification.objects.filter(recipient=request.user).order_by('-created_at')

        page = request.query_params.get('page', '1')
        page_size = request.query_params.get('page_size', '20')

        try:
            page_number = max(int(page), 1)
        except (TypeError, ValueError):
            page_number = 1

        try:
            per_page = min(max(int(page_size), 1), 50)
        except (TypeError, ValueError):
            per_page = 20

        paginator = Paginator(queryset, per_page)
        page_obj = paginator.get_page(page_number)

        return Response(
            {
                'count': paginator.count,
                'page': page_obj.number,
                'page_size': per_page,
                'total_pages': paginator.num_pages,
                'next_page': page_obj.next_page_number() if page_obj.has_next() else None,
                'previous_page': page_obj.previous_page_number() if page_obj.has_previous() else None,
                'results': NotificationSerializer(page_obj.object_list, many=True).data,
            }
        )


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
            return Response({'detail': 'Notification not found.'}, status=status.HTTP_404_NOT_FOUND)

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
        return Response({'updated': updated})


class NotificationDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, notification_id):
        deleted, _details = Notification.objects.filter(
            id=notification_id,
            recipient=request.user,
        ).delete()
        if deleted == 0:
            return Response({'detail': 'Notification not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(status=status.HTTP_204_NO_CONTENT)


class NotificationClearAllView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request):
        deleted, _details = Notification.objects.filter(recipient=request.user).delete()
        return Response({'deleted': deleted})


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
        subscription_data = raw.get('subscription', raw)
        keys = subscription_data.get('keys', {})

        payload = {
            'endpoint': subscription_data.get('endpoint', ''),
            'p256dh': keys.get('p256dh', raw.get('p256dh', '')),
            'auth': keys.get('auth', raw.get('auth', '')),
            'user_agent': raw.get('user_agent', ''),
        }

        serializer = PushSubscriptionWriteSerializer(data=payload)
        serializer.is_valid(raise_exception=True)

        subscription, _created = PushSubscription.objects.update_or_create(
            user=request.user,
            endpoint=serializer.validated_data['endpoint'],
            defaults={
                'p256dh': serializer.validated_data['p256dh'],
                'auth': serializer.validated_data['auth'],
                'user_agent': serializer.validated_data.get('user_agent', ''),
                'is_active': True,
            },
        )

        return Response(
            PushSubscriptionSerializer(subscription).data,
            status=status.HTTP_201_CREATED,
        )


class PushSubscriptionDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, subscription_id):
        subscription = PushSubscription.objects.filter(
            id=subscription_id,
            user=request.user,
        ).first()
        if not subscription:
            return Response({'detail': 'Subscription not found.'}, status=status.HTTP_404_NOT_FOUND)

        subscription.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
