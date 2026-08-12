from django.contrib import admin

from .models import Department, Role, Team, Unit


@admin.register(Role)
class RoleAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'has_global_access', 'is_active', 'updated_at')
    list_filter = ('has_global_access', 'is_active')
    search_fields = ('name', 'code')


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'line_manager', 'is_active', 'updated_at')
    list_filter = ('is_active',)
    search_fields = ('name', 'code')


@admin.register(Unit)
class UnitAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'department', 'supervisor', 'is_active', 'updated_at')
    list_filter = ('is_active', 'department')
    search_fields = ('name', 'code')


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ('name', 'code', 'unit', 'team_lead', 'is_active', 'updated_at')
    list_filter = ('is_active', 'unit')
    search_fields = ('name', 'code')
