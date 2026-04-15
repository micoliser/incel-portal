from django.contrib import admin

from .models import ApplicationAccessOverride, AuditLog, InternalApplication


@admin.register(InternalApplication)
class InternalApplicationAdmin(admin.ModelAdmin):
    list_display = ('name', 'slug', 'status', 'access_scope', 'visibility_scope', 'updated_at')
    list_filter = ('status', 'access_scope', 'visibility_scope')
    search_fields = ('name', 'slug', 'description', 'app_url')
    filter_horizontal = ('departments',)
    prepopulated_fields = {'slug': ('name',)}


@admin.register(ApplicationAccessOverride)
class ApplicationAccessOverrideAdmin(admin.ModelAdmin):
    list_display = ('application', 'user', 'effect', 'expires_at', 'updated_at')
    list_filter = ('effect',)
    search_fields = ('application__name', 'user__username', 'user__email')


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ('action', 'actor_user', 'target_type', 'target_id', 'ip_address', 'created_at')
    list_filter = ('action', 'target_type', 'created_at')
    search_fields = (
        'action',
        'target_type',
        'target_id',
        'actor_user__username',
        'actor_user__email',
    )
    readonly_fields = ('created_at', 'updated_at')
