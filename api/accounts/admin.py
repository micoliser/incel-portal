from django.contrib import admin, messages

from .models import ServiceApiKey, StaffProfile


@admin.register(StaffProfile)
class StaffProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'role', 'department', 'is_active', 'updated_at')
    list_filter = ('is_active', 'role', 'department')
    search_fields = ('user__username', 'user__email', 'role__name', 'role__code', 'department__name', 'department__code')


@admin.register(ServiceApiKey)
class ServiceApiKeyAdmin(admin.ModelAdmin):
    list_display = ('name', 'prefix', 'is_active', 'last_used_at', 'expires_at', 'created_at')
    list_filter = ('is_active', 'created_at')
    search_fields = ('name', 'prefix')
    readonly_fields = ('prefix', 'hashed_key', 'last_used_at', 'created_at', 'updated_at')
    fields = ('name', 'is_active', 'expires_at', 'created_by', 'prefix', 'hashed_key', 'last_used_at', 'created_at', 'updated_at')

    def save_model(self, request, obj, form, change):
        if not change and not obj.hashed_key:
            # New instance created from admin - generate key
            _, raw_key = ServiceApiKey.generate_key(
                name=obj.name,
                created_by=obj.created_by or request.user,
                expires_at=obj.expires_at,
            )
            messages.success(
                request,
                f"Service API Key successfully created for '{obj.name}'!\n"
                f"RAW API KEY: {raw_key}\n"
                "Please copy this key now. For security reasons, you will not be able to view it again.",
            )
            return
        super().save_model(request, obj, form, change)
