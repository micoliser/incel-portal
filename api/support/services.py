from __future__ import annotations

import logging
from typing import Any

from django.conf import settings
from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.db import transaction
from django.utils import timezone

from notifications.services import create_notification
from organization.models import Department

from .models import SupportAttachment, SupportComment, SupportRequest

logger = logging.getLogger(__name__)


def route_support_request(category: str) -> Department:
    """Determine the target department based on request category."""
    if category == 'IT_SUPPORT':
        department = Department.objects.filter(code='IT').first()
    else:
        department = Department.objects.filter(code='HR').first()

    if not department:
        raise ValidationError(
            f'Target department for category "{category}" does not exist. '
            'Contact an administrator.'
        )
    return department


def get_department_managers(department: Department) -> list[User]:
    """Return users who are LINE_MANAGERs within the given department."""
    from accounts.models import StaffProfile
    manager_profiles = StaffProfile.objects.filter(
        department=department,
        role__code='LINE_MANAGER',
        is_active=True,
    ).select_related('user')
    return [profile.user for profile in manager_profiles]


def get_requester_line_manager(requester: User) -> User | None:
    """Return the requester's line manager if set."""
    from accounts.models import StaffProfile
    profile = getattr(requester, 'staff_profile', None)
    if profile and profile.line_manager:
        return profile.line_manager
    return None


# ---------------------------------------------------------------------------
# Notification dispatchers
# ---------------------------------------------------------------------------

def _base_payload(request: SupportRequest) -> dict[str, Any]:
    return {
        'request_id': str(request.id),
        'title': request.title,
        'category': request.category,
        'status': request.status,
    }


def notify_request_submitted(request: SupportRequest) -> None:
    payload = _base_payload(request)
    link_url = f'/support/{request.id}'

    # Notify IT/HR line managers of the routed department
    for manager in get_department_managers(request.department):
        create_notification(
            recipient=manager,
            actor=request.requester,
            notification_type='support_request_submitted',
            title=f'New Support Request: {request.title}',
            body=f'{request.requester.get_full_name() or request.requester.username} submitted a {request.get_category_display()} request.',
            link_url=link_url,
            payload=payload,
        )

    # Notify the requester's line manager (view-only)
    lm = get_requester_line_manager(request.requester)
    if lm:
        create_notification(
            recipient=lm,
            actor=request.requester,
            notification_type='support_request_submitted',
            title=f'{request.requester.get_full_name() or request.requester.username} submitted a support request',
            body=f'Your team member submitted: {request.title}',
            link_url=link_url,
            payload=payload,
        )


def notify_request_assigned(request: SupportRequest) -> None:
    if not request.assigned_to:
        return
    create_notification(
        recipient=request.assigned_to,
        actor=request.assigned_by,
        notification_type='support_request_assigned',
        title=f'Support Request Assigned: {request.title}',
        body=f'You have been assigned to handle: {request.title}',
        link_url=f'/support/{request.id}',
        payload=_base_payload(request),
    )


def notify_status_updated(request: SupportRequest, previous_status: str) -> None:
    create_notification(
        recipient=request.requester,
        actor=None,
        notification_type='support_status_updated',
        title=f'Support Request Updated: {request.title}',
        body=f'Status changed from {previous_status} to {request.get_status_display()}',
        link_url=f'/support/{request.id}',
        payload={**_base_payload(request), 'previous_status': previous_status},
    )


def notify_comment_added(comment: SupportComment) -> None:
    request = comment.request
    # Notify the other party (whoever didn't write the comment)
    if comment.author == request.requester:
        # Requester commented — notify assigned handler
        recipients = [request.assigned_to] if request.assigned_to else []
    else:
        # Handler/manager commented — notify requester
        recipients = [request.requester]

    for recipient in recipients:
        if recipient and recipient != comment.author:
            create_notification(
                recipient=recipient,
                actor=comment.author,
                notification_type='support_comment_added',
                title=f'New comment on: {request.title}',
                body=comment.body[:120],
                link_url=f'/support/{request.id}',
                payload=_base_payload(request),
            )


def notify_request_resolved(request: SupportRequest) -> None:
    create_notification(
        recipient=request.requester,
        actor=request.assigned_to or request.assigned_by,
        notification_type='support_request_resolved',
        title=f'Support Request Resolved: {request.title}',
        body='Your request has been marked as resolved. Please confirm or reopen if needed.',
        link_url=f'/support/{request.id}',
        payload=_base_payload(request),
    )


def notify_request_closed(request: SupportRequest) -> None:
    create_notification(
        recipient=request.requester,
        actor=None,
        notification_type='support_request_closed',
        title=f'Support Request Closed: {request.title}',
        body='This request has been closed.',
        link_url=f'/support/{request.id}',
        payload=_base_payload(request),
    )


# ---------------------------------------------------------------------------
# Status transitions
# ---------------------------------------------------------------------------

VALID_TRANSITIONS: dict[str, list[str]] = {
    'open': ['assigned'],
    'assigned': ['in_progress', 'open'],
    'in_progress': ['resolved', 'assigned'],
    'resolved': ['closed', 'in_progress', 'open'],
    'closed': ['open'],
}


def is_valid_transition(from_status: str, to_status: str) -> bool:
    return to_status in VALID_TRANSITIONS.get(from_status, [])


@transaction.atomic
def update_request_status(
    request: SupportRequest,
    new_status: str,
    *,
    user: User | None = None,
    comment_body: str | None = None,
) -> SupportRequest:
    """Update request status with validation and system comment."""
    if not is_valid_transition(request.status, new_status):
        raise ValidationError(
            f'Cannot transition from "{request.get_status_display()}" '
            f'to "{dict(SupportRequest.STATUS_CHOICES).get(new_status, new_status)}".'
        )

    previous_status = request.status
    request.status = new_status

    if new_status == 'resolved':
        request.resolved_at = timezone.now()
    elif new_status == 'closed':
        request.closed_at = timezone.now()

    request.save(update_fields=['status', 'resolved_at', 'closed_at', 'updated_at'])

    # Create system comment
    if not comment_body:
        comment_body = (
            f'Status changed from "{previous_status}" to "{dict(SupportRequest.STATUS_CHOICES).get(new_status)}"'
            f'{" by " + (user.get_full_name() or user.username) if user else ""}.'
        )

    SupportComment.objects.create(
        request=request,
        author=user or request.requester,
        body=comment_body,
        is_system=True,
    )

    # Fire notification
    notify_status_updated(request, previous_status)

    return request


# ---------------------------------------------------------------------------
# Auto-close service
# ---------------------------------------------------------------------------

def auto_close_resolved_requests(
    days: int | None = None,
) -> int:
    """Close resolved requests that have exceeded the auto-close threshold."""
    if days is None:
        days = getattr(settings, 'SUPPORT_AUTO_CLOSE_DAYS', 7)

    threshold = timezone.now() - timezone.timedelta(days=days)
    overdue = SupportRequest.objects.filter(
        status='resolved',
        resolved_at__lte=threshold,
    ).select_related('requester')

    closed_count = 0
    for request in overdue:
        try:
            with transaction.atomic():
                request.status = 'closed'
                request.closed_at = timezone.now()
                request.save(update_fields=['status', 'closed_at', 'updated_at'])

                SupportComment.objects.create(
                    request=request,
                    author=request.requester,
                    body=f'Request auto-closed after {days} day(s) of no response.',
                    is_system=True,
                )

                notify_request_closed(request)
                closed_count += 1
        except Exception as e:
            logger.error(
                'Failed to auto-close support request %s: %s',
                request.id, str(e),
            )

    if closed_count:
        logger.info('Auto-closed %d support request(s)', closed_count)

    return closed_count
