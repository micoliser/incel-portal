from django.contrib.auth import get_user_model
from rest_framework import serializers

from common.serializers import UserSummarySerializer
from organization.models import Department, Role, Team, Unit

User = get_user_model()


def _profile_field(user, field):
    """A field from the user's staff profile, or None if they have no profile."""
    profile = getattr(user, 'staff_profile', None)
    return getattr(profile, field, None)


def _leader_fields(name):
    """A leader is read as a nested user (`<name>`) and written by id (`<name>_id`)."""
    return {
        name: UserSummarySerializer(read_only=True),
        f'{name}_id': serializers.PrimaryKeyRelatedField(
            source=name,
            queryset=User.objects.filter(is_active=True),
            write_only=True,
            required=False,
            allow_null=True,
        ),
    }


class _LeaderMustBeMember:
    """Shared validation: whoever leads a group must already be a member of it."""

    leader_field = ''
    membership_field = ''
    group_label = ''
    leader_label = ''

    def validate(self, attrs):
        attrs = super().validate(attrs)
        leader = attrs.get(self.leader_field)
        if leader and self.instance:
            if _profile_field(leader, self.membership_field) != self.instance.id:
                raise serializers.ValidationError(
                    {f'{self.leader_field}_id': f'The {self.leader_label} must be a member of this {self.group_label}.'}
                )
        elif leader:
            raise serializers.ValidationError(
                {
                    f'{self.leader_field}_id': (
                        f'Cannot assign a {self.leader_label} before the {self.group_label} is created.'
                    )
                }
            )
        return attrs


class TeamSerializer(_LeaderMustBeMember, serializers.ModelSerializer):
    leader_field, membership_field, group_label, leader_label = 'team_lead', 'team_id', 'team', 'team lead'
    locals().update(_leader_fields('team_lead'))
    unit_id = serializers.PrimaryKeyRelatedField(source='unit', queryset=Unit.objects.all())

    class Meta:
        model = Team
        fields = ['id', 'name', 'code', 'unit_id', 'team_lead', 'team_lead_id', 'is_active', 'created_at', 'updated_at']


class UnitSerializer(_LeaderMustBeMember, serializers.ModelSerializer):
    leader_field, membership_field, group_label, leader_label = 'supervisor', 'unit_id', 'unit', 'supervisor'
    locals().update(_leader_fields('supervisor'))
    department_id = serializers.PrimaryKeyRelatedField(source='department', queryset=Department.objects.all())

    class Meta:
        model = Unit
        fields = [
            'id', 'name', 'code', 'department_id', 'supervisor', 'supervisor_id',
            'is_active', 'created_at', 'updated_at',
        ]


class DepartmentSerializer(_LeaderMustBeMember, serializers.ModelSerializer):
    leader_field, membership_field = 'line_manager', 'department_id'
    group_label, leader_label = 'department', 'line manager'
    locals().update(_leader_fields('line_manager'))

    class Meta:
        model = Department
        fields = [
            'id', 'name', 'code', 'line_manager', 'line_manager_id', 'is_active',
            'manages_inventory', 'handles_it_support', 'handles_general_support', 'created_at', 'updated_at',
        ]


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ['id', 'name', 'code', 'has_global_access', 'is_active', 'created_at', 'updated_at']


# Nested serializers for the hierarchy tree. `members_count` comes from the
# view's annotation, so the whole tree is counted in the query that loads it.
class TeamHierarchySerializer(serializers.ModelSerializer):
    team_lead = UserSummarySerializer(read_only=True)
    members_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Team
        fields = ['id', 'name', 'code', 'team_lead', 'is_active', 'members_count']


class UnitHierarchySerializer(serializers.ModelSerializer):
    supervisor = UserSummarySerializer(read_only=True)
    teams = TeamHierarchySerializer(many=True, read_only=True)
    members_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Unit
        fields = ['id', 'name', 'code', 'supervisor', 'is_active', 'teams', 'members_count']


class DepartmentHierarchySerializer(serializers.ModelSerializer):
    line_manager = UserSummarySerializer(read_only=True)
    units = UnitHierarchySerializer(many=True, read_only=True)
    members_count = serializers.IntegerField(read_only=True)

    class Meta:
        model = Department
        fields = ['id', 'name', 'code', 'line_manager', 'is_active', 'units', 'members_count']


class MembershipChangeSerializer(serializers.Serializer):
    user_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=True,
        max_length=500
    )
    action = serializers.ChoiceField(choices=['add', 'remove'], default='add', required=False)

    def validate_user_ids(self, value):
        if not value:
            return value
        
        # Verify all users exist and are active
        existing_users = User.objects.filter(id__in=value, is_active=True).values_list('id', flat=True)
        missing = set(value) - set(existing_users)
        if missing:
            raise serializers.ValidationError(f"The following user IDs do not exist or are inactive: {list(missing)}")
        return value
