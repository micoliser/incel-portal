"""Who may see and manage credit clients.

Rights come from organization records, not from names or codes:
- a unit's `credit_client_access` gives its members view or manage rights
  ("supervisor_manages": members view, the unit's supervisor manages);
- a department's `manager_views_credit_clients` lets its line manager view;
- global access (ED, MD and superusers) can always view; superusers can also manage.
"""

from rest_framework.permissions import BasePermission

from common.permissions import has_global_access


def _profile(user):
    if not user or not user.is_authenticated or not user.is_active:
        return None
    return getattr(user, 'staff_profile', None)


def can_manage_clients(user):
    if not user or not user.is_authenticated or not user.is_active:
        return False
    if user.is_superuser:
        return True
    from organization.models import Unit

    profile = _profile(user)
    unit = profile.unit if profile and profile.is_active else None
    if unit and unit.is_active and unit.credit_client_access == Unit.CreditClientAccess.MANAGE:
        return True
    # The supervisor of a "supervisor manages" unit (a leader is always a member).
    return Unit.objects.filter(
        supervisor=user, is_active=True, credit_client_access=Unit.CreditClientAccess.SUPERVISOR_MANAGES,
    ).exists()


def can_view_clients(user):
    if has_global_access(user) or can_manage_clients(user):
        return True
    from organization.models import Department, Unit

    profile = _profile(user)
    if not profile or not profile.is_active:
        return False
    unit = profile.unit
    if unit and unit.is_active and unit.credit_client_access:
        return True
    return Department.objects.filter(line_manager=user, is_active=True, manager_views_credit_clients=True).exists()


class CanViewOrManageClients(BasePermission):
    """Viewers may read; only managers may write."""

    def has_permission(self, request, _view):
        if request.method in ('GET', 'HEAD', 'OPTIONS'):
            return can_view_clients(request.user)
        return can_manage_clients(request.user)


class CanManageClients(BasePermission):
    def has_permission(self, request, _view):
        return can_manage_clients(request.user)
