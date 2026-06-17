import logging

from django.contrib.auth.models import User
from django.db import models, transaction
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from .models import SupportAttachment, SupportComment, SupportRequest
from .permissions import (
    CanComment,
    CanManageDepartmentRequests,
    CanViewRequest,
    IsAssignedHandler,
    IsHandlerOrDepartmentManager,
    IsRequester,
    user_is_any_department_manager,
)
from .s3 import (
    SupportAttachmentStorageError,
    build_support_attachment_key,
    generate_support_attachment_upload_url,
)
from .serializers import (
    SupportAttachmentConfirmSerializer,
    SupportAttachmentSerializer,
    SupportAttachmentUploadRequestSerializer,
    SupportCommentCreateSerializer,
    SupportCommentSerializer,
    SupportRequestAssignSerializer,
    SupportRequestCreateSerializer,
    SupportRequestDetailSerializer,
    SupportRequestListSerializer,
    SupportRequestStatusSerializer,
)
from .services import (
    notify_comment_added,
    notify_request_assigned,
    notify_request_resolved,
    route_support_request,
    update_request_status,
)

logger = logging.getLogger(__name__)


class SupportRequestViewSet(ModelViewSet):
    """API endpoint for support requests."""

    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        # Staff see their own requests + assigned requests
        # Department managers also see their department's requests
        from .permissions import user_is_any_department_manager

        qs = SupportRequest.objects.filter(
            models.Q(requester=user) | models.Q(assigned_to=user)
        )

        if user_is_any_department_manager(user):
            # Add requests routed to the user's department
            from accounts.models import StaffProfile
            try:
                profile = user.staff_profile
                if profile.department:
                    dept_qs = SupportRequest.objects.filter(department=profile.department)
                    qs = qs | dept_qs
            except StaffProfile.DoesNotExist:
                pass

        return qs.distinct().select_related(
            'requester', 'department', 'assigned_to'
        ).prefetch_related('comments', 'attachments')

    def get_serializer_class(self):
        if self.action == 'list':
            return SupportRequestListSerializer
        if self.action == 'create':
            return SupportRequestCreateSerializer
        return SupportRequestDetailSerializer

    def get_permissions(self):
        if self.action in ['retrieve']:
            return [IsAuthenticated(), CanViewRequest()]
        if self.action in ['assign']:
            return [IsAuthenticated(), CanManageDepartmentRequests()]
        if self.action in ['update_status', 'resolve']:
            return [IsAuthenticated(), IsHandlerOrDepartmentManager()]
        if self.action in ['add_comment', 'upload_url', 'confirm_upload']:
            return [IsAuthenticated(), CanComment()]
        if self.action in ['confirm', 'reopen']:
            return [IsAuthenticated(), IsRequester()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        data = serializer.validated_data
        department = route_support_request(data['category'])

        # Snapshot the requester's line manager
        from .services import get_requester_line_manager
        lm = get_requester_line_manager(self.request.user)

        with transaction.atomic():
            request_obj = SupportRequest.objects.create(
                requester=self.request.user,
                title=data['title'],
                category=data['category'],
                priority=data.get('priority', 'medium'),
                description=data['description'],
                department=department,
                line_manager=lm,
            )

            SupportComment.objects.create(
                request=request_obj,
                author=self.request.user,
                body=f'Support request submitted — {request_obj.get_category_display()}, {request_obj.get_priority_display()} priority.',
                is_system=True,
            )

        # Fire notifications outside the transaction
        from .services import notify_request_submitted
        notify_request_submitted(request_obj)

        return request_obj

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        request_obj = self.perform_create(serializer)

        output = SupportRequestDetailSerializer(request_obj, context={'request': request})
        return Response(output.data, status=status.HTTP_201_CREATED)

    # -----------------------------------------------------------------------
    # Custom actions
    # -----------------------------------------------------------------------

    @action(detail=True, methods=['post'])
    def assign(self, request, pk=None):
        """Assign a handler to the request. Department manager only."""
        request_obj: SupportRequest = self.get_object()
        serializer = SupportRequestAssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        handler = serializer.validated_data['assigned_to']

        with transaction.atomic():
            request_obj.assigned_to = handler
            request_obj.assigned_by = request.user
            request_obj.status = 'assigned'
            request_obj.save(update_fields=['assigned_to', 'assigned_by', 'status', 'updated_at'])

            SupportComment.objects.create(
                request=request_obj,
                author=request.user,
                body=f'Assigned to {handler.get_full_name() or handler.username}.',
                is_system=True,
            )

        notify_request_assigned(request_obj)

        output = SupportRequestDetailSerializer(request_obj, context={'request': request})
        return Response(output.data)

    @action(detail=True, methods=['post'], url_path='update-status')
    def update_status(self, request, pk=None):
        """Update request status. Assigned handler or department manager."""
        request_obj: SupportRequest = self.get_object()
        serializer = SupportRequestStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            updated = update_request_status(
                request_obj,
                serializer.validated_data['status'],
                user=request.user,
            )
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        output = SupportRequestDetailSerializer(updated, context={'request': request})
        return Response(output.data)

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        """Mark request as resolved. Assigned handler only."""
        request_obj: SupportRequest = self.get_object()

        try:
            updated = update_request_status(
                request_obj,
                'resolved',
                user=request.user,
                comment_body='Request marked as resolved.',
            )
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        notify_request_resolved(updated)

        output = SupportRequestDetailSerializer(updated, context={'request': request})
        return Response(output.data)

    @action(detail=True, methods=['post'])
    def confirm(self, request, pk=None):
        """Requester confirms resolution. Closes the request."""
        request_obj: SupportRequest = self.get_object()

        if request_obj.status != 'resolved':
            return Response(
                {'error': 'Only resolved requests can be confirmed.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            update_request_status(
                request_obj,
                'closed',
                user=request.user,
                comment_body='Requester confirmed resolution. Request closed.',
            )
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        output = SupportRequestDetailSerializer(request_obj, context={'request': request})
        return Response(output.data)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        """Requester reopens a resolved/closed request."""
        request_obj: SupportRequest = self.get_object()

        if request_obj.status not in ('resolved', 'closed'):
            return Response(
                {'error': 'Only resolved or closed requests can be reopened.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            update_request_status(
                request_obj,
                'open',
                user=request.user,
                comment_body='Requester reopened this request.',
            )
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # Clear assignment on reopen
        request_obj.assigned_to = None
        request_obj.assigned_by = None
        request_obj.save(update_fields=['assigned_to', 'assigned_by', 'updated_at'])

        output = SupportRequestDetailSerializer(request_obj, context={'request': request})
        return Response(output.data)

    @action(detail=True, methods=['post'], url_path='add-comment')
    def add_comment(self, request, pk=None):
        """Add a comment to the request."""
        request_obj: SupportRequest = self.get_object()
        serializer = SupportCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        comment = SupportComment.objects.create(
            request=request_obj,
            author=request.user,
            body=serializer.validated_data['body'],
        )

        notify_comment_added(comment)

        comment_serializer = SupportCommentSerializer(comment, context={'request': request})
        return Response(comment_serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'], url_path='upload-url')
    def upload_url(self, request, pk=None):
        """Generate a presigned S3 URL for attachment upload."""
        request_obj: SupportRequest = self.get_object()
        serializer = SupportAttachmentUploadRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = generate_support_attachment_upload_url(
                request_id=request_obj.id,
                file_name=serializer.validated_data['file_name'],
                content_type=serializer.validated_data['content_type'],
            )
        except SupportAttachmentStorageError as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response(result)

    @action(detail=True, methods=['post'], url_path='confirm-upload')
    def confirm_upload(self, request, pk=None):
        """Confirm an attachment was uploaded to S3 and create the record."""
        request_obj: SupportRequest = self.get_object()
        serializer = SupportAttachmentConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data

        # Determine where to attach — if a comment_id was provided, attach to comment
        comment_id = request.data.get('comment_id')
        comment = None
        if comment_id:
            comment = get_object_or_404(SupportComment, id=comment_id, request=request_obj)

        attachment = SupportAttachment.objects.create(
            request=comment.request if comment else request_obj,
            comment=comment,
            object_key=data['object_key'],
            file_name=data['file_name'],
            content_type=data['content_type'],
            size=data['size'],
        )

        # If no comment, attach to the request directly
        if not comment:
            attachment.request = request_obj
            attachment.comment = None
            attachment.save(update_fields=['request', 'comment'])

        output = SupportAttachmentSerializer(attachment, context={'request': request})
        return Response(output.data, status=status.HTTP_201_CREATED)

    @action(detail=False, methods=['get'])
    def department(self, request):
        """List all requests for the user's department (manager view)."""
        if not user_is_any_department_manager(request.user):
            return Response(
                {'error': 'Department manager access required.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        from accounts.models import StaffProfile
        try:
            profile = request.user.staff_profile
        except StaffProfile.DoesNotExist:
            return Response(
                {'error': 'Staff profile not found.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not profile.department:
            return Response(
                {'error': 'You are not assigned to any department.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        requests_qs = SupportRequest.objects.filter(
            department=profile.department
        ).select_related('requester', 'department', 'assigned_to').order_by('-created_at')

        page = self.paginate_queryset(requests_qs)
        if page is not None:
            serializer = SupportRequestListSerializer(page, many=True, context={'request': request})
            return self.get_paginated_response(serializer.data)

        serializer = SupportRequestListSerializer(requests_qs, many=True, context={'request': request})
        return Response(serializer.data)
