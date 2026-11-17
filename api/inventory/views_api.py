import logging

from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from rest_framework import generics, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from applications.audit import log_audit
from applications.audit_actions import AuditAction
from common.csv_export import csv_response
from common.exceptions import Conflict, ServiceUnavailable
from common.params import choice_param, uuid_param
from common.uploads import checked_upload
from common.users import display_name
from inventory.s3 import (
    delete_inventory_photo_by_public_url,
    generate_inventory_photo_upload_url,
)
from notifications.models import Notification
from notifications.services import create_notification

from .models import (
    InventoryAssignment,
    InventoryCategory,
    InventoryItem,
    InventoryMaintenanceLog,
    MaintenanceLogAttachment,
)
from .permissions import IsITOrAdminOrGlobalReadOnly
from .s3 import (
    MaintenanceAttachmentUploadError,
    generate_maintenance_attachment_upload_url,
)
from .serializers import (
    InventoryCategorySerializer,
    InventoryItemAssignSerializer,
    InventoryItemCreateUpdateSerializer,
    InventoryItemReturnSerializer,
    InventoryItemSerializer,
    InventoryMaintenanceLogSerializer,
    InventoryMaintenanceLogWriteSerializer,
    InventoryPhotoUploadUrlSerializer,
    MaintenanceAttachmentUploadUrlSerializer,
)

NO_PUT = ['get', 'post', 'patch', 'delete', 'head', 'options']

logger = logging.getLogger(__name__)

ITEM_STATUSES = {value for value, _label in InventoryItem.STATUS_CHOICES}
MAINTENANCE_STATUSES = {value for value, _label in InventoryMaintenanceLog.STATUS_CHOICES}


class InventoryCategoryViewSet(viewsets.ModelViewSet):
    queryset = InventoryCategory.objects.all().order_by('name')
    serializer_class = InventoryCategorySerializer
    permission_classes = [IsAuthenticated, IsITOrAdminOrGlobalReadOnly]
    http_method_names = NO_PUT
    lookup_value_converter = 'uuid'
    # A short list that fills dropdowns, always shown whole.
    pagination_class = None


class InventoryItemViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsITOrAdminOrGlobalReadOnly]
    http_method_names = NO_PUT
    lookup_value_converter = 'uuid'
    
    def get_queryset(self):
        queryset = InventoryItem.objects.all().select_related('category', 'current_assignee').prefetch_related('assignments')
        
        params = self.request.query_params
        search = (params.get('search') or '').strip()
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) |
                Q(serial_number__icontains=search) |
                Q(code__icontains=search) |
                Q(current_assignee__first_name__icontains=search) |
                Q(current_assignee__last_name__icontains=search) |
                Q(current_assignee_department__name__icontains=search)
            )

        category_id = uuid_param(params, 'category_id')
        if category_id:
            queryset = queryset.filter(category_id=category_id)

        status_filter = choice_param(params, 'status', ITEM_STATUSES)
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        managing_department_id = uuid_param(params, 'managing_department_id')
        if managing_department_id:
            queryset = queryset.filter(managing_department_id=managing_department_id)

        return queryset.order_by('-purchase_date', 'name')
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        return Response({
            'total': InventoryItem.objects.count(),
            'available': InventoryItem.objects.filter(status='available').count(),
            'assigned': InventoryItem.objects.filter(status='assigned').count(),
            'maintenance': InventoryItem.objects.filter(status='maintenance').count(),
            'retired': InventoryItem.objects.filter(status='retired').count(),
            'unaccounted': InventoryItem.objects.filter(status='unaccounted').count(),
        })

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return InventoryItemCreateUpdateSerializer
        return InventoryItemSerializer

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        rows = (
            [
                item.code,
                item.name,
                item.category.name if item.category else '',
                item.serial_number,
                item.status,
                display_name(item.current_assignee) if item.current_assignee else '',
                item.purchase_date or '',
            ]
            for item in queryset.iterator(chunk_size=500)
        )
        return csv_response(
            'inventory.csv',
            ['Code', 'Name', 'Category', 'Serial Number', 'Status', 'Current Assignee', 'Purchase Date'],
            rows,
        )

    def perform_create(self, serializer):
        item = serializer.save()
        log_audit(
            action=AuditAction.INVENTORY_ITEM_CREATED,
            request=self.request,
            target_type='inventory_item',
            target_id=str(item.id),
            metadata={'name': item.name, 'serial_number': item.serial_number}
        )

    def perform_update(self, serializer):
        item = serializer.instance
        previous_photo_url = item.photo_url if item else ''
        
        item = serializer.save()
        
        if previous_photo_url and item.photo_url != previous_photo_url:
            try:
                delete_inventory_photo_by_public_url(previous_photo_url)
            except Exception:
                # The update stands even if the old photo could not be removed.
                logger.exception('Could not delete replaced inventory photo %s', previous_photo_url)
                
        log_audit(
            action=AuditAction.INVENTORY_ITEM_UPDATED,
            request=self.request,
            target_type='inventory_item',
            target_id=str(item.id),
            metadata={'name': item.name, 'status': item.status}
        )

    def perform_destroy(self, instance):
        # An item that has been assigned or serviced has a history worth
        # keeping; deleting it would erase that history with it.
        if instance.assignments.exists() or instance.maintenance_logs.exists():
            raise Conflict(
                'This item has assignment or maintenance history and cannot be deleted. Mark it as retired instead.'
            )
        item_id = str(instance.id)
        name = instance.name
        photo_url = instance.photo_url
        instance.delete()
        
        if photo_url:
            try:
                delete_inventory_photo_by_public_url(photo_url)
            except Exception:
                logger.exception('Could not delete photo of deleted inventory item %s', photo_url)
                
        log_audit(
            action=AuditAction.INVENTORY_ITEM_DELETED,
            request=self.request,
            target_type='inventory_item',
            target_id=item_id,
            metadata={'name': name}
        )

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def assign(self, request, pk=None):
        # Locked for the whole operation: two assignments at once must not both
        # succeed and leave the item's record contradicting its history.
        item = InventoryItem.objects.select_for_update().get(pk=self.get_object().pk)
        serializer = InventoryItemAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        user = serializer.validated_data.get('assigned_to')
        department = serializer.validated_data.get('assigned_to_department')

        if item.status not in ['available', 'assigned']:
            raise ValidationError(f"Cannot assign an item with status '{item.status}'.")

        if item.status == 'assigned' and (item.current_assignee or item.current_assignee_department):
            # Mark previous assignment as returned if reassigned directly
            last_assignment = item.assignments.filter(returned_at__isnull=True).first()
            if last_assignment:
                last_assignment.returned_at = timezone.now()
                last_assignment.condition_notes = "Automatically returned upon reassignment."
                last_assignment.save()

        # Update Item
        item.current_assignee = user
        item.current_assignee_department = department
        item.status = 'assigned'
        item.save()

        # Create Assignment Record
        InventoryAssignment.objects.create(
            item=item,
            assigned_to=user,
            assigned_to_department=department,
            assigned_by=request.user,
            condition_notes=serializer.validated_data.get('condition_notes', '')
        )

        metadata = {'name': item.name}
        if user:
            metadata['assigned_to'] = user.username
        if department:
            metadata['assigned_to_department'] = department.name

        log_audit(
            action=AuditAction.INVENTORY_ITEM_ASSIGNED,
            request=request,
            target_type='inventory_item',
            target_id=str(item.id),
            metadata=metadata
        )

        if user:
            create_notification(
                recipient=user,
                actor=request.user,
                notification_type=Notification.TYPE_INVENTORY_ASSIGNED,
                title='New Inventory Assigned',
                body=f'You have been assigned: {item.name}',
                link_url='/my-assets'
            )
        elif department and department.line_manager:
            create_notification(
                recipient=department.line_manager,
                actor=request.user,
                notification_type=Notification.TYPE_INVENTORY_ASSIGNED,
                title='New Department Inventory Assigned',
                body=f'Your department ({department.name}) has been assigned: {item.name}',
                link_url='/my-assets'
            )

        return Response(InventoryItemSerializer(item).data)

    @action(detail=True, methods=['post'], url_path='return', url_name='return')
    @transaction.atomic
    def return_item(self, request, pk=None):
        item = InventoryItem.objects.select_for_update().get(pk=self.get_object().pk)
        serializer = InventoryItemReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if item.status != 'assigned':
            raise ValidationError('Item is not currently assigned.')

        last_assignment = item.assignments.filter(returned_at__isnull=True).first()
        if last_assignment:
            last_assignment.returned_at = timezone.now()
            last_assignment.condition_notes = serializer.validated_data.get('condition_notes', '')
            last_assignment.save()

        previous_assignee_name = item.current_assignee.username if item.current_assignee else (item.current_assignee_department.name if item.current_assignee_department else 'Unknown')

        item.current_assignee = None
        item.current_assignee_department = None
        item.status = 'available'
        item.save()

        log_audit(
            action=AuditAction.INVENTORY_ITEM_RETURNED,
            request=request,
            target_type='inventory_item',
            target_id=str(item.id),
            metadata={'returned_by_user': previous_assignee_name, 'name': item.name}
        )

        return Response(InventoryItemSerializer(item).data)

    @action(detail=False, methods=['post'], url_path='photo-upload-url', url_name='photo-upload-url')
    def photo_upload_url(self, request):
        serializer = InventoryPhotoUploadUrlSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        content_type = serializer.validated_data['content_type']

        try:
            url_data = generate_inventory_photo_upload_url(
                file_name=serializer.validated_data['file_name'],
                content_type=content_type,
            )
        except Exception:
            logger.exception('Could not generate an inventory photo upload URL')
            raise ServiceUnavailable('Could not generate upload URL. Storage service may be unavailable.')
        return Response(url_data)


class MyInventoryView(generics.ListAPIView):
    """The assets assigned to the caller: a personal, short list, shown whole."""

    serializer_class = InventoryItemSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return InventoryItem.objects.filter(current_assignee=self.request.user).select_related('category', 'current_assignee').prefetch_related('assignments')


class InventoryMaintenanceLogViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsITOrAdminOrGlobalReadOnly]
    http_method_names = NO_PUT
    lookup_value_converter = 'uuid'

    def get_queryset(self):
        queryset = InventoryMaintenanceLog.objects.all().select_related('item__category', 'assigned_to', 'created_by')
        
        params = self.request.query_params
        item_id = uuid_param(params, 'item_id')
        if item_id:
            queryset = queryset.filter(item_id=item_id)

        status_filter = choice_param(params, 'status', MAINTENANCE_STATUSES)
        if status_filter:
            queryset = queryset.filter(status=status_filter)

        category_id = uuid_param(params, 'category_id')
        if category_id:
            queryset = queryset.filter(item__category_id=category_id)

        search = (params.get('search') or '').strip()
        if search:
            queryset = queryset.filter(item__code__icontains=search)

        return queryset

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return InventoryMaintenanceLogWriteSerializer
        return InventoryMaintenanceLogSerializer

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        rows = (
            [
                log.date,
                log.item.code if log.item else '',
                log.item.name if log.item else '',
                log.issue_reported,
                log.action_taken,
                display_name(log.assigned_to) if log.assigned_to else '',
                log.status,
                display_name(log.created_by) if log.created_by else '',
            ]
            for log in queryset.iterator(chunk_size=500)
        )
        return csv_response(
            'maintenance_logs.csv',
            ['Date', 'Asset Code', 'Asset Name', 'Issue Reported', 'Action Taken', 'Assigned To', 'Status', 'Created By'],
            rows,
        )

    def _check_attachments(self, serializer):
        """At most five files, and each new one verified against storage."""
        attachments_data = serializer.validated_data.get('attachments') or []
        if len(attachments_data) > 5:
            raise ValidationError({"attachments": "Maximum of 5 attachments allowed per maintenance log."})

        already_attached = set()
        if serializer.instance is not None:
            already_attached = set(serializer.instance.attachments.values_list('object_key', flat=True))
        for attachment in attachments_data:
            key = attachment['object_key']
            if key in already_attached:
                continue
            if MaintenanceLogAttachment.objects.filter(object_key=key).exists():
                raise ValidationError({'attachments': ['A file is already attached to another log.']})
            attachment['size'], attachment['content_type'] = checked_upload(
                key,
                field='attachments',
                claimed_size=attachment.get('size'),
                claimed_type=attachment.get('content_type', ''),
            )

    def perform_create(self, serializer):
        self._check_attachments(serializer)
        # Opening a log moves the item into maintenance, which must not
        # overwrite the record that an item was retired or is unaccounted for.
        item = serializer.validated_data['item']
        if item.status in ('retired', 'unaccounted'):
            raise ValidationError({'item_id': f'A {item.status} item cannot be put into maintenance.'})
            
        log = serializer.save(created_by=self.request.user)
        self._sync_item_status(log)
        log_audit(
            action=AuditAction.INVENTORY_MAINTENANCE_CREATED,
            request=self.request,
            target_type='inventory_maintenance_log',
            target_id=str(log.id),
            metadata={'item_id': str(log.item_id), 'status': log.status}
        )

    def perform_update(self, serializer):
        if serializer.instance.status == 'completed':
            raise PermissionDenied("Cannot edit a maintenance log that is already completed.")
            
        self._check_attachments(serializer)

        log = serializer.save()
        self._sync_item_status(log)
        log_audit(
            action=AuditAction.INVENTORY_MAINTENANCE_UPDATED,
            request=self.request,
            target_type='inventory_maintenance_log',
            target_id=str(log.id),
            metadata={'item_id': str(log.item_id), 'status': log.status}
        )
        
    def perform_destroy(self, instance):
        if instance.status == 'completed':
            raise PermissionDenied("Cannot delete a maintenance log that is already completed.")
        log_id = str(instance.id)
        item_id = str(instance.item_id)
        instance.delete()
        log_audit(
            action=AuditAction.INVENTORY_MAINTENANCE_DELETED,
            request=self.request,
            target_type='inventory_maintenance_log',
            target_id=log_id,
            metadata={'item_id': item_id}
        )

    def _sync_item_status(self, log):
        item = log.item
        if log.status in ['open', 'in_progress'] and item.status != 'maintenance':
            item.status = 'maintenance'
            item.save(update_fields=['status'])
        elif log.status == 'completed' and item.status == 'maintenance':
            open_logs = InventoryMaintenanceLog.objects.filter(item=item, status__in=['open', 'in_progress']).exclude(id=log.id).exists()
            if not open_logs:
                # Assigned to a person or to a department.
                if item.current_assignee_id or item.current_assignee_department_id:
                    item.status = 'assigned'
                else:
                    item.status = 'available'
                item.save(update_fields=['status'])

    @action(detail=False, methods=['post'], url_path='attachment-upload-url', url_name='attachment-upload-url')
    def attachment_upload_url(self, request):
        serializer = MaintenanceAttachmentUploadUrlSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = generate_maintenance_attachment_upload_url(
                file_name=serializer.validated_data['file_name'],
                content_type=serializer.validated_data['content_type'],
            )
        except MaintenanceAttachmentUploadError as e:
            raise ValidationError(str(e))

        return Response(result)
