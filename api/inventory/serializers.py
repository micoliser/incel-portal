from rest_framework import serializers
from .models import InventoryCategory, InventoryItem, InventoryAssignment
from accounts.serializers import BasicUserSerializer

class InventoryCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryCategory
        fields = ['id', 'name', 'description', 'created_at']

class InventoryAssignmentSerializer(serializers.ModelSerializer):
    assigned_to = BasicUserSerializer(read_only=True)
    assigned_by = BasicUserSerializer(read_only=True)

    class Meta:
        model = InventoryAssignment
        fields = ['id', 'item', 'assigned_to', 'assigned_by', 'assigned_at', 'returned_at', 'condition_notes']

class InventoryItemSerializer(serializers.ModelSerializer):
    category = InventoryCategorySerializer(read_only=True)
    current_assignee = BasicUserSerializer(read_only=True)
    assignments = InventoryAssignmentSerializer(many=True, read_only=True)

    class Meta:
        model = InventoryItem
        fields = [
            'id', 'name', 'category', 'serial_number', 'purchase_date', 
            'status', 'current_assignee', 'notes', 'assignments', 'created_at', 'updated_at'
        ]

class InventoryItemCreateUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryItem
        fields = ['name', 'category', 'serial_number', 'purchase_date', 'status', 'notes']

class InventoryItemAssignSerializer(serializers.Serializer):
    assigned_to = serializers.IntegerField()
    condition_notes = serializers.CharField(required=False, allow_blank=True)

class InventoryItemReturnSerializer(serializers.Serializer):
    condition_notes = serializers.CharField(required=False, allow_blank=True)
