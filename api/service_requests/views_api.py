from uuid import uuid4

from django.conf import settings
from django.db.models import Count, Q
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from common.exceptions import ServiceUnavailable
from common.pagination import StandardPagination, paginate
from common.params import bool_param, choice_param
from common.storage import file_suffix, presigned_download_url, s3_client
from common.viewsets import GenericViewSet, ListModelMixin, RetrieveModelMixin

from . import access, services
from .models import RequestEvent, Service, ServiceRequest, TicketDetails
from .serializers import (
    EvidenceUploadSerializer,
    ReasonSerializer,
    RequestEventSerializer,
    ServiceRequestDetailSerializer,
    ServiceRequestListSerializer,
)
from .validation import EVIDENCE_MAX_BYTES, EVIDENCE_TYPES, TicketRequestSerializer


class CanViewRequests(BasePermission):
    def has_permission(self, request, _view):
        return access.can_view_requests(request.user)


def awaiting(user):
    """Requests at a stage this user approves, not their own."""
    stages = [stage for stage in ('first', 'final') if access.can_approve(user, stage)]
    if not stages:
        return ServiceRequest.objects.none()
    return ServiceRequest.objects.filter(
        status=ServiceRequest.Status.PENDING_APPROVAL, approval_stage__in=stages,
    ).exclude(submitted_by=user)


class ServiceRequestViewSet(ListModelMixin, RetrieveModelMixin, GenericViewSet):
    """Every request, for everyone involved. Creating goes through the
    service's own endpoint (`tickets`); changes are the actions below."""

    permission_classes = [IsAuthenticated, CanViewRequests]
    pagination_class = StandardPagination
    lookup_value_converter = 'uuid'

    def get_queryset(self):
        if self.action != 'list':
            # Opening or acting on a request ignores the list's filters.
            return ServiceRequest.objects.select_related('submitted_by', 'ticket', 'client').prefetch_related(
                'decisions__decided_by',
            )
        params = self.request.query_params
        queryset = awaiting(self.request.user) if bool_param(params, 'awaiting_me') else ServiceRequest.objects.all()
        queryset = queryset.select_related('submitted_by', 'ticket')
        search = (params.get('search') or '').strip()
        if search:
            queryset = queryset.filter(
                Q(reference__icontains=search) | Q(client_name__icontains=search) | Q(title__icontains=search)
                | Q(ticket__pnr__icontains=search.replace(' ', ''))
            )
        status = choice_param(params, 'status', set(ServiceRequest.Status.values))
        if status:
            queryset = queryset.filter(status=status)
        payment_type = choice_param(params, 'payment_type', set(ServiceRequest.PaymentType.values))
        if payment_type:
            queryset = queryset.filter(payment_type=payment_type)
        if bool_param(params, 'mine'):
            queryset = queryset.filter(submitted_by=self.request.user)
        return queryset.order_by('-created_at')

    def get_serializer_class(self):
        return ServiceRequestDetailSerializer if self.action != 'list' else ServiceRequestListSerializer

    def _detail(self, obj):
        obj = ServiceRequest.objects.select_related('submitted_by', 'ticket', 'client').prefetch_related(
            'decisions__decided_by',
        ).get(pk=obj.pk)
        return Response(ServiceRequestDetailSerializer(obj, context={'request': self.request}).data)

    @action(detail=False, methods=['post'])
    def tickets(self, request):
        serializer = TicketRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.check_pnr_free(serializer.validated_data['pnr'])
        created = services.create_ticket(serializer.validated_data, user=request.user, request=request)
        response = self._detail(created)
        response.status_code = 201
        return response

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        return self._detail(services.approve(self.get_object(), user=request.user, request=request))

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        body = ReasonSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return self._detail(
            services.reject(self.get_object(), user=request.user, reason=body.validated_data['reason'], request=request)
        )

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        return self._detail(services.complete(self.get_object(), user=request.user, request=request))

    @action(detail=True, methods=['post'])
    def cancel(self, request, pk=None):
        body = ReasonSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        return self._detail(
            services.cancel(self.get_object(), user=request.user, reason=body.validated_data['reason'], request=request)
        )

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        obj = self.get_object()
        events = RequestEvent.objects.filter(request=obj).select_related('actor')
        return paginate(events, request, RequestEventSerializer, view=self)

    @action(detail=True, methods=['get'])
    def evidence(self, request, pk=None):
        obj = self.get_object()
        if not obj.evidence_key:
            raise ValidationError({'evidence': 'This request has no payment evidence.'})
        url = presigned_download_url(obj.evidence_key, file_name=obj.evidence_name, content_type=obj.evidence_type)
        if not url:
            raise ServiceUnavailable('The file cannot be opened right now. Please try again.')
        return Response({'url': url})

    @action(detail=False, methods=['get'], url_path='awaiting-count')
    def awaiting_count(self, request):
        return Response({'count': awaiting(request.user).count()})


class EvidenceUploadUrlView(APIView):
    """A short-lived link to upload payment evidence before submitting."""

    permission_classes = [IsAuthenticated]
    throttle_scope = 'service_request_upload'

    def post(self, request):
        if not access.can_submit(request.user, Service.TICKET):
            raise PermissionDenied('Only Tourism / Operations can submit ticket requests.')
        body = EvidenceUploadSerializer(data=request.data)
        body.is_valid(raise_exception=True)
        content_type = body.validated_data['content_type'].split(';')[0].strip().lower()
        if content_type not in EVIDENCE_TYPES:
            raise ValidationError({'content_type': 'Payment evidence must be an image or a PDF.'})
        if body.validated_data['size'] > EVIDENCE_MAX_BYTES:
            raise ValidationError({'size': 'Payment evidence must be 5 MB or smaller.'})
        bucket = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
        if not bucket:
            raise ServiceUnavailable('File storage is not configured.')
        key = f'{services.evidence_prefix(request.user)}{uuid4().hex}{file_suffix(body.validated_data["file_name"])}'
        try:
            url = s3_client().generate_presigned_url(
                ClientMethod='put_object',
                Params={'Bucket': bucket, 'Key': key, 'ContentType': content_type},
                ExpiresIn=900,
            )
        except Exception:
            raise ServiceUnavailable('An upload link could not be created. Please try again.')
        return Response({'upload_url': url, 'object_key': key, 'content_type': content_type})


class SuggestionsView(APIView):
    """Airlines or vendors used on earlier requests, most used first, for the form's suggestions."""

    permission_classes = [IsAuthenticated, CanViewRequests]

    def get(self, request):
        field = choice_param(request.query_params, 'field', {'airline', 'vendor'})
        if not field:
            raise ValidationError({'field': 'Must be airline or vendor.'})
        queryset = TicketDetails.objects.all()
        search = (request.query_params.get('search') or '').strip()
        if search:
            queryset = queryset.filter(**{f'{field}__icontains': search})
        values = queryset.values(field).annotate(uses=Count('request')).order_by('-uses', field)
        paginator = StandardPagination()
        page = paginator.paginate_queryset(values, request, view=self)
        return paginator.get_paginated_response([row[field] for row in page])
