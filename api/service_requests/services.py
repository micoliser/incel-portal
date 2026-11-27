"""What happens to a service request, and who is told.

Every step runs in a transaction. A credit client's row is locked while its
balance is read and changed, so two requests cannot both spend the same
balance.
"""

import logging
from decimal import Decimal

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from audit import log_audit
from audit.actions import AuditAction
from clients.models import CreditClient, CreditClientChange
from common.exceptions import Conflict
from common.uploads import checked_upload
from common.users import display_name
from emails.services.base_email_service import BaseEmailService
from notifications.services import create_notification

from . import access
from .models import (
    SERVICE_CODES,
    ApprovalDecision,
    Audience,
    ReferenceCounter,
    RequestEvent,
    Service,
    ServiceRequest,
    TicketDetails,
)
from .validation import EVIDENCE_MAX_BYTES, EVIDENCE_TYPES

logger = logging.getLogger(__name__)
Status = ServiceRequest.Status


# Titles and references -----------------------------------------------------

def format_amount(amount):
    """₦149,300 for whole amounts, ₦149,300.50 otherwise."""
    if amount == amount.to_integral_value():
        return f'₦{int(amount):,}'
    return f'₦{amount:,.2f}'


def request_title(service, client_name, passengers, amount):
    """[TICKET] Client: [AFRIWINGS_STELLA CHIZENA ENOCK +1 | Amount: ₦149,300]"""
    label = SERVICE_CODES[service][1]
    passenger = passengers[0] if passengers else ''
    if len(passengers) > 1:
        passenger = f'{passenger} +{len(passengers) - 1}'
    party = f'{client_name}_{passenger}' if passenger else client_name
    return f'[{label}] Client: [{party} | Amount: {format_amount(amount)}]'


def next_reference(service):
    """TKT-2026-00042. Must run inside a transaction (the counter row is locked)."""
    year = timezone.localdate().year
    counter, _created = ReferenceCounter.objects.select_for_update().get_or_create(service=service, year=year)
    counter.last += 1
    counter.save(update_fields=['last'])
    return f'{SERVICE_CODES[service][0]}-{year}-{counter.last:05d}'


# Credit balance ------------------------------------------------------------

def _move_utilization(client_id, amount, *, user, note):
    """Add `amount` (negative to give back) to a locked client's utilization."""
    client = CreditClient.objects.select_for_update().get(pk=client_id)
    before = client.credit_utilization
    client.credit_utilization = max(Decimal('0'), before + amount)
    client.updated_by = user
    client.save(update_fields=['credit_utilization', 'updated_by', 'updated_at'])
    CreditClientChange.objects.create(
        client=client, changed_by=user, source=CreditClientChange.Source.REQUEST, note=note[:255],
        changes={'credit_utilization': [f'{before:.2f}', f'{client.credit_utilization:.2f}']},
    )
    return client


# Evidence ------------------------------------------------------------------

def evidence_prefix(user):
    prefix = getattr(settings, 'SERVICE_REQUEST_EVIDENCE_S3_PREFIX', 'service-request-evidence').strip('/')
    return f'{prefix or "service-request-evidence"}/{user.pk}/'


def _check_evidence(evidence, user):
    """The uploaded proof of payment: this user's, unused (except on their own
    cancelled or rejected requests, which "new request from this one" reuses),
    and an image or PDF of at most 5 MB."""
    key = evidence['object_key']
    if not key.startswith(evidence_prefix(user)):
        raise ValidationError({'evidence': ['This file was not uploaded by you. Upload the payment evidence again.']})
    used = ServiceRequest.objects.filter(evidence_key=key)
    if used.exclude(status__in=[Status.CANCELLED, Status.REJECTED], submitted_by=user).exists():
        raise ValidationError({'evidence': ['This file is already the evidence for another request.']})
    if not used.exists():
        evidence['size'], evidence['content_type'] = checked_upload(
            key, field='evidence', claimed_size=evidence['size'], claimed_type=evidence['content_type'],
            max_size=EVIDENCE_MAX_BYTES, allowed_types=EVIDENCE_TYPES,
        )
    return evidence


# Creating ------------------------------------------------------------------

def create_ticket(data, *, user, request=None):
    if not access.can_submit(user, Service.TICKET):
        raise PermissionDenied('Only Tourism / Operations can submit ticket requests.')
    evidence = _check_evidence(data['evidence'], user) if data.get('evidence') else None

    source = None
    if data.get('created_from'):
        source = ServiceRequest.objects.filter(
            pk=data['created_from'], submitted_by=user, status__in=[Status.CANCELLED, Status.REJECTED],
        ).first()

    try:
        with transaction.atomic():
            fields = dict(
                service=Service.TICKET,
                reference=next_reference(Service.TICKET),
                title=request_title(Service.TICKET, data['client_name'], data['passengers'], data['selling_price']),
                payment_type=data['payment_type'],
                party_type=data['party_type'],
                client_name=data['client_name'],
                selling_price=data['selling_price'],
                cost_price=data['cost_price'],
                revenue=data['revenue'],
                foreign_currency=data['foreign_currency'],
                foreign_amount=data.get('foreign_amount'),
                exchange_rate=data.get('exchange_rate'),
                amount_paid=data.get('amount_paid'),
                submitted_by=user,
                created_from=source,
                status=Status.SUBMITTED,
            )
            if evidence:
                fields.update(
                    evidence_key=evidence['object_key'], evidence_name=evidence['file_name'][:255],
                    evidence_type=evidence['content_type'], evidence_size=evidence['size'],
                )

            client = None
            if data['payment_type'] == ServiceRequest.PaymentType.CREDIT:
                # Lock the client so its balance cannot change until this request is saved.
                client = CreditClient.objects.select_for_update().get(pk=data['client'].pk)
                requested = data['foreign_amount'] if client.currency != 'NGN' else data['selling_price']
                fields.update(
                    client=client, requested_amount=requested, requested_currency=client.currency,
                    credit_limit_at_submit=client.credit_limit, utilization_at_submit=client.credit_utilization,
                )
                if client.available_balance - requested < 0:
                    fields.update(status=Status.PENDING_APPROVAL, approval_stage=ServiceRequest.ApprovalStage.FIRST)

            service_request = ServiceRequest.objects.create(**fields)
            TicketDetails.objects.create(
                request=service_request,
                passengers=data['passengers'],
                airline=data['airline'],
                pnr=data['pnr'],
                active_pnr=data['pnr'],
                departure_date=data['departure_date'],
                return_date=data.get('return_date'),
                route=data['route'],
                vendor=data['vendor'],
                published_fare=data.get('published_fare'),
                net_commission=data.get('net_commission'),
                commission_given=data.get('commission_given'),
                balance_commission=data.get('balance_commission'),
            )
            if client and service_request.status == Status.SUBMITTED:
                _move_utilization(
                    client.pk, service_request.requested_amount, user=user,
                    note=f'{service_request.reference} submitted',
                )
                service_request.utilization_applied = True
                service_request.save(update_fields=['utilization_applied'])

            pending = service_request.status == Status.PENDING_APPROVAL
            RequestEvent.objects.create(
                request=service_request, actor=user,
                action=RequestEvent.Action.SENT_FOR_APPROVAL if pending else RequestEvent.Action.SUBMITTED,
                note='Over the credit limit: needs approval.' if pending else '',
            )
            _audit(service_request, AuditAction.SERVICE_REQUEST_SUBMITTED, request, user)
            notify(service_request, 'approval_needed' if pending else 'submitted', actor=user)
    except IntegrityError:
        if TicketDetails.objects.filter(active_pnr=data['pnr']).exists():
            raise ValidationError({'pnr': ['Another request already uses this PNR.']})
        raise
    return service_request


def check_pnr_free(pnr):
    if TicketDetails.objects.filter(active_pnr=pnr).exists():
        raise ValidationError({'pnr': ['Another request already uses this PNR.']})


# Approvals -----------------------------------------------------------------

def _locked(service_request):
    return ServiceRequest.objects.select_for_update().get(pk=service_request.pk)


def can_decide(user, service_request):
    """Whether this user may approve or reject the request at its current stage."""
    if service_request.status != Status.PENDING_APPROVAL or service_request.submitted_by_id == user.pk:
        return False
    return access.can_approve(user, service_request.approval_stage, service_request.service)


def approve(service_request, *, user, request=None):
    with transaction.atomic():
        service_request = _locked(service_request)
        if not can_decide(user, service_request):
            raise PermissionDenied(_decide_refusal(service_request, user))
        stage = service_request.approval_stage
        ApprovalDecision.objects.create(
            request=service_request, stage=stage, decision=ApprovalDecision.Decision.APPROVED, decided_by=user,
        )
        if stage == ServiceRequest.ApprovalStage.FIRST:
            service_request.approval_stage = ServiceRequest.ApprovalStage.FINAL
            service_request.save(update_fields=['approval_stage', 'updated_at'])
            RequestEvent.objects.create(request=service_request, actor=user, action=RequestEvent.Action.FIRST_APPROVED)
            _audit(service_request, AuditAction.SERVICE_REQUEST_APPROVED, request, user, stage='first')
            notify(service_request, 'first_approved', actor=user)
            return service_request

        service_request.status = Status.APPROVED
        service_request.approval_stage = ServiceRequest.ApprovalStage.NONE
        if service_request.client_id and not service_request.utilization_applied:
            _move_utilization(
                service_request.client_id, service_request.requested_amount, user=user,
                note=f'{service_request.reference} approved',
            )
            service_request.utilization_applied = True
        service_request.save(update_fields=['status', 'approval_stage', 'utilization_applied', 'updated_at'])
        RequestEvent.objects.create(request=service_request, actor=user, action=RequestEvent.Action.APPROVED)
        _audit(service_request, AuditAction.SERVICE_REQUEST_APPROVED, request, user, stage='final')
        notify(service_request, 'approved', actor=user)
        return service_request


def reject(service_request, *, user, reason, request=None):
    with transaction.atomic():
        service_request = _locked(service_request)
        if not can_decide(user, service_request):
            raise PermissionDenied(_decide_refusal(service_request, user))
        ApprovalDecision.objects.create(
            request=service_request, stage=service_request.approval_stage,
            decision=ApprovalDecision.Decision.REJECTED, decided_by=user, reason=reason,
        )
        service_request.status = Status.REJECTED
        service_request.approval_stage = ServiceRequest.ApprovalStage.NONE
        service_request.closed_reason = reason
        service_request.save(update_fields=['status', 'approval_stage', 'closed_reason', 'updated_at'])
        _free_pnr(service_request)
        RequestEvent.objects.create(request=service_request, actor=user, action=RequestEvent.Action.REJECTED, note=reason)
        _audit(service_request, AuditAction.SERVICE_REQUEST_REJECTED, request, user)
        notify(service_request, 'rejected', actor=user)
        return service_request


def _decide_refusal(service_request, user):
    if service_request.status != Status.PENDING_APPROVAL:
        return 'This request is not waiting for approval.'
    if service_request.submitted_by_id == user.pk:
        return 'You cannot approve or reject your own request.'
    if service_request.approval_stage == ServiceRequest.ApprovalStage.FINAL:
        return 'This request is waiting for the final approval, which only the ED gives.'
    return 'You are not one of the first-stage approvers.'


# The submitter's actions ---------------------------------------------------

def complete(service_request, *, user, request=None):
    with transaction.atomic():
        service_request = _locked(service_request)
        if service_request.submitted_by_id != user.pk:
            raise PermissionDenied('Only the person who submitted this request can mark it completed.')
        if service_request.status not in (Status.SUBMITTED, Status.APPROVED):
            raise Conflict(
                'This request is waiting for approval and cannot be completed yet.'
                if service_request.status == Status.PENDING_APPROVAL
                else f'This request is {service_request.get_status_display().lower()} and cannot be completed.'
            )
        service_request.status = Status.COMPLETED
        service_request.completed_at = timezone.now()
        service_request.save(update_fields=['status', 'completed_at', 'updated_at'])
        RequestEvent.objects.create(request=service_request, actor=user, action=RequestEvent.Action.COMPLETED)
        _audit(service_request, AuditAction.SERVICE_REQUEST_COMPLETED, request, user)
        notify(service_request, 'completed', actor=user)
        return service_request


def cancel(service_request, *, user, reason, request=None):
    with transaction.atomic():
        service_request = _locked(service_request)
        if service_request.submitted_by_id != user.pk:
            raise PermissionDenied('Only the person who submitted this request can cancel it.')
        if service_request.status not in ServiceRequest.OPEN_STATUSES:
            raise Conflict(f'This request is {service_request.get_status_display().lower()} and cannot be cancelled.')
        if service_request.utilization_applied:
            _move_utilization(
                service_request.client_id, -service_request.requested_amount, user=user,
                note=f'{service_request.reference} cancelled',
            )
            service_request.utilization_applied = False
        service_request.status = Status.CANCELLED
        service_request.approval_stage = ServiceRequest.ApprovalStage.NONE
        service_request.closed_reason = reason
        service_request.save(update_fields=['status', 'approval_stage', 'closed_reason', 'utilization_applied', 'updated_at'])
        _free_pnr(service_request)
        RequestEvent.objects.create(request=service_request, actor=user, action=RequestEvent.Action.CANCELLED, note=reason)
        _audit(service_request, AuditAction.SERVICE_REQUEST_CANCELLED, request, user)
        notify(service_request, 'cancelled', actor=user)
        return service_request


def _free_pnr(service_request):
    TicketDetails.objects.filter(request=service_request).update(active_pnr=None)


def _audit(service_request, action, request, user, **extra):
    log_audit(
        action=action, request=request, actor_user=user, target_type='service_request',
        target_id=service_request.id,
        metadata={'reference': service_request.reference, 'title': service_request.title, **extra},
    )


# Notifications -------------------------------------------------------------

EVENTS = {
    # event: (heading, notification type)
    'submitted': ('New service request', 'service_request_submitted'),
    'approval_needed': ('Approval needed', 'service_request_approval_needed'),
    'first_approved': ('Final approval needed', 'service_request_approval_needed'),
    'approved': ('Request approved', 'service_request_approved'),
    'rejected': ('Request rejected', 'service_request_rejected'),
    'completed': ('Request completed', 'service_request_completed'),
    'cancelled': ('Request cancelled', 'service_request_cancelled'),
}


def recipients(service_request, event):
    """Who is told of an event (the person who caused it is left out by notify)."""
    service = service_request.service
    stakeholders = set(access.users_for(service, Audience.Purpose.NOTIFY))
    went_through_approval = service_request.decisions.exists() or event in ('approval_needed', 'first_approved')
    approvers = set()
    if event == 'approval_needed' or went_through_approval:
        approvers = set(access.users_for(service, Audience.Purpose.FIRST_APPROVAL))
    final_approvers = set(access.users_for(service, Audience.Purpose.FINAL_APPROVAL))
    submitter = {service_request.submitted_by}

    if event == 'submitted':
        people = stakeholders
    elif event == 'approval_needed':
        people = stakeholders | approvers
    elif event == 'first_approved':
        people = submitter | final_approvers
    elif event in ('approved', 'rejected'):
        people = submitter | stakeholders | approvers | final_approvers
    else:  # completed, cancelled: everyone who was told about it
        people = stakeholders | approvers | (final_approvers if went_through_approval else set())
    return [person for person in people if person.is_active]


def _message(service_request, event, actor):
    who = display_name(actor)
    return {
        'submitted': f'{who} submitted {service_request.reference}.',
        'approval_needed': f'{who} submitted {service_request.reference}. It takes the client over its credit limit and needs your approval.',
        'first_approved': f'{who} gave the first approval to {service_request.reference}. It needs the final approval.',
        'approved': f'{who} gave the final approval to {service_request.reference}.',
        'rejected': f'{who} rejected {service_request.reference}: {service_request.closed_reason}',
        'completed': f'{who} marked {service_request.reference} completed.',
        'cancelled': f'{who} cancelled {service_request.reference}: {service_request.closed_reason}',
    }[event]


def notify(service_request, event, *, actor):
    heading, notification_type = EVENTS[event]
    body = _message(service_request, event, actor)
    path = f'/service-requests/requests/{service_request.id}'
    context = email_context(service_request)
    for person in recipients(service_request, event):
        if person.pk == actor.pk:
            continue
        create_notification(
            recipient=person, actor=actor, notification_type=notification_type,
            title=service_request.title, body=body, link_url=path,
            payload={'request_id': str(service_request.id), 'reference': service_request.reference, 'event': event},
        )
        email = (person.email or '').strip()
        if email:
            BaseEmailService.send_email(
                subject=f'{heading}: {service_request.title}',
                recipients=[email],
                template_name='emails/service_requests/request_update.html',
                context={**context, 'heading': heading, 'message': body, 'recipient_name': display_name(person)},
            )


def email_context(service_request):
    ticket = getattr(service_request, 'ticket', None)
    rows = [
        ('Reference', service_request.reference),
        ('Status', service_request.get_status_display()),
        ('Payment', service_request.get_payment_type_display()),
        (service_request.get_party_type_display(), service_request.client_name),
    ]
    if ticket:
        rows += [
            ('Passengers', ', '.join(ticket.passengers)),
            ('Airline', ticket.airline),
            ('PNR', ticket.pnr),
            ('Travel date', ticket.departure_date.strftime('%d %b %Y')
                + (f' – {ticket.return_date.strftime("%d %b %Y")}' if ticket.return_date else '')),
            ('Route', ticket.route),
        ]
    rows += [
        ('Selling price', format_amount(service_request.selling_price)),
        ('Revenue', format_amount(service_request.revenue)),
    ]
    if service_request.requested_amount is not None:
        balance = service_request.balance_after_request
        rows.append(('Balance after request', f'{service_request.requested_currency} {balance:,.2f}'))
    rows.append(('Submitted by', display_name(service_request.submitted_by)))
    return {
        'title': service_request.title,
        'rows': rows,
        'link_url': f'{getattr(settings, "PORTAL_BASE_URL", "")}/service-requests/requests/{service_request.id}',
    }
