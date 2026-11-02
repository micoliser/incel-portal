from django.contrib.auth import get_user_model
from django.db.models import Q
from common.permissions import has_global_access

User = get_user_model()


def get_subordinate_user_ids(user) -> list[int]:
    """
    Returns a list of User IDs that report directly or hierarchically to `user`
    in the organization hierarchy (Team Lead, Unit Supervisor, Department Line Manager),
    or all active users if the user has global access.
    """
    if not user or not user.is_authenticated:
        return []

    if has_global_access(user):
        return list(
            User.objects.filter(is_active=True)
            .exclude(id=user.id)
            .values_list('id', flat=True)
        )

    team_ids = list(user.managed_teams.values_list('id', flat=True))
    unit_ids = list(user.managed_units.values_list('id', flat=True))
    dept_ids = list(user.managed_departments.values_list('id', flat=True))

    if not (team_ids or unit_ids or dept_ids):
        return []

    query = Q()
    if team_ids:
        query |= Q(staff_profile__team_id__in=team_ids)
    if unit_ids:
        query |= (
            Q(staff_profile__unit_id__in=unit_ids)
            | Q(staff_profile__team__unit_id__in=unit_ids)
        )
    if dept_ids:
        query |= (
            Q(staff_profile__department_id__in=dept_ids)
            | Q(staff_profile__unit__department_id__in=dept_ids)
            | Q(staff_profile__team__unit__department_id__in=dept_ids)
        )

    return list(
        User.objects.filter(query)
        .exclude(id=user.id)
        .values_list('id', flat=True)
    )


def is_user_manager_of(manager, subordinate) -> bool:
    """
    Check if `manager` has managerial oversight over `subordinate`.
    """
    if not manager or not subordinate or not manager.is_authenticated:
        return False

    if manager.id == subordinate.id:
        return False

    if has_global_access(manager):
        return True

    profile = getattr(subordinate, 'staff_profile', None)
    if not profile:
        return False

    # Check team lead
    if profile.team and profile.team.team_lead_id == manager.id:
        return True

    # Check unit supervisor
    unit = profile.unit or (profile.team.unit if profile.team else None)
    if unit and unit.supervisor_id == manager.id:
        return True

    # Check department line manager
    dept = profile.department or (unit.department if unit else None)
    if dept and dept.line_manager_id == manager.id:
        return True

    # Check direct_manager property
    direct_mgr = profile.direct_manager
    if direct_mgr and direct_mgr.id == manager.id:
        return True

    return False


def has_task_oversight(user, task) -> bool:
    """
    Returns True if user is the assignee, assigner, or has managerial oversight
    over either party.
    """
    if not user or not user.is_authenticated or not task:
        return False

    if user.id == getattr(task, 'assigned_to_id', None) or user.id == getattr(task, 'assigned_by_id', None):
        return True

    if has_global_access(user):
        return True

    assigned_to = getattr(task, 'assigned_to', None)
    assigned_by = getattr(task, 'assigned_by', None)

    return (
        (assigned_to and is_user_manager_of(user, assigned_to))
        or (assigned_by and is_user_manager_of(user, assigned_by))
    )

