from django.contrib import admin
from .models import InventoryCategory, InventoryItem, InventoryAssignment

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
    list_filter = ('assigned_at', 'returned_at')
    search_fields = ('item__name', 'assigned_to__username', 'assigned_by__username')
