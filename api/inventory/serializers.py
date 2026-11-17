from django.conf import settings
from django.contrib.auth.models import User
from rest_framework import serializers

from common.serializers import UserSummarySerializer
from common.storage import IMAGE_CONTENT_TYPES, attachment_content_types, presigned_download_url
from organization.models import Department
from organization.serializers import DepartmentSerializer

from .models import (
    InventoryAssignment,
    InventoryCategory,
    InventoryItem,
    InventoryMaintenanceLog,
    MaintenanceLogAttachment,
)
from .s3 import (
    extract_inventory_photo_key_from_public_url,
    maintenance_attachment_key,
    maintenance_attachment_key_prefix,
)


class InventoryCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryCategory
        fields = ['id', 'name', 'description', 'created_at']

class InventoryAssignmentSerializer(serializers.ModelSerializer):
    assigned_to = UserSummarySerializer(read_only=True)
    assigned_to_department = DepartmentSerializer(read_only=True)
    assigned_by = UserSummarySerializer(read_only=True)

    class Meta:
        model = InventoryAssignment
        fields = ['id', 'item', 'assigned_to', 'assigned_to_department', 'assigned_by', 'assigned_at', 'returned_at', 'condition_notes']

class InventoryItemSerializer(serializers.ModelSerializer):
    category = InventoryCategorySerializer(read_only=True)
    current_assignee = UserSummarySerializer(read_only=True)
    current_assignee_department = DepartmentSerializer(read_only=True)
    managing_department = DepartmentSerializer(read_only=True)
    assignments = InventoryAssignmentSerializer(many=True, read_only=True)

    class Meta:
        model = InventoryItem
        fields = [
            'id', 'code', 'name', 'category', 'serial_number', 'purchase_date', 
            'photo_url', 'status', 'status_reason', 'quantity', 'current_assignee', 'current_assignee_department', 
            'managing_department', 'notes', 'assignments', 'created_at', 'updated_at'
        ]

class InventoryItemCreateUpdateSerializer(serializers.ModelSerializer):
    code = serializers.CharField(read_only=True)
    category_id = serializers.PrimaryKeyRelatedField(source='category', queryset=InventoryCategory.objects.all())
    managing_department_id = serializers.PrimaryKeyRelatedField(
        source='managing_department',
        queryset=Department.objects.all(),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = InventoryItem
        fields = [
            'id', 'code', 'name', 'category_id', 'serial_number', 'purchase_date', 'photo_url', 'status',
            'status_reason', 'quantity', 'managing_department_id', 'notes',
        ]

    def validate_photo_url(self, value):
        # Only a photo uploaded through this API; an unchanged value is kept as it is.
        if not value or (self.instance and value == self.instance.photo_url):
            return value
        if extract_inventory_photo_key_from_public_url(value) is None:
            raise serializers.ValidationError('The photo must be uploaded through the portal.')
        return value

    def validate(self, data):
        status = data.get('status')
        status_reason = data.get('status_reason')
        if status == 'unaccounted' and not status_reason:
            raise serializers.ValidationError({"status_reason": "Reason is required when status is unaccounted."})
        return data

class InventoryItemAssignSerializer(serializers.Serializer):
    """Assign to one person or to one department, never both."""

    assigned_to_id = serializers.PrimaryKeyRelatedField(
        source='assigned_to',
        queryset=User.objects.filter(is_active=True),
        required=False,
        allow_null=True,
    )
    assigned_to_department_id = serializers.PrimaryKeyRelatedField(
        source='assigned_to_department',
        queryset=Department.objects.all(),
        required=False,
        allow_null=True,
    )
    condition_notes = serializers.CharField(required=False, allow_blank=True)

    def validate(self, data):
        assigned_to = data.get('assigned_to')
        assigned_to_department = data.get('assigned_to_department')
        if not assigned_to and not assigned_to_department:
            raise serializers.ValidationError('Must provide either assigned_to_id or assigned_to_department_id.')
        if assigned_to and assigned_to_department:
            raise serializers.ValidationError('Cannot assign to both a user and a department.')
        return data


class InventoryItemReturnSerializer(serializers.Serializer):
    condition_notes = serializers.CharField(required=False, allow_blank=True)


class BasicInventoryItemSerializer(serializers.ModelSerializer):
    category = InventoryCategorySerializer(read_only=True)
    
    class Meta:
        model = InventoryItem
        fields = ['id', 'code', 'name', 'category', 'serial_number', 'quantity', 'photo_url', 'status', 'status_reason']


class MaintenanceLogAttachmentSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    # Uniqueness is handled when the log is saved (an edit re-sends the keys
    # it keeps), so the model's unique validator is not used here.
    object_key = serializers.CharField(max_length=1024)

    class Meta:
        model = MaintenanceLogAttachment
        fields = ['id', 'object_key', 'file_name', 'content_type', 'size', 'file_url', 'created_at']
        read_only_fields = ['id', 'file_url', 'created_at']

    def validate_object_key(self, value):
        value = value.strip()
        if not value.startswith(maintenance_attachment_key_prefix()) or '..' in value:
            raise serializers.ValidationError('This file was not uploaded as a maintenance attachment.')
        return value

    def validate_content_type(self, value):
        value = str(value).strip().lower()
        allowed = attachment_content_types()
        if allowed and value not in allowed:
            raise serializers.ValidationError('Unsupported attachment content type.')
        return value

    def get_file_url(self, obj):
        """A short-lived link: maintenance files are private."""
        key = maintenance_attachment_key(obj.object_key)
        if not key:
            return None
        return presigned_download_url(
            key,
            file_name=obj.file_name,
            content_type=obj.content_type,
            expires_in=settings.MAINTENANCE_ATTACHMENT_DOWNLOAD_URL_EXPIRES_IN,
        )


class InventoryMaintenanceLogSerializer(serializers.ModelSerializer):
    item = BasicInventoryItemSerializer(read_only=True)
    assigned_to = UserSummarySerializer(read_only=True)
    created_by = UserSummarySerializer(read_only=True)
    attachments = MaintenanceLogAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = InventoryMaintenanceLog
        fields = [
            'id', 'item', 'date', 'issue_reported', 'action_taken',
            'assigned_to', 'status', 'attachments', 'created_by', 'created_at', 'updated_at'
        ]


class InventoryMaintenanceLogWriteSerializer(serializers.ModelSerializer):
    attachments = MaintenanceLogAttachmentSerializer(many=True, required=False)
    item_id = serializers.PrimaryKeyRelatedField(source='item', queryset=InventoryItem.objects.all())
    assigned_to_id = serializers.PrimaryKeyRelatedField(
        source='assigned_to',
        queryset=User.objects.filter(is_active=True),
        required=False,
        allow_null=True,
    )

    class Meta:
        model = InventoryMaintenanceLog
        fields = [
            'id', 'item_id', 'date', 'issue_reported', 'action_taken',
            'assigned_to_id', 'status', 'attachments',
        ]
        read_only_fields = ['id']

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

    def validate_content_type(self, value):
        value = value.strip().lower()
        allowed = attachment_content_types()
        if allowed and value not in allowed:
            raise serializers.ValidationError('Unsupported attachment content type.')
        return value


class InventoryPhotoUploadUrlSerializer(serializers.Serializer):
    file_name = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=100)

    def validate_content_type(self, value):
        # PNG, JPEG and WebP only: an SVG can carry script.
        value = value.strip().lower()
        if value not in IMAGE_CONTENT_TYPES:
            raise serializers.ValidationError('Photos must be PNG, JPEG or WebP.')
        return value
