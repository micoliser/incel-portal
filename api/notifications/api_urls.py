from django.urls import path

from notifications.views_api import NotificationViewSet, PushSubscriptionViewSet

# Explicit paths keep the route names and typed ids the portal and tests use.
notifications = NotificationViewSet.as_view
subscriptions = PushSubscriptionViewSet.as_view

urlpatterns = [
    path('notifications', notifications({'get': 'list'}), name='notifications-list'),
    path('notifications/unread-count', notifications({'get': 'unread_count'}), name='notifications-unread-count'),
    path('notifications/<uuid:notification_id>/read', notifications({'post': 'mark_read'}), name='notifications-mark-read'),
    path('notifications/<uuid:notification_id>', notifications({'delete': 'destroy'}), name='notifications-delete'),
    path('notifications/read-all', notifications({'post': 'read_all'}), name='notifications-read-all'),
    path('notifications/clear-all', notifications({'delete': 'clear_all'}), name='notifications-clear-all'),
    path('notifications/push-public-key', notifications({'get': 'push_public_key'}), name='notifications-push-public-key'),
    path('notifications/subscriptions', subscriptions({'get': 'list', 'post': 'create'}), name='notifications-subscriptions'),
    path(
        'notifications/subscriptions/<uuid:subscription_id>',
        subscriptions({'delete': 'destroy'}),
        name='notifications-subscription-delete',
    ),
]
