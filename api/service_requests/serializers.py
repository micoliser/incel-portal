from rest_framework import serializers

from common.serializers import UserSummarySerializer

from . import services
from .models import ApprovalDecision, RequestEvent, ServiceRequest, TicketDetails


def _money(value):
    return None if value is None else f'{value:.2f}'


class TicketDetailsSerializer(serializers.ModelSerializer):
    published_fare = serializers.SerializerMethodField()
    net_commission = serializers.SerializerMethodField()
    commission_given = serializers.SerializerMethodField()
    balance_commission = serializers.SerializerMethodField()

    class Meta:
        model = TicketDetails
        fields = [
            'passengers', 'airline', 'pnr', 'departure_date', 'return_date', 'route', 'vendor',
            'published_fare', 'net_commission', 'commission_given', 'balance_commission',
        ]

    def get_published_fare(self, obj):
        return _money(obj.published_fare)

    def get_net_commission(self, obj):
        return _money(obj.net_commission)

    def get_commission_given(self, obj):
        return _money(obj.commission_given)

    def get_balance_commission(self, obj):
        return _money(obj.balance_commission)


class ServiceRequestListSerializer(serializers.ModelSerializer):
    submitted_by = UserSummarySerializer(read_only=True)
    selling_price = serializers.SerializerMethodField()
    passengers = serializers.SerializerMethodField()
    pnr = serializers.SerializerMethodField()

    class Meta:
        model = ServiceRequest
        fields = [
            'id', 'service', 'reference', 'title', 'status', 'approval_stage', 'payment_type', 'party_type',
            'client_name', 'selling_price', 'passengers', 'pnr', 'submitted_by', 'created_at', 'updated_at',
        ]
        read_only_fields = fields

    def get_selling_price(self, obj):
        return _money(obj.selling_price)

    def _ticket(self, obj):
        return getattr(obj, 'ticket', None)

    def get_passengers(self, obj):
        ticket = self._ticket(obj)
        return ticket.passengers if ticket else []

    def get_pnr(self, obj):
        ticket = self._ticket(obj)
        return ticket.pnr if ticket else ''


class ApprovalDecisionSerializer(serializers.ModelSerializer):
    decided_by = UserSummarySerializer(read_only=True)

    class Meta:
        model = ApprovalDecision
        fields = ['id', 'stage', 'decision', 'decided_by', 'reason', 'created_at']
        read_only_fields = fields


class ServiceRequestDetailSerializer(ServiceRequestListSerializer):
    ticket = TicketDetailsSerializer(read_only=True)
    client_id = serializers.UUIDField(read_only=True)
    cost_price = serializers.SerializerMethodField()
    revenue = serializers.SerializerMethodField()
    foreign_amount = serializers.SerializerMethodField()
    exchange_rate = serializers.SerializerMethodField()
    amount_paid = serializers.SerializerMethodField()
    evidence = serializers.SerializerMethodField()
    credit = serializers.SerializerMethodField()
    decisions = ApprovalDecisionSerializer(many=True, read_only=True)
    allowed = serializers.SerializerMethodField()

    class Meta(ServiceRequestListSerializer.Meta):
        fields = ServiceRequestListSerializer.Meta.fields + [
            'ticket', 'client_id', 'cost_price', 'revenue', 'foreign_currency', 'foreign_amount', 'exchange_rate',
            'amount_paid', 'evidence', 'credit', 'decisions', 'closed_reason', 'completed_at', 'created_from',
            'allowed',
        ]
        read_only_fields = fields

    def get_cost_price(self, obj):
        return _money(obj.cost_price)

    def get_revenue(self, obj):
        return _money(obj.revenue)

    def get_foreign_amount(self, obj):
        return _money(obj.foreign_amount)

    def get_exchange_rate(self, obj):
        return None if obj.exchange_rate is None else f'{obj.exchange_rate.normalize():f}'

    def get_amount_paid(self, obj):
        return _money(obj.amount_paid)

    def get_evidence(self, obj):
        if not obj.evidence_key:
            return None
        return {
            'object_key': obj.evidence_key, 'file_name': obj.evidence_name,
            'content_type': obj.evidence_type, 'size': obj.evidence_size,
        }

    def get_credit(self, obj):
        if obj.requested_amount is None:
            return None
        return {
            'currency': obj.requested_currency,
            'credit_limit': _money(obj.credit_limit_at_submit),
            'utilization': _money(obj.utilization_at_submit),
            'available_balance': _money(obj.available_at_submit),
            'requested_amount': _money(obj.requested_amount),
            'balance_after_request': _money(obj.balance_after_request),
        }

    def get_allowed(self, obj):
        """What the signed-in user may do with this request now."""
        user = self.context['request'].user
        mine = obj.submitted_by_id == user.pk
        decide = services.can_decide(user, obj)
        return {
            'approve': decide,
            'reject': decide,
            'complete': mine and obj.status in (ServiceRequest.Status.SUBMITTED, ServiceRequest.Status.APPROVED),
            'cancel': mine and obj.status in ServiceRequest.OPEN_STATUSES,
            'copy': mine and obj.status in (ServiceRequest.Status.CANCELLED, ServiceRequest.Status.REJECTED),
        }


class RequestEventSerializer(serializers.ModelSerializer):
    actor = UserSummarySerializer(read_only=True)

    class Meta:
        model = RequestEvent
        fields = ['id', 'action', 'actor', 'note', 'created_at']
        read_only_fields = fields


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=1000, trim_whitespace=True)


class EvidenceUploadSerializer(serializers.Serializer):
    file_name = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=100)
    size = serializers.IntegerField(min_value=1)
