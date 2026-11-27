import json

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import HttpResponse
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit import log_audit
from audit.actions import AuditAction
from common.exceptions import Conflict
from common.pagination import StandardPagination, paginate
from common.params import choice_param
from common.viewsets import (
    CreateModelMixin,
    GenericViewSet,
    ListModelMixin,
    PartialUpdateModelMixin,
    RetrieveModelMixin,
)

from . import importer
from .models import CreditClient, CreditClientChange, CreditClientImport, Currency
from .permissions import CanManageClients, CanViewOrManageClients
from .serializers import (
    CreditClientChangeSerializer,
    CreditClientImportSerializer,
    CreditClientSerializer,
    CreditClientWriteSerializer,
)

DUPLICATE_MESSAGE = 'A client with this name or TIN already exists.'


class CreditClientViewSet(ListModelMixin, RetrieveModelMixin, CreateModelMixin, PartialUpdateModelMixin, GenericViewSet):
    """Credit clients. Viewers can list and open them; managers can also add and edit.
    There is no delete: a client that is no longer used is set to inactive."""

    permission_classes = [IsAuthenticated, CanViewOrManageClients]
    pagination_class = StandardPagination
    lookup_value_converter = 'uuid'

    def get_queryset(self):
        queryset = CreditClient.objects.select_related('created_by', 'updated_by')
        params = self.request.query_params
        search = (params.get('search') or '').strip()
        if search:
            queryset = queryset.filter(
                Q(name__icontains=search) | Q(tin__icontains=search) | Q(contact_person__icontains=search)
                | Q(email__icontains=search)
            )
        status = choice_param(params, 'status', set(CreditClient.Status.values))
        if status:
            queryset = queryset.filter(status=status)
        currency = choice_param(params, 'currency', set(Currency.values))
        if currency:
            queryset = queryset.filter(currency=currency)
        return queryset.order_by('name')

    def get_serializer_class(self):
        if self.action in ('create', 'partial_update'):
            return CreditClientWriteSerializer
        return CreditClientSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            with transaction.atomic():
                client = serializer.save(created_by=request.user, updated_by=request.user)
                CreditClientChange.objects.create(
                    client=client, changed_by=request.user, source=CreditClientChange.Source.CREATED,
                )
        except IntegrityError:
            raise Conflict(DUPLICATE_MESSAGE)
        log_audit(
            action=AuditAction.CREDIT_CLIENT_CREATED, request=request, target_type='credit_client',
            target_id=client.id, metadata={'name': client.name, 'credit_limit': client.credit_limit},
        )
        return Response(CreditClientSerializer(client).data, status=201)

    def partial_update(self, request, *args, **kwargs):
        client = self.get_object()
        serializer = self.get_serializer(client, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        before = importer.client_values(client)
        try:
            with transaction.atomic():
                client = serializer.save(updated_by=request.user)
                changes = importer.changes_between(before, importer.client_values(client))
                if changes:
                    CreditClientChange.objects.create(
                        client=client, changed_by=request.user, source=CreditClientChange.Source.EDITED,
                        changes=changes,
                    )
        except IntegrityError:
            raise Conflict(DUPLICATE_MESSAGE)
        if changes:
            log_audit(
                action=AuditAction.CREDIT_CLIENT_UPDATED, request=request, target_type='credit_client',
                target_id=client.id, metadata={'name': client.name, 'changes': changes},
            )
        return Response(CreditClientSerializer(client).data)

    @action(detail=True, methods=['get'])
    def history(self, request, pk=None):
        client = self.get_object()
        queryset = client.changes.select_related('changed_by', 'client_import')
        return paginate(queryset, request, CreditClientChangeSerializer, view=self)


def _decisions(request):
    raw = request.data.get('decisions') or '{}'
    try:
        decisions = json.loads(raw) if isinstance(raw, str) else raw
    except ValueError:
        raise ValidationError({'decisions': 'Must be JSON.'})
    if not isinstance(decisions, dict):
        raise ValidationError({'decisions': 'Must be an object of {duplicate id: "reject" or a row number}.'})
    return {str(key): value for key, value in decisions.items()}


def _upload(request):
    upload = request.FILES.get('file')
    if upload is None:
        raise ValidationError({'file': 'Choose a spreadsheet to upload.'})
    return upload


class CreditClientImportPreviewView(APIView):
    """Check a spreadsheet and say what importing it would do. Saves nothing."""

    permission_classes = [IsAuthenticated, CanManageClients]
    parser_classes = [MultiPartParser]
    throttle_scope = 'credit_client_import'

    def post(self, request):
        try:
            analysis = importer.analyse(_upload(request))
        except importer.ImportFileError as error:
            raise ValidationError({'file': str(error)})
        return Response(analysis.as_dict())


class CreditClientImportConfirmView(APIView):
    """Import the same file with the uploader's decisions; all of it or nothing."""

    permission_classes = [IsAuthenticated, CanManageClients]
    parser_classes = [MultiPartParser]
    throttle_scope = 'credit_client_import'

    def post(self, request):
        if str(request.data.get('confirmed', '')).lower() != 'true':
            raise ValidationError({'confirmed': 'Confirm the notices before importing.'})
        try:
            record = importer.apply(_upload(request), decisions=_decisions(request), user=request.user)
        except importer.ImportFileError as error:
            raise ValidationError({'file': str(error)})
        except importer.ImportNotReady as error:
            raise Conflict(str(error))
        log_audit(
            action=AuditAction.CREDIT_CLIENTS_IMPORTED, request=request, target_type='credit_client_import',
            target_id=record.id,
            metadata={
                'file_name': record.file_name, 'created': record.created_count,
                'updated': record.updated_count, 'rejected': record.rejected_count,
            },
        )
        return Response(CreditClientImportSerializer(record).data, status=201)


class CreditClientImportTemplateView(APIView):
    permission_classes = [IsAuthenticated, CanManageClients]

    def get(self, request):
        response = HttpResponse(
            importer.template_workbook(),
            content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        response['Content-Disposition'] = 'attachment; filename="credit-clients-template.xlsx"'
        return response


class CreditClientImportListView(APIView):
    """Past imports: who uploaded what, when, and how many clients it added, updated and rejected."""

    permission_classes = [IsAuthenticated, CanViewOrManageClients]

    def get(self, request):
        queryset = CreditClientImport.objects.select_related('uploaded_by')
        return paginate(queryset, request, CreditClientImportSerializer)

