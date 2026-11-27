from django.contrib import admin

from .models import CreditClient, CreditClientChange, CreditClientImport


@admin.register(CreditClient)
class CreditClientAdmin(admin.ModelAdmin):
    list_display = ('name', 'tin', 'currency', 'credit_limit', 'credit_utilization', 'credit_days', 'status', 'updated_at')
    list_filter = ('status', 'currency')
    search_fields = ('name', 'tin', 'contact_person', 'email')
    readonly_fields = ('created_by', 'updated_by', 'created_at', 'updated_at')


@admin.register(CreditClientChange)
class CreditClientChangeAdmin(admin.ModelAdmin):
    list_display = ('client', 'source', 'changed_by', 'created_at')
    list_filter = ('source',)
    readonly_fields = [field.name for field in CreditClientChange._meta.fields]


@admin.register(CreditClientImport)
class CreditClientImportAdmin(admin.ModelAdmin):
    list_display = ('file_name', 'uploaded_by', 'rows', 'created_count', 'updated_count', 'rejected_count', 'created_at')
    readonly_fields = [field.name for field in CreditClientImport._meta.fields]
