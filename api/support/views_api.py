import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import models, transaction
from django.shortcuts import get_object_or_404
from rest_framework import mixins, status
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.viewsets import GenericViewSet

from common.pagination import page_size
from common.params import choice_param, uuid_param
from common.uploads import checked_upload
from common.users import display_name

from .models import SupportAttachment, SupportComment, SupportRequest
from .permissions import (
    CanComment,
    CanManageDepartmentRequests,
    CanViewRequest,
    IsHandlerOrDepartmentManager,
    IsRequester,
    user_is_any_department_manager,
)
from .s3 import (
    SupportAttachmentStorageError,
    generate_support_attachment_upload_url,
    support_attachment_key_prefix,
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
    get_requester_line_manager,
    notify_comment_added,
    notify_request_assigned,
    notify_request_closed,
    notify_request_resolved,
    notify_request_submitted,
    route_support_request,
    update_request_status,
)

logger = logging.getLogger(__name__)


REQUEST_STATUSES = {value for value, _label in SupportRequest.STATUS_CHOICES}


class SupportRequestViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    GenericViewSet,
):
    """Support requests.

    A request can be listed, opened and created. It only changes through the
    workflow actions below (assign, status, resolve, confirm, reopen), which
    check who may act, enforce the allowed transitions and leave a record, so
    there is deliberately no update or delete.
    """

    lookup_value_converter = 'uuid'

    permission_classes = [IsAuthenticated]
    pagination_class = page_size(10)
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'support'
    def get_queryset(self):
        """The requests the caller is involved in: ones they raised, ones assigned
        to them, ones routed to a department they manage, and ones raised by
        people they were line manager of at the time."""
        user = self.request.user
        qs = SupportRequest.objects.filter(
            models.Q(requester=user)
            | models.Q(assigned_to=user)
            | models.Q(department__line_manager=user)
            | models.Q(line_manager=user)
        )

        status_param = choice_param(self.request.query_params, 'status', REQUEST_STATUSES)
        if status_param:
            qs = qs.filter(status=status_param)

        return qs.distinct().select_related('requester', 'department', 'assigned_to').order_by('-created_at')

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
                body=f'Assigned to {display_name(handler)}.',
                is_system=True,
            )

        notify_request_assigned(request_obj)

        output = SupportRequestDetailSerializer(request_obj, context={'request': request})
        return Response(output.data)

    @action(detail=True, methods=['post'], url_path='status', url_name='status')
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
        except DjangoValidationError as e:
            raise ValidationError(e.messages)

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
        except DjangoValidationError as e:
            raise ValidationError(e.messages)

        notify_request_resolved(updated)

        output = SupportRequestDetailSerializer(updated, context={'request': request})
        return Response(output.data)

    @action(detail=True, methods=['post'])
    def confirm(self, request, pk=None):
        """Requester confirms resolution. Closes the request."""
        request_obj: SupportRequest = self.get_object()

        if request_obj.status != 'resolved':
            raise ValidationError('Only resolved requests can be confirmed.')

        try:
            updated = update_request_status(
                request_obj,
                'closed',
                user=request.user,
                comment_body='Requester confirmed resolution. Request closed.',
            )
        except DjangoValidationError as e:
            raise ValidationError(e.messages)

        notify_request_closed(updated)

        output = SupportRequestDetailSerializer(updated, context={'request': request})
        return Response(output.data)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        """Requester reopens a resolved/closed request."""
        request_obj: SupportRequest = self.get_object()

        if request_obj.status not in ('resolved', 'closed'):
            raise ValidationError('Only resolved or closed requests can be reopened.')

        # Both changes happen together or not at all.
        with transaction.atomic():
            try:
                update_request_status(
                    request_obj,
                    'open',
                    user=request.user,
                    comment_body='Requester reopened this request.',
                )
            except DjangoValidationError as e:
                raise ValidationError(e.messages)

            request_obj.assigned_to = None
            request_obj.assigned_by = None
            request_obj.save(update_fields=['assigned_to', 'assigned_by', 'updated_at'])

        output = SupportRequestDetailSerializer(request_obj, context={'request': request})
        return Response(output.data)

    @action(detail=True, methods=['post'], url_path='comments', url_name='comments')
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

    @action(detail=True, methods=['post'], url_path='attachment-upload-url', url_name='attachment-upload-url')
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
            raise ValidationError(str(e))

        return Response(result)

    @action(detail=True, methods=['post'], url_path='attachments', url_name='attachments')
    def confirm_upload(self, request, pk=None):
        """Confirm an attachment was uploaded to S3 and create the record."""
        request_obj: SupportRequest = self.get_object()
        serializer = SupportAttachmentConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        data = serializer.validated_data

        # A file can only be attached to the request it was uploaded for, and
        # only once.
        if not data['object_key'].startswith(support_attachment_key_prefix(request_obj.id)):
            raise ValidationError({'object_key': ['This file does not belong to this request.']})
        if SupportAttachment.objects.filter(object_key=data['object_key']).exists():
            raise ValidationError({'object_key': ['This file is already attached.']})
        data['size'], data['content_type'] = checked_upload(
            data['object_key'],
            field='object_key',
            claimed_size=data['size'],
            claimed_type=data['content_type'],
        )

        # Determine where to attach — if a comment_id was provided, attach to comment
        comment_id = uuid_param(request.data, 'comment_id')
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
        """The queue of every department the caller manages."""
        if not user_is_any_department_manager(request.user):
            raise PermissionDenied('Department manager access required.')

        requests_qs = (
            SupportRequest.objects.filter(department__line_manager=request.user)
            .select_related('requester', 'department', 'assigned_to')
            .order_by('-created_at')
        )

        status_param = choice_param(request.query_params, 'status', REQUEST_STATUSES)
        if status_param:
            requests_qs = requests_qs.filter(status=status_param)

        page = self.paginate_queryset(requests_qs)
        serializer = SupportRequestListSerializer(page, many=True, context={'request': request})
        return self.get_paginated_response(serializer.data)
