"""Who takes part in service requests, read from the Audience rows (Django admin).

- submit: may create requests of that service;
- view: may see every request (so do everyone in the other purposes, and
  executives with global access);
- notify: told of every request;
- first_approval / final_approval: approve over-limit credit requests.

Only active people count. Superusers and executives can view every request
but submit or approve only if an audience names them, so the approvals stay
with the people they belong to. Nobody approves their own request (services.py).
"""

from django.contrib.auth import get_user_model
from django.db.models import Q

from common.permissions import has_global_access

from .models import Audience, Service

User = get_user_model()


def _audiences(service=None, purposes=None):
    queryset = Audience.objects.filter(is_active=True)
    if service:
        queryset = queryset.filter(service=service)
    if purposes:
        queryset = queryset.filter(purpose__in=purposes)
    return queryset


def _condition(audience):
    """A filter on User matching the people the audience names."""
    if audience.kind == Audience.Kind.UNIT_MEMBERS:
        return Q(staff_profile__unit_id=audience.unit_id, staff_profile__is_active=True)
    if audience.kind == Audience.Kind.UNIT_SUPERVISOR:
        return Q(managed_units__id=audience.unit_id)
    if audience.kind == Audience.Kind.DEPARTMENT_MANAGER:
        return Q(managed_departments__id=audience.department_id)
    return Q(staff_profile__role_id=audience.role_id, staff_profile__is_active=True)


def users_for(service, *purposes):
    """Active users in any of the purposes for the service."""
    audiences = list(_audiences(service, purposes))
    if not audiences:
        return User.objects.none()
    condition = Q()
    for audience in audiences:
        condition |= _condition(audience)
    return User.objects.filter(condition, is_active=True).distinct()


def has_purpose(user, service, *purposes):
    if not user or not user.is_authenticated or not user.is_active:
        return False
    return users_for(service, *purposes).filter(pk=user.pk).exists()


def can_submit(user, service=Service.TICKET):
    return has_purpose(user, service, Audience.Purpose.SUBMIT)


def can_approve(user, stage=None, service=Service.TICKET):
    purposes = {
        'first': [Audience.Purpose.FIRST_APPROVAL],
        'final': [Audience.Purpose.FINAL_APPROVAL],
    }.get(stage, [Audience.Purpose.FIRST_APPROVAL, Audience.Purpose.FINAL_APPROVAL])
    return has_purpose(user, service, *purposes)


def can_view_requests(user):
    """Everyone involved in any service sees every request; so do executives."""
    if has_global_access(user):
        return True
    if not user or not user.is_authenticated or not user.is_active:
        return False
    for service in Service.values:
        if has_purpose(user, service, *Audience.Purpose.values):
            return True
    return False
