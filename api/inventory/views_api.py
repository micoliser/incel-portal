import csv
from django.http import HttpResponse
from rest_framework import viewsets
from rest_framework.exceptions import ValidationError, PermissionDenied, NotFound, AuthenticationFailed
from rest_framework import status, generics
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from common.permissions import IsAdminUser
from rest_framework.pagination import PageNumberPagination
from django.utils import timezone
from django.db.models import Q
from django.contrib.auth.models import User
from django.shortcuts import get_object_or_404

from .models import InventoryCategory, InventoryItem, InventoryAssignment, InventoryMaintenanceLog
from .serializers import (
    InventoryCategorySerializer,
    InventoryItemSerializer,
    InventoryItemCreateUpdateSerializer,
    InventoryItemAssignSerializer,
    InventoryItemReturnSerializer,
    InventoryMaintenanceLogSerializer,
    InventoryMaintenanceLogWriteSerializer,
    MaintenanceAttachmentUploadUrlSerializer,
    InventoryPhotoUploadUrlSerializer,
)
from .permissions import IsITOrAdminOrGlobalReadOnly
from .s3 import generate_maintenance_attachment_upload_url, MaintenanceAttachmentUploadError
from applications.audit import log_audit
from notifications.services import create_notification


class InventoryCategoryViewSet(viewsets.ModelViewSet):
    queryset = InventoryCategory.objects.all().order_by('name')
    serializer_class = InventoryCategorySerializer
    permission_classes = [IsAuthenticated, IsITOrAdminOrGlobalReadOnly]


class InventoryPagination(PageNumberPagination):
    page_size = 20

    def get_paginated_response(self, data):
        response = super().get_paginated_response(data)
        response.data['page'] = self.page.number
        response.data['page_size'] = self.page.paginator.per_page
        response.data['total_pages'] = self.page.paginator.num_pages
        response.data['next_page'] = self.page.next_page_number() if self.page.has_next() else None
        response.data['previous_page'] = self.page.previous_page_number() if self.page.has_previous() else None
        return response


class InventoryItemViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsITOrAdminOrGlobalReadOnly]
    pagination_class = InventoryPagination
    
    def get_queryset(self):
        queryset = InventoryItem.objects.all().select_related('category', 'current_assignee').prefetch_related('assignments')
        
        search = (self.request.query_params.get('q') or '').strip()
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) | Q(serial_number__icontains=search) | Q(code__icontains=search)
            )

        category_id = self.request.query_params.get('category')
        if category_id and category_id != 'all':
            queryset = queryset.filter(category_id=category_id)

        status_filter = self.request.query_params.get('status')
        if status_filter and status_filter != 'all':
            queryset = queryset.filter(status=status_filter)

        return queryset.order_by('-purchase_date', 'name')
    
    @action(detail=False, methods=['get'])
    def stats(self, request):
        return Response({
            'total': InventoryItem.objects.count(),
            'available': InventoryItem.objects.filter(status='available').count(),
            'assigned': InventoryItem.objects.filter(status='assigned').count(),
            'maintenance': InventoryItem.objects.filter(status='maintenance').count(),
        })

    def get_serializer_class(self):
        if self.action in ['create', 'update', 'partial_update']:
            return InventoryItemCreateUpdateSerializer
        return InventoryItemSerializer

    @action(detail=False, methods=['get'])
    def export(self, request):
        queryset = self.filter_queryset(self.get_queryset())
        
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="inventory.csv"'
        
        writer = csv.writer(response)
        writer.writerow(['Code', 'Name', 'Category', 'Serial Number', 'Status', 'Current Assignee', 'Purchase Date'])
        
        for item in queryset:
            assignee = f"{item.current_assignee.first_name} {item.current_assignee.last_name}".strip() if item.current_assignee else ""
            if not assignee and item.current_assignee:
                assignee = item.current_assignee.username
                
            writer.writerow([
                item.code,
                item.name,
                item.category.name if item.category else "",
                item.serial_number,
                item.status,
                assignee,
                item.purchase_date or ""
            ])
            
        return response

    def perform_create(self, serializer):
        item = serializer.save()
        log_audit(
            action='inventory.item.created',
            request=self.request,
            target_type='inventory_item',
            target_id=str(item.id),
            metadata={'name': item.name, 'serial_number': item.serial_number}
        )

    def perform_update(self, serializer):
        item = serializer.save()
        log_audit(
            action='inventory.item.updated',
            request=self.request,
            target_type='inventory_item',
            target_id=str(item.id),
            metadata={'name': item.name, 'status': item.status}
        )

    def perform_destroy(self, instance):
        item_id = str(instance.id)
        name = instance.name
        instance.delete()
        log_audit(
            action='inventory.item.deleted',
            request=self.request,
            target_type='inventory_item',
            target_id=item_id,
            metadata={'name': name}
        )

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        item = self.get_object()
        serializer = InventoryItemAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        user_id = serializer.validated_data['assigned_to']
        user = get_object_or_404(User, pk=user_id)
        
        if item.status == 'assigned' and item.current_assignee:
            # Mark previous assignment as returned if reassigned directly
            last_assignment = item.assignments.filter(returned_at__isnull=True).first()
            if last_assignment:
                last_assignment.returned_at = timezone.now()
                last_assignment.condition_notes = "Automatically returned upon reassignment."
                last_assignment.save()

        # Update Item
        item.current_assignee = user
        item.status = 'assigned'
        item.save()

        # Create Assignment Record
        assignment = InventoryAssignment.objects.create(
            item=item,
            assigned_to=user,
            assigned_by=request.user,
            condition_notes=serializer.validated_data.get('condition_notes', '')
        )

        log_audit(
            action='inventory.item.assigned',
            request=request,
            target_type='inventory_item',
            target_id=str(item.id),
            metadata={'assigned_to': user.username, 'name': item.name}
        )

        create_notification(
            recipient=user,
            actor=request.user,
            notification_type='inventory_assigned',
            title='New Inventory Assigned',
            body=f'You have been assigned: {item.name}',
            link_url=f'/my-assets'
        )

        return Response(InventoryItemSerializer(item).data)

    @action(detail=True, methods=['post'])
    def return_item(self, request, pk=None):
        item = self.get_object()
        serializer = InventoryItemReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        if item.status != 'assigned':
            raise ValidationError('Item is not currently assigned.')

        last_assignment = item.assignments.filter(returned_at__isnull=True).first()
        if last_assignment:
            last_assignment.returned_at = timezone.now()
            last_assignment.condition_notes = serializer.validated_data.get('condition_notes', '')
            last_assignment.save()

        previous_assignee_name = item.current_assignee.username if item.current_assignee else 'Unknown'

        item.current_assignee = None
        item.status = 'available'
        item.save()

        log_audit(
            action='inventory.item.returned',
            request=request,
            target_type='inventory_item',
            target_id=str(item.id),
            metadata={'returned_by_user': previous_assignee_name, 'name': item.name}
        )

        return Response(InventoryItemSerializer(item).data)

    @action(detail=False, methods=['post'])
    def upload_photo_url(self, request):
        serializer = InventoryPhotoUploadUrlSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        file_name = serializer.validated_data['file_name']
        content_type = serializer.validated_data['content_type']
        
        # Quick validation
        if not content_type.startswith('image/'):
            raise ValidationError('Only image files are allowed.')

        try:
            from inventory.s3 import generate_inventory_photo_upload_url
            url_data = generate_inventory_photo_upload_url(
                file_name=file_name,
                content_type=content_type
            )
            return Response(url_data)
        except Exception as e:
            return Response(
                {'detail': 'Could not generate upload URL. Storage service may be unavailable.'}, 
                status=status.HTTP_503_SERVICE_UNAVAILABLE
            )


class MyInventoryView(generics.ListAPIView):
    serializer_class = InventoryItemSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return InventoryItem.objects.filter(current_assignee=self.request.user).select_related('category', 'current_assignee').prefetch_related('assignments')


class InventoryMaintenanceLogViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated, IsITOrAdminOrGlobalReadOnly]
    pagination_class = InventoryPagination

    def get_queryset(self):
        queryset = InventoryMaintenanceLog.objects.all().select_related('item__category', 'assigned_to', 'created_by')
        
        item_id = self.request.query_params.get('item')
        if item_id:
            queryset = queryset.filter(item_id=item_id)
            
        status_filter = self.request.query_params.get('status')
        if status_filter and status_filter != 'all':
            queryset = queryset.filter(status=status_filter)

        category_id = self.request.query_params.get('category')
        if category_id and category_id != 'all':
            queryset = queryset.filter(item__category_id=category_id)

        search = (self.request.query_params.get('q') or '').strip()
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
        
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="maintenance_logs.csv"'
        
        writer = csv.writer(response)
        writer.writerow(['Date', 'Asset Code', 'Asset Name', 'Issue Reported', 'Action Taken', 'Assigned To', 'Status', 'Created By'])
        
        for log in queryset:
            assigned_to = f"{log.assigned_to.first_name} {log.assigned_to.last_name}".strip() if log.assigned_to else ""
            if not assigned_to and log.assigned_to:
                assigned_to = log.assigned_to.username
                
            created_by = f"{log.created_by.first_name} {log.created_by.last_name}".strip() if log.created_by else ""
            if not created_by and log.created_by:
                created_by = log.created_by.username
                
            writer.writerow([
                log.date,
                log.item.code if log.item else "",
                log.item.name if log.item else "",
                log.issue_reported,
                log.action_taken,
                assigned_to,
                log.status,
                created_by
            ])
            
        return response

    def perform_create(self, serializer):
        attachments_data = self.request.data.get('attachments', [])
        if len(attachments_data) > 5:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"attachments": "Maximum of 5 attachments allowed per maintenance log."})
            
        log = serializer.save(created_by=self.request.user)
        self._sync_item_status(log)
        log_audit(
            action='inventory.maintenance.created',
            request=self.request,
            target_type='inventory_maintenance_log',
            target_id=str(log.id),
            metadata={'item_id': str(log.item_id), 'status': log.status}
        )

    def perform_update(self, serializer):
        from rest_framework.exceptions import PermissionDenied
        if serializer.instance.status == 'completed':
            raise PermissionDenied("Cannot edit a maintenance log that is already completed.")
            
        attachments_data = self.request.data.get('attachments', [])
        if len(attachments_data) > 5:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"attachments": "Maximum of 5 attachments allowed per maintenance log."})

        log = serializer.save()
        self._sync_item_status(log)
        log_audit(
            action='inventory.maintenance.updated',
            request=self.request,
            target_type='inventory_maintenance_log',
            target_id=str(log.id),
            metadata={'item_id': str(log.item_id), 'status': log.status}
        )
        
    def perform_destroy(self, instance):
        from rest_framework.exceptions import PermissionDenied
        if instance.status == 'completed':
            raise PermissionDenied("Cannot delete a maintenance log that is already completed.")
        log_id = str(instance.id)
        item_id = str(instance.item_id)
        instance.delete()
        log_audit(
            action='inventory.maintenance.deleted',
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
                if item.current_assignee:
                    item.status = 'assigned'
                else:
                    item.status = 'available'
                item.save(update_fields=['status'])

    @action(detail=False, methods=['post'], url_path='upload-url')
    def upload_url(self, request):
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
