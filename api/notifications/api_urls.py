from django.urls import path

from notifications import views_api

urlpatterns = [
    path('notifications', views_api.NotificationListView.as_view(), name='notifications-list'),
    path('notifications/unread-count', views_api.NotificationUnreadCountView.as_view(), name='notifications-unread-count'),
    path('notifications/<int:notification_id>/read', views_api.NotificationMarkReadView.as_view(), name='notifications-mark-read'),
    path('notifications/<int:notification_id>', views_api.NotificationDeleteView.as_view(), name='notifications-delete'),
    path('notifications/read-all', views_api.NotificationMarkAllReadView.as_view(), name='notifications-read-all'),
    path('notifications/clear-all', views_api.NotificationClearAllView.as_view(), name='notifications-clear-all'),
    path('notifications/push-public-key', views_api.PushPublicKeyView.as_view(), name='notifications-push-public-key'),
    path('notifications/subscriptions', views_api.PushSubscriptionListCreateView.as_view(), name='notifications-subscriptions'),
    path('notifications/subscriptions/<int:subscription_id>', views_api.PushSubscriptionDeleteView.as_view(), name='notifications-subscription-delete'),
]
