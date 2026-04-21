from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from accounts.models import StaffProfile
from organization.models import Department


class BasicUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'is_active']


class StaffProfileSerializer(serializers.ModelSerializer):
    role = serializers.StringRelatedField()
    department_id = serializers.SerializerMethodField()

    class Meta:
        model = StaffProfile
        fields = ['role', 'department_id', 'is_active']

    def get_department_id(self, obj):
        return obj.department_id


class UserWithProfileSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    role_code = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()
    department_id = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = [
            'id',
            'username',
            'email',
            'first_name',
            'last_name',
            'is_active',
            'role',
            'role_code',
            'department',
            'department_id',
        ]

    def _profile(self, obj):
        return getattr(obj, 'staff_profile', None)

    def get_role(self, obj):
        profile = self._profile(obj)
        return profile.role.name if profile and profile.role else None

    def get_role_code(self, obj):
        profile = self._profile(obj)
        return profile.role.code if profile and profile.role else None

    def get_department(self, obj):
        profile = self._profile(obj)
        if not profile or not profile.department:
            return None
        return profile.department.name

    def get_department_id(self, obj):
        profile = self._profile(obj)
        if not profile:
            return None
        return profile.department_id


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate_email(self, value):
        return value.strip().lower()


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_new_password(self, value):
        user = self.context.get('user')
        validate_password(value, user=user)
        return value


class UpdateUserRoleSerializer(serializers.Serializer):
    role_id = serializers.IntegerField(min_value=1)


class UpdateUserDepartmentSerializer(serializers.Serializer):
    department_id = serializers.IntegerField(min_value=1)


class UpdateUserStatusSerializer(serializers.Serializer):
    is_active = serializers.BooleanField()


class AdminCreateUserSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    department_id = serializers.IntegerField(min_value=1)

    def validate_first_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('first_name cannot be blank.')
        return value

    def validate_last_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('last_name cannot be blank.')
        return value

    def validate_email(self, value):
        value = value.strip().lower()
        if User.objects.filter(email__iexact=value).exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value

    def validate_department_id(self, value):
        if not Department.objects.filter(id=value).exists():
            raise serializers.ValidationError('Department not found.')
        return value

    def validate_password(self, value):
        email = self.initial_data.get('email', '')
        candidate_user = User(username=str(email).strip().lower(), email=str(email).strip().lower())
        validate_password(value, user=candidate_user)
        return value
