from django.contrib import admin

from .models import StaffProfile


@admin.register(StaffProfile)
class StaffProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'role', 'department', 'is_active', 'updated_at')
    list_filter = ('is_active', 'role', 'department')
    search_fields = ('user__username', 'user__email', 'role__name', 'role__code', 'department__name', 'department__code')
