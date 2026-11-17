"""Rules for moving people around the organization tree."""

from organization.models import Department, Team, Unit


def clear_leadership_left_behind(user, *, old_department_id, old_unit_id, old_team_id, profile):
    """A leader must be a member of what they lead. When someone leaves a team,
    unit or department they led, that group is left without a leader, instead
    of the person keeping manager rights over a group they are no longer in."""
    cleared = []
    if old_team_id and profile.team_id != old_team_id:
        if Team.objects.filter(id=old_team_id, team_lead=user).update(team_lead=None):
            cleared.append(('team', old_team_id))
    if old_unit_id and profile.unit_id != old_unit_id:
        if Unit.objects.filter(id=old_unit_id, supervisor=user).update(supervisor=None):
            cleared.append(('unit', old_unit_id))
    if old_department_id and profile.department_id != old_department_id:
        if Department.objects.filter(id=old_department_id, line_manager=user).update(line_manager=None):
            cleared.append(('department', old_department_id))
    return cleared


def place_profile(profile, **placement):
    """Set a profile's department, unit and/or team, keep the three consistent,
    and clear any leadership the person held over a group they have now left.

    Raises django.core.exceptions.ValidationError when the placement is not a
    valid position in the tree (for example a team outside the chosen unit).
    """
    old = {
        'old_department_id': profile.department_id,
        'old_unit_id': profile.unit_id,
        'old_team_id': profile.team_id,
    }
    for field, value in placement.items():
        setattr(profile, field, value)
    profile.clean()
    profile.save(update_fields=['department', 'unit', 'team', 'updated_at'])
    return clear_leadership_left_behind(profile.user, profile=profile, **old)
