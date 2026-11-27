from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from rest_framework import serializers

from common.permissions import has_global_access
from organization.models import Department, Role, Team, Unit

User = get_user_model()

# What the user serializer reads besides the user row. List views load users
# with these so the cost of a page does not grow with the number of users.
USER_PROFILE_RELATED = (
    'staff_profile__role',
    'staff_profile__department',
    'staff_profile__unit',
    'staff_profile__team',
)
USER_PROFILE_PREFETCH = ('managed_departments', 'managed_units', 'managed_teams')


def with_profile(queryset):
    """A user queryset loaded with everything UserWithProfileSerializer reads."""
    return queryset.select_related(*USER_PROFILE_RELATED).prefetch_related(*USER_PROFILE_PREFETCH)


def _managed(user, relation):
    """The groups a user leads, from the prefetched list when there is one."""
    return list(getattr(user, relation).all())


class UserWithProfileSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()
    role_code = serializers.SerializerMethodField()
    role_id = serializers.SerializerMethodField()
    department = serializers.SerializerMethodField()
    department_id = serializers.SerializerMethodField()
    unit_id = serializers.SerializerMethodField()
    unit_name = serializers.SerializerMethodField()
    team_id = serializers.SerializerMethodField()
    team_name = serializers.SerializerMethodField()
    has_global_access = serializers.SerializerMethodField()
    is_manager = serializers.SerializerMethodField()
    manager_scope = serializers.SerializerMethodField()
    department_code = serializers.SerializerMethodField()
    can_manage_inventory = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

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
            'role_id',
            'department',
            'department_id',
            'department_code',
            'unit_id',
            'unit_name',
            'team_id',
            'team_name',
            'has_global_access',
            'is_manager',
            'manager_scope',
            'can_manage_inventory',
            'avatar_url',
        ]

    def _profile(self, obj):
        return getattr(obj, 'staff_profile', None)

    def get_avatar_url(self, obj):
        profile = self._profile(obj)
        return (profile.avatar_url if profile else '') or None

    def get_can_manage_inventory(self, obj):
        from inventory.permissions import can_manage_inventory

        return can_manage_inventory(obj)

    def get_has_global_access(self, obj):
        return has_global_access(obj)

    def get_is_manager(self, obj):
        if has_global_access(obj):
            return True
        return (
            bool(_managed(obj, 'managed_departments'))
            or bool(_managed(obj, 'managed_units'))
            or bool(_managed(obj, 'managed_teams'))
        )

    def get_manager_scope(self, obj):
        if not obj or not obj.is_authenticated:
            return None
        if has_global_access(obj):
            return {
                'role_type': 'global',
                'title': 'Global Oversight',
                'scope_name': 'All Departments',
                'description': 'Viewing company-wide tasks across all departments and units.',
            }
        if bool(_managed(obj, 'managed_departments')):
            names = ', '.join(group.name for group in _managed(obj, 'managed_departments'))
            return {
                'role_type': 'department',
                'title': 'Department Line Manager',
                'scope_name': names,
                'description': f'Viewing all tasks related to the {names} department.',
            }
        if bool(_managed(obj, 'managed_units')):
            names = ', '.join(group.name for group in _managed(obj, 'managed_units'))
            return {
                'role_type': 'unit',
                'title': 'Unit Supervisor',
                'scope_name': names,
                'description': f'Viewing all tasks related to the {names} unit.',
            }
        if bool(_managed(obj, 'managed_teams')):
            names = ', '.join(group.name for group in _managed(obj, 'managed_teams'))
            return {
                'role_type': 'team',
                'title': 'Team Lead',
                'scope_name': names,
                'description': f'Viewing all tasks related to the {names} team.',
            }
        return None

    def get_role(self, obj):
        profile = self._profile(obj)
        return profile.display_title if profile else "Staff"

    def get_role_code(self, obj):
        profile = self._profile(obj)
        return profile.role.code if profile and profile.role else None

    def get_role_id(self, obj):
        profile = self._profile(obj)
        if profile and profile.role_id:
            return str(profile.role_id)
        return None

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

    def get_department_code(self, obj):
        profile = self._profile(obj)
        if not profile or not profile.department:
            return None
        return profile.department.code

    def get_unit_id(self, obj):
        profile = self._profile(obj)
        if not profile:
            return None
        return profile.unit_id

    def get_unit_name(self, obj):
        profile = self._profile(obj)
        if not profile or not profile.unit:
            return None
        return profile.unit.name

    def get_team_id(self, obj):
        profile = self._profile(obj)
        if not profile:
            return None
        return profile.team_id

    def get_team_name(self, obj):
        profile = self._profile(obj)
        if not profile or not profile.team:
            return None
        return profile.team.name


class MeSerializer(UserWithProfileSerializer):
    """The signed-in user (GET /me), with rights that cost queries to work out,
    so they are not repeated for every row of the user list."""

    can_view_clients = serializers.SerializerMethodField()
    can_manage_clients = serializers.SerializerMethodField()
    can_view_requests = serializers.SerializerMethodField()
    can_submit_requests = serializers.SerializerMethodField()
    can_approve_requests = serializers.SerializerMethodField()

    class Meta(UserWithProfileSerializer.Meta):
        fields = UserWithProfileSerializer.Meta.fields + [
            'can_view_clients', 'can_manage_clients', 'can_view_requests', 'can_submit_requests',
            'can_approve_requests',
        ]

    def get_can_view_requests(self, obj):
        from service_requests.access import can_view_requests

        return can_view_requests(obj)

    def get_can_submit_requests(self, obj):
        from service_requests.access import can_submit

        return can_submit(obj)

    def get_can_approve_requests(self, obj):
        from service_requests.access import can_approve

        return can_approve(obj)

    def get_can_view_clients(self, obj):
        from clients.permissions import can_view_clients

        return can_view_clients(obj)

    def get_can_manage_clients(self, obj):
        from clients.permissions import can_manage_clients

        return can_manage_clients(obj)


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate_email(self, value):
        return value.strip().lower()


class ChangePasswordSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_new_password(self, value):
        user = self.context.get('user')
        validate_password(value, user=user)
        return value


class PasswordResetRequestSerializer(serializers.Serializer):
    email = serializers.EmailField()

    def validate_email(self, value):
        return value.strip().lower()


class PasswordResetValidateSerializer(serializers.Serializer):
    uid = serializers.CharField()
    token = serializers.CharField()


class RefreshTokenBodySerializer(serializers.Serializer):
    """Logout and refresh take the refresh token from the cookie; a body may also carry it."""

    refresh = serializers.CharField(required=False, allow_blank=True, trim_whitespace=False)


class PasswordLinkSerializer(serializers.Serializer):
    """The two halves of an emailed set-password or reset link."""

    uid = serializers.CharField()
    token = serializers.CharField()


class PasswordResetConfirmSerializer(PasswordLinkSerializer):
    new_password = serializers.CharField(write_only=True, min_length=8)

    def validate_new_password(self, value):
        user = self.context.get('user')
        validate_password(value, user=user)
        return value


class AdminCreateUserSerializer(serializers.Serializer):
    first_name = serializers.CharField(max_length=150)
    last_name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    department_id = serializers.UUIDField(required=False, allow_null=True)
    unit_id = serializers.UUIDField(required=False, allow_null=True)
    team_id = serializers.UUIDField(required=False, allow_null=True)
    role_id = serializers.UUIDField(required=False, allow_null=True)

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
        if value is None:
            return None
        if not Department.objects.filter(id=value).exists():
            raise serializers.ValidationError('Department not found.')
        return value

    def validate_unit_id(self, value):
        if value is None:
            return None
        if not Unit.objects.filter(id=value).exists():
            raise serializers.ValidationError('Unit not found.')
        return value

    def validate_team_id(self, value):
        if value is None:
            return None
        if not Team.objects.filter(id=value).exists():
            raise serializers.ValidationError('Team not found.')
        return value

    def validate_role_id(self, value):
        if value is None:
            return None
        if not Role.objects.filter(id=value).exists():
            raise serializers.ValidationError('Role not found.')
        return value


class UpdateAdminUserSerializer(serializers.Serializer):
    """A partial update: a field that is not sent is left as it is."""

    first_name = serializers.CharField(max_length=150, required=False)
    last_name = serializers.CharField(max_length=150, required=False)
    email = serializers.EmailField(required=False)
    department_id = serializers.UUIDField(allow_null=True, required=False)
    unit_id = serializers.UUIDField(allow_null=True, required=False)
    team_id = serializers.UUIDField(allow_null=True, required=False)
    role_id = serializers.UUIDField(allow_null=True, required=False)
    is_active = serializers.BooleanField(required=False)
    send_reset_link = serializers.BooleanField(required=False)

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

    def validate_unit_id(self, value):
        if value is None:
            return None
        if not Unit.objects.filter(id=value).exists():
            raise serializers.ValidationError('Unit not found.')
        return value

    def validate_team_id(self, value):
        if value is None:
            return None
        if not Team.objects.filter(id=value).exists():
            raise serializers.ValidationError('Team not found.')
        return value

    def validate_role_id(self, value):
        if value is None:
            return None
        if not Role.objects.filter(id=value).exists():
            raise serializers.ValidationError('Role not found.')
        return value


class ProfilePhotoUploadUrlSerializer(serializers.Serializer):
    content_type = serializers.ChoiceField(choices=['image/jpeg', 'image/png', 'image/webp'])
    size = serializers.IntegerField(min_value=1)

    def validate_size(self, value):
        from accounts.s3 import PROFILE_PHOTO_MAX_SIZE

        if value > PROFILE_PHOTO_MAX_SIZE:
            raise serializers.ValidationError('A profile picture can be up to 5 MB.')
        return value


class ProfilePhotoSerializer(serializers.Serializer):
    avatar_url = serializers.URLField(max_length=600)
