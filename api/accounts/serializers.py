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
    role_id = serializers.UUIDField()


class UpdateUserDepartmentSerializer(serializers.Serializer):
    department_id = serializers.UUIDField()


class UpdateUserStatusSerializer(serializers.Serializer):
    is_active = serializers.BooleanField()


class AdminCreateUserSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True, min_length=8)
    department_id = serializers.UUIDField()

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


class UpdateAdminUserSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150, allow_blank=True)
    email = serializers.EmailField()
    department_id = serializers.UUIDField(allow_null=True, required=False)
    reset_password = serializers.BooleanField(required=False, default=False)
    new_password = serializers.CharField(required=False, write_only=True, allow_blank=False)
    confirm_password = serializers.CharField(required=False, write_only=True, allow_blank=False)

    def validate_first_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('first_name cannot be blank.')
        return value

    def validate_last_name(self, value):
        return value.strip()

    def validate_email(self, value):
        value = value.strip().lower()
        user_id = self.context.get('user_id')
        qs = User.objects.filter(email__iexact=value)
        if user_id:
            qs = qs.exclude(id=user_id)
        if qs.exists():
            raise serializers.ValidationError('A user with this email already exists.')
        return value

    def validate_department_id(self, value):
        if value is None:
            return None
        if not Department.objects.filter(id=value).exists():
            raise serializers.ValidationError('Department not found.')
        return value

    def validate(self, attrs):
        attrs = super().validate(attrs)

        if not attrs.get('reset_password'):
            return attrs

        new_password = attrs.get('new_password')
        confirm_password = attrs.get('confirm_password')

        if not new_password:
            raise serializers.ValidationError({'new_password': 'New password is required.'})

        if len(new_password) < 8:
            raise serializers.ValidationError({'new_password': 'Password must be at least 8 characters.'})

        if new_password != confirm_password:
            raise serializers.ValidationError({'confirm_password': 'Passwords do not match.'})

        user_id = self.context.get('user_id')
        email = attrs.get('email') or ''
        candidate_user = User(username=str(email).strip().lower(), email=str(email).strip().lower())
        validate_password(new_password, user=candidate_user)

        return attrs
