from rest_framework import serializers
from .models import InventoryCategory, InventoryItem, InventoryAssignment, InventoryMaintenanceLog, MaintenanceLogAttachment
from .s3 import build_maintenance_attachment_public_url
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
            'id', 'code', 'name', 'category', 'serial_number', 'purchase_date', 
            'photo_url', 'status', 'current_assignee', 'notes', 'assignments', 'created_at', 'updated_at'
        ]

class InventoryItemCreateUpdateSerializer(serializers.ModelSerializer):
    code = serializers.CharField(read_only=True)
    
    class Meta:
        model = InventoryItem
        fields = ['code', 'name', 'category', 'serial_number', 'purchase_date', 'photo_url', 'status', 'notes']

class InventoryItemAssignSerializer(serializers.Serializer):
    assigned_to = serializers.IntegerField()
    condition_notes = serializers.CharField(required=False, allow_blank=True)

class InventoryItemReturnSerializer(serializers.Serializer):
    condition_notes = serializers.CharField(required=False, allow_blank=True)


class BasicInventoryItemSerializer(serializers.ModelSerializer):
    category = InventoryCategorySerializer(read_only=True)
    
    class Meta:
        model = InventoryItem
        fields = ['id', 'code', 'name', 'category', 'serial_number', 'photo_url', 'status']


class MaintenanceLogAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = MaintenanceLogAttachment
        fields = ['id', 'object_key', 'file_name', 'content_type', 'size', 'file_url', 'created_at']
        read_only_fields = ['id', 'file_url', 'created_at']
        extra_kwargs = {
            'object_key': {
                'validators': [],
            }
        }

    def get_file_url(self, obj):
        if not obj.object_key:
            return None
        # Handle cases where object_key might already be a full URL from data migration
        if obj.object_key.startswith('http'):
            return obj.object_key
        return build_maintenance_attachment_public_url(obj.object_key)


class InventoryMaintenanceLogSerializer(serializers.ModelSerializer):
    item = BasicInventoryItemSerializer(read_only=True)
    assigned_to = BasicUserSerializer(read_only=True)
    created_by = BasicUserSerializer(read_only=True)
    attachments = MaintenanceLogAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = InventoryMaintenanceLog
        fields = [
            'id', 'item', 'date', 'issue_reported', 'action_taken',
            'assigned_to', 'status', 'attachments', 'created_by', 'created_at', 'updated_at'
        ]


class InventoryMaintenanceLogWriteSerializer(serializers.ModelSerializer):
    attachments = MaintenanceLogAttachmentSerializer(many=True, required=False)

    class Meta:
        model = InventoryMaintenanceLog
        fields = [
            'item', 'date', 'issue_reported', 'action_taken',
            'assigned_to', 'status', 'attachments'
        ]

    def create(self, validated_data):
        attachments_data = validated_data.pop('attachments', [])
        log = InventoryMaintenanceLog.objects.create(**validated_data)
        for attachment_data in attachments_data:
            MaintenanceLogAttachment.objects.create(log=log, **attachment_data)
        return log

    def update(self, instance, validated_data):
        attachments_data = validated_data.pop('attachments', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if attachments_data is not None:
            incoming_keys = [data['object_key'] for data in attachments_data]
            instance.attachments.exclude(object_key__in=incoming_keys).delete()
            
            existing_keys = instance.attachments.values_list('object_key', flat=True)
            for attachment_data in attachments_data:
                if attachment_data['object_key'] not in existing_keys:
                    MaintenanceLogAttachment.objects.create(log=instance, **attachment_data)
                
        return instance


class MaintenanceAttachmentUploadUrlSerializer(serializers.Serializer):
    file_name = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=100)

class InventoryPhotoUploadUrlSerializer(serializers.Serializer):
    file_name = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=100)
