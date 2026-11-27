from django.db.models.functions import Lower
from rest_framework import serializers

from common.serializers import UserSummarySerializer

from .models import CreditClient, CreditClientChange, CreditClientImport
from .validation import CLEANERS, FieldError

MONEY_FIELDS = ('credit_limit', 'credit_utilization')


class CreditClientSerializer(serializers.ModelSerializer):
    available_balance = serializers.SerializerMethodField()
    created_by = UserSummarySerializer(read_only=True)
    updated_by = UserSummarySerializer(read_only=True)

    class Meta:
        model = CreditClient
        fields = [
            'id', 'name', 'tin', 'contact_person', 'phone', 'email', 'address',
            'credit_limit', 'credit_days', 'credit_utilization', 'available_balance',
            'currency', 'status', 'notes', 'created_by', 'updated_by', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_available_balance(self, obj):
        return f'{obj.available_balance:.2f}'


class _CleanedField(serializers.Field):
    """Runs the shared rule for one field (clients.validation), the same one the import uses."""

    def __init__(self, field, **kwargs):
        self.rule = CLEANERS[field]
        self.money = field in MONEY_FIELDS
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        try:
            return self.rule(data)
        except FieldError as error:
            raise serializers.ValidationError(str(error))

    def to_representation(self, value):
        return f'{value:.2f}' if self.money else value


class CreditClientWriteSerializer(serializers.ModelSerializer):
    """Create (name, TIN, contact person, phone, email, credit limit and credit days
    required) and partial update."""

    name = _CleanedField('name')
    tin = _CleanedField('tin')
    contact_person = _CleanedField('contact_person')
    phone = _CleanedField('phone')
    email = _CleanedField('email')
    address = _CleanedField('address', required=False)
    credit_limit = _CleanedField('credit_limit')
    credit_days = _CleanedField('credit_days')
    credit_utilization = _CleanedField('credit_utilization', required=False)
    currency = _CleanedField('currency', required=False)
    status = _CleanedField('status', required=False)
    notes = _CleanedField('notes', required=False)

    class Meta:
        model = CreditClient
        fields = [
            'name', 'tin', 'contact_person', 'phone', 'email', 'address', 'credit_limit',
            'credit_days', 'credit_utilization', 'currency', 'status', 'notes',
        ]

    def _others(self):
        queryset = CreditClient.objects.all()
        if self.instance is not None:
            queryset = queryset.exclude(pk=self.instance.pk)
        return queryset

    def validate_name(self, value):
        if self._others().annotate(name_key=Lower('name')).filter(name_key=value.lower()).exists():
            raise serializers.ValidationError('A client with this name already exists.')
        return value

    def validate_tin(self, value):
        if self._others().filter(tin=value).exists():
            raise serializers.ValidationError('A client with this TIN already exists.')
        return value


class CreditClientChangeSerializer(serializers.ModelSerializer):
    changed_by = UserSummarySerializer(read_only=True)
    file_name = serializers.CharField(source='client_import.file_name', default=None, read_only=True)

    class Meta:
        model = CreditClientChange
        fields = ['id', 'source', 'changed_by', 'changes', 'file_name', 'note', 'created_at']
        read_only_fields = fields


class CreditClientImportSerializer(serializers.ModelSerializer):
    uploaded_by = UserSummarySerializer(read_only=True)

    class Meta:
        model = CreditClientImport
        fields = [
            'id', 'file_name', 'uploaded_by', 'rows', 'created_count', 'updated_count', 'rejected_count', 'created_at',
        ]
        read_only_fields = fields
