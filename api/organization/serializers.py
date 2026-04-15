from rest_framework import serializers

from organization.models import Department, Role


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ['id', 'name', 'code', 'is_active', 'created_at', 'updated_at']


class RoleSerializer(serializers.ModelSerializer):
    class Meta:
        model = Role
        fields = ['id', 'name', 'code', 'has_global_access', 'is_active', 'created_at', 'updated_at']
