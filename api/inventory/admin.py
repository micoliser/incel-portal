from django.contrib import admin
from .models import InventoryCategory, InventoryItem, InventoryAssignment, InventoryMaintenanceLog

@admin.register(InventoryCategory)
class InventoryCategoryAdmin(admin.ModelAdmin):
    list_display = ('name', 'created_at')
    search_fields = ('name',)

@admin.register(InventoryItem)
class InventoryItemAdmin(admin.ModelAdmin):
    list_display = ('name', 'category', 'status', 'current_assignee', 'serial_number', 'purchase_date')
    list_filter = ('status', 'category')
    search_fields = ('name', 'serial_number', 'current_assignee__username')

@admin.register(InventoryAssignment)
class InventoryAssignmentAdmin(admin.ModelAdmin):
    list_display = ('item', 'assigned_to', 'assigned_by', 'assigned_at', 'returned_at')
    readonly_fields = ('id',)
    raw_id_fields = ('item', 'assigned_to', 'assigned_by')

@admin.register(InventoryMaintenanceLog)
class InventoryMaintenanceLogAdmin(admin.ModelAdmin):
    list_display = ('id', 'item', 'date', 'status', 'assigned_to', 'created_at')
    list_filter = ('status', 'date', 'created_at')
    search_fields = ('item__name', 'item__serial_number', 'issue_reported')
    readonly_fields = ('id', 'created_at', 'updated_at')
    raw_id_fields = ('item', 'assigned_to', 'created_by')
