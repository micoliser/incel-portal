from django.contrib import admin

from notifications.models import Notification, PushSubscription


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ['recipient', 'notification_type', 'title', 'is_read', 'created_at']
    list_filter = ['notification_type', 'is_read', 'created_at']
    search_fields = ['recipient__username', 'title', 'body']
    readonly_fields = ['created_at', 'read_at']


@admin.register(PushSubscription)
class PushSubscriptionAdmin(admin.ModelAdmin):
    list_display = ['user', 'is_active', 'updated_at', 'created_at']
    list_filter = ['is_active', 'created_at', 'updated_at']
    search_fields = ['user__username', 'endpoint']
    readonly_fields = ['created_at', 'updated_at']
