"""Service requests: what Tourism / Operations used to send as approval emails.

A request is checked when it is submitted and goes straight through, except a
credit request that would take the client below zero, which needs two
approvals (first stage, then the ED). The submitter marks it completed once
the service is delivered (for a ticket: once it is issued).

Only tickets exist so far (client and affiliate tickets share one form). Each
service has its own details model (TicketDetails) next to the shared
ServiceRequest.
"""

import uuid

from django.conf import settings
from django.db import models

from common.models import CreatedAtModel, TimeStampedModel

MONEY = {'max_digits': 18, 'decimal_places': 2}


class Service(models.TextChoices):
    TICKET = 'ticket', 'Ticket'


# Reference prefix and title label for each service: TKT-2026-00042, [TICKET].
SERVICE_CODES = {
    Service.TICKET: ('TKT', 'TICKET'),
}


class Audience(TimeStampedModel):
    """Who takes part in a service, and how. Admins edit these in Django admin,
    so people can be added or removed without a release.

    A row names a group of people: the members of a unit, a unit's supervisor,
    a department's line manager, or everyone with a role.
    """

    class Purpose(models.TextChoices):
        SUBMIT = 'submit', 'Can submit'
        VIEW = 'view', 'Can view every request'
        NOTIFY = 'notify', 'Notified of every request'
        FIRST_APPROVAL = 'first_approval', 'Gives the first approval'
        FINAL_APPROVAL = 'final_approval', 'Gives the final approval'

    class Kind(models.TextChoices):
        UNIT_MEMBERS = 'unit_members', 'Members of a unit'
        UNIT_SUPERVISOR = 'unit_supervisor', "A unit's supervisor"
        DEPARTMENT_MANAGER = 'department_manager', "A department's line manager"
        ROLE = 'role', 'Everyone with a role'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    service = models.CharField(max_length=20, choices=Service.choices)
    purpose = models.CharField(max_length=20, choices=Purpose.choices)
    kind = models.CharField(max_length=20, choices=Kind.choices)
    unit = models.ForeignKey('organization.Unit', on_delete=models.CASCADE, null=True, blank=True, related_name='+')
    department = models.ForeignKey(
        'organization.Department', on_delete=models.CASCADE, null=True, blank=True, related_name='+',
    )
    role = models.ForeignKey('organization.Role', on_delete=models.CASCADE, null=True, blank=True, related_name='+')
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['service', 'purpose', 'kind']
        constraints = [
            models.CheckConstraint(
                name='audience_target_matches_kind',
                condition=(
                    models.Q(kind__in=['unit_members', 'unit_supervisor'], unit__isnull=False)
                    | models.Q(kind='department_manager', department__isnull=False)
                    | models.Q(kind='role', role__isnull=False)
                ),
            ),
        ]

    def __str__(self):
        target = self.unit or self.department or self.role
        return f'{self.get_service_display()}: {self.get_purpose_display()} - {self.get_kind_display()} ({target})'


class ServiceRequest(TimeStampedModel):
    class Status(models.TextChoices):
        SUBMITTED = 'submitted', 'Submitted'
        PENDING_APPROVAL = 'pending_approval', 'Pending approval'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    class PaymentType(models.TextChoices):
        CASH = 'cash', 'Cash'
        CREDIT = 'credit', 'Credit'

    class PartyType(models.TextChoices):
        CLIENT = 'client', 'Client'
        AFFILIATE = 'affiliate', 'Affiliate'

    class ApprovalStage(models.TextChoices):
        NONE = '', 'None'
        FIRST = 'first', 'First approval'
        FINAL = 'final', 'Final approval'

    OPEN_STATUSES = (Status.SUBMITTED, Status.PENDING_APPROVAL, Status.APPROVED)

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    service = models.CharField(max_length=20, choices=Service.choices)
    reference = models.CharField(max_length=20, unique=True)
    # [TICKET] Client: [AFRIWINGS_STELLA CHIZENA ENOCK | Amount: ₦149,300], fixed at submission.
    title = models.CharField(max_length=400)
    status = models.CharField(max_length=20, choices=Status.choices)
    approval_stage = models.CharField(max_length=10, choices=ApprovalStage.choices, default='', blank=True)

    payment_type = models.CharField(max_length=10, choices=PaymentType.choices)
    party_type = models.CharField(max_length=10, choices=PartyType.choices)
    client = models.ForeignKey(
        'clients.CreditClient', on_delete=models.PROTECT, null=True, blank=True, related_name='service_requests',
    )
    # The client's or affiliate's name: typed for cash, the credit client's name for credit.
    client_name = models.CharField(max_length=200)

    # Pricing, in Naira.
    selling_price = models.DecimalField(**MONEY)
    cost_price = models.DecimalField(**MONEY)
    revenue = models.DecimalField(**MONEY)
    # "Amount in other currencies" and the rate used, when there is one.
    foreign_currency = models.CharField(max_length=3, blank=True)
    foreign_amount = models.DecimalField(**MONEY, null=True, blank=True)
    exchange_rate = models.DecimalField(max_digits=18, decimal_places=6, null=True, blank=True)

    # Cash: what the client paid, and the proof (an image or a PDF in private storage).
    amount_paid = models.DecimalField(**MONEY, null=True, blank=True)
    evidence_key = models.CharField(max_length=500, blank=True)
    evidence_name = models.CharField(max_length=255, blank=True)
    evidence_type = models.CharField(max_length=100, blank=True)
    evidence_size = models.PositiveIntegerField(null=True, blank=True)

    # Credit: what the request takes from the client's balance (in the client's
    # currency) and the client's credit status when it was submitted.
    requested_amount = models.DecimalField(**MONEY, null=True, blank=True)
    requested_currency = models.CharField(max_length=3, blank=True)
    credit_limit_at_submit = models.DecimalField(**MONEY, null=True, blank=True)
    utilization_at_submit = models.DecimalField(**MONEY, null=True, blank=True)
    # Whether requested_amount has been added to the client's utilization (and
    # so must be given back if the request is cancelled).
    utilization_applied = models.BooleanField(default=False)

    submitted_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    # "New request from this one": the cancelled request it was copied from.
    created_from = models.ForeignKey('self', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    completed_at = models.DateTimeField(null=True, blank=True)
    closed_reason = models.TextField(blank=True)  # why it was cancelled or rejected

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['status', '-created_at']), models.Index(fields=['service', '-created_at'])]

    def __str__(self):
        return f'{self.reference} {self.title}'

    @property
    def available_at_submit(self):
        if self.credit_limit_at_submit is None or self.utilization_at_submit is None:
            return None
        return self.credit_limit_at_submit - self.utilization_at_submit

    @property
    def balance_after_request(self):
        available = self.available_at_submit
        if available is None or self.requested_amount is None:
            return None
        return available - self.requested_amount


class TicketDetails(models.Model):
    request = models.OneToOneField(ServiceRequest, on_delete=models.CASCADE, primary_key=True, related_name='ticket')
    passengers = models.JSONField(default=list)
    airline = models.CharField(max_length=100)
    pnr = models.CharField('PNR', max_length=8)
    # The PNR while the request is open or completed, empty once it is cancelled
    # or rejected. Unique, so two live requests can never share a PNR.
    active_pnr = models.CharField(max_length=8, null=True, blank=True, unique=True)
    departure_date = models.DateField()
    return_date = models.DateField(null=True, blank=True)
    route = models.CharField(max_length=100)
    vendor = models.CharField(max_length=150)
    # The optional discount section (required for affiliates).
    published_fare = models.DecimalField(**MONEY, null=True, blank=True)
    net_commission = models.DecimalField(**MONEY, null=True, blank=True)
    commission_given = models.DecimalField(**MONEY, null=True, blank=True)
    balance_commission = models.DecimalField(**MONEY, null=True, blank=True)

    def __str__(self):
        return f'{self.pnr} ({self.route})'


class ApprovalDecision(CreatedAtModel):
    class Decision(models.TextChoices):
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.ForeignKey(ServiceRequest, on_delete=models.CASCADE, related_name='decisions')
    stage = models.CharField(max_length=10, choices=ServiceRequest.ApprovalStage.choices)
    decision = models.CharField(max_length=10, choices=Decision.choices)
    decided_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    reason = models.TextField(blank=True)

    class Meta:
        ordering = ['created_at']


class RequestEvent(CreatedAtModel):
    """The request's history, shown on its page."""

    class Action(models.TextChoices):
        SUBMITTED = 'submitted', 'Submitted'
        SENT_FOR_APPROVAL = 'sent_for_approval', 'Sent for approval'
        FIRST_APPROVED = 'first_approved', 'First approval given'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    request = models.ForeignKey(ServiceRequest, on_delete=models.CASCADE, related_name='events')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    action = models.CharField(max_length=20, choices=Action.choices)
    note = models.TextField(blank=True)

    class Meta:
        ordering = ['-created_at']


class ReferenceCounter(models.Model):
    """The last number used for a service in a year (TKT-2026-00042)."""

    service = models.CharField(max_length=20, choices=Service.choices)
    year = models.PositiveIntegerField()
    last = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['service', 'year'], name='reference_counter_unique')]
