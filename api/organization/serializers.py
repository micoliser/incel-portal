from django.contrib.auth.models import User
from rest_framework import serializers

from organization.models import Department, Role, Unit, Team


class _UserBasicSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'first_name', 'last_name', 'email']


class TeamSerializer(serializers.ModelSerializer):
    team_lead_info = _UserBasicSerializer(source='team_lead', read_only=True)

    class Meta:
        model = Team
        fields = ['id', 'name', 'code', 'unit', 'team_lead', 'team_lead_info', 'is_active', 'created_at', 'updated_at']

    def validate(self, attrs):
        team_lead = attrs.get('team_lead')
        if team_lead and self.instance:
            if team_lead.staff_profile.team_id != self.instance.id:
                raise serializers.ValidationError({"team_lead": "The team lead must be a member of this team."})
        elif team_lead and not self.instance:
            raise serializers.ValidationError({"team_lead": "Cannot assign a team lead before the team is created."})
        return attrs


class UnitSerializer(serializers.ModelSerializer):
    supervisor_info = _UserBasicSerializer(source='supervisor', read_only=True)

    class Meta:
        model = Unit
        fields = ['id', 'name', 'code', 'department', 'supervisor', 'supervisor_info', 'is_active', 'created_at', 'updated_at']

    def validate(self, attrs):
        supervisor = attrs.get('supervisor')
        if supervisor and self.instance:
            if supervisor.staff_profile.unit_id != self.instance.id:
                raise serializers.ValidationError({"supervisor": "The supervisor must be a member of this unit."})
        elif supervisor and not self.instance:
            raise serializers.ValidationError({"supervisor": "Cannot assign a supervisor before the unit is created."})
        return attrs


class DepartmentSerializer(serializers.ModelSerializer):
    line_manager_info = _UserBasicSerializer(source='line_manager', read_only=True)

    class Meta:
        model = Department
        fields = ['id', 'name', 'code', 'line_manager', 'line_manager_info', 'is_active', 'created_at', 'updated_at']

    def validate(self, attrs):
        line_manager = attrs.get('line_manager')
        if line_manager and self.instance:
            if line_manager.staff_profile.department_id != self.instance.id:
                raise serializers.ValidationError({"line_manager": "The line manager must be a member of this department."})
        elif line_manager and not self.instance:
            raise serializers.ValidationError({"line_manager": "Cannot assign a line manager before the department is created."})
        return attrs


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ['id', 'name', 'code', 'has_global_access', 'is_active', 'created_at', 'updated_at']


# Nested serializers for the hierarchy tree
class TeamHierarchySerializer(serializers.ModelSerializer):
    team_lead_info = _UserBasicSerializer(source='team_lead', read_only=True)
    
    class Meta:
        model = Team
        fields = ['id', 'name', 'code', 'team_lead_info', 'is_active']


class UnitHierarchySerializer(serializers.ModelSerializer):
    supervisor_info = _UserBasicSerializer(source='supervisor', read_only=True)
    teams = TeamHierarchySerializer(many=True, read_only=True)
    
    class Meta:
        model = Unit
        fields = ['id', 'name', 'code', 'supervisor_info', 'is_active', 'teams']


class DepartmentHierarchySerializer(serializers.ModelSerializer):
    line_manager_info = _UserBasicSerializer(source='line_manager', read_only=True)
    units = UnitHierarchySerializer(many=True, read_only=True)
    
    class Meta:
        model = Department
        fields = ['id', 'name', 'code', 'line_manager_info', 'is_active', 'units']


class BulkMemberSerializer(serializers.Serializer):
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
