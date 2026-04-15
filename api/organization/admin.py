from django.contrib import admin

from .models import Department, Role


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'has_global_access', 'is_active', 'updated_at')
    list_filter = ('has_global_access', 'is_active')
    search_fields = ('name', 'code')


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'is_active', 'updated_at')
    list_filter = ('is_active',)
    search_fields = ('name', 'code')
