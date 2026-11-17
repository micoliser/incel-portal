from rest_framework import serializers

from applications.audit_messages import action_label, build_message, target_label
from applications.models import (
    ApplicationAccessOverride,
    AuditLog,
    InternalApplication,
    RecentApplication,
)
from applications.s3 import extract_application_logo_key_from_public_url
from common.serializers import UserSummarySerializer
from organization.models import Department


def _validated_department_ids(department_ids):
    if len(department_ids) != len(set(department_ids)):
        raise serializers.ValidationError('department_ids cannot contain duplicates.')

    existing_ids = set(Department.objects.filter(id__in=department_ids).values_list('id', flat=True))
    missing = [department_id for department_id in department_ids if department_id not in existing_ids]
    if missing:
        raise serializers.ValidationError(f'Invalid department IDs: {missing}')

    return department_ids


class InternalApplicationSerializer(serializers.ModelSerializer):
    """An application as one user sees it.

    Pass `access` in the context: `{application.id: (can_access, reason)}` from
    common.access.access_for_applications. The address of an application is
    only included for a user who may open it.
    """

    department_ids = serializers.SerializerMethodField()
    can_access = serializers.SerializerMethodField()
    access_reason = serializers.SerializerMethodField()
    app_url = serializers.SerializerMethodField()

    class Meta:
        model = InternalApplication
        fields = [
            'id',
            'name',
            'slug',
            'description',
            'app_url',
            'logo_url',
            'status',
            'access_scope',
            'visibility_scope',
            'department_ids',
            'can_access',
            'access_reason',
            'created_at',
            'updated_at',
        ]

    def _access(self, obj):
        access = self.context.get('access')
        if access is None or obj.id not in access:
            from common.access import can_user_access_application

            request = self.context.get('request')
            return can_user_access_application(getattr(request, 'user', None), obj)
        return access[obj.id]

    def get_department_ids(self, obj):
        # Uses the prefetched departments when the view loaded them.
        return [department.id for department in obj.departments.all()]

    def get_can_access(self, obj):
        return self._access(obj)[0]

    def get_access_reason(self, obj):
        return self._access(obj)[1]

    def get_app_url(self, obj):
        if self.context.get('show_all_urls'):
            return obj.app_url
        can_access, _reason = self._access(obj)
        if not can_access or obj.status == InternalApplication.Status.INACTIVE:
            return None
        return obj.app_url


class InternalApplicationWriteSerializer(serializers.ModelSerializer):
    department_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        allow_empty=True,
    )

    class Meta:
        model = InternalApplication
        fields = [
            'name',
            'slug',
            'description',
            'app_url',
            'logo_url',
            'status',
            'access_scope',
            'visibility_scope',
            'department_ids',
        ]

    def validate_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('name cannot be blank.')
        return value

    def validate_slug(self, value):
        value = value.strip().lower()
        if not value:
            raise serializers.ValidationError('slug cannot be blank.')
        return value

    def validate_description(self, value):
        return value.strip()

    def validate_logo_url(self, value):
        # Only a logo uploaded through this API; an unchanged value is kept as it is.
        if not value or (self.instance and value == self.instance.logo_url):
            return value
        if extract_application_logo_key_from_public_url(value) is None:
            raise serializers.ValidationError('The logo must be uploaded through the portal.')
        return value

    def validate_department_ids(self, value):
        return _validated_department_ids(value)


class ApplicationLogoUploadUrlSerializer(serializers.Serializer):
    slug = serializers.SlugField(max_length=180)
    file_name = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=100)

    def validate_file_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('file_name cannot be blank.')
        return value

    def validate_content_type(self, value):
        value = value.strip().lower()
        if not value:
            raise serializers.ValidationError('content_type cannot be blank.')
        allowed_types = ['image/png', 'image/jpeg', 'image/webp']
        if value not in allowed_types:
            raise serializers.ValidationError('content_type must be PNG, JPG, JPEG, or WebP.')
        return value


class AccessOverrideSerializer(serializers.ModelSerializer):
    user = UserSummarySerializer(read_only=True)
    application_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = ApplicationAccessOverride
        fields = ['id', 'application_id', 'user', 'effect', 'reason', 'expires_at', 'created_at', 'updated_at']


class AccessOverrideCreateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)
    effect = serializers.ChoiceField(choices=ApplicationAccessOverride.Effect.choices)
    reason = serializers.CharField(required=False, allow_blank=True)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_reason(self, value):
        return value.strip()


class AuditLogSerializer(serializers.ModelSerializer):
    actor_user = UserSummarySerializer(read_only=True)
    action_label = serializers.SerializerMethodField()
    target_label = serializers.SerializerMethodField()
    message = serializers.SerializerMethodField()
    metadata = serializers.JSONField(source='metadata_json', read_only=True)

    class Meta:
        model = AuditLog
        fields = [
            'id',
            'actor_user',
            'action',
            'action_label',
            'target_type',
            'target_id',
            'target_label',
            'message',
            'metadata',
            'ip_address',
            'created_at',
            'updated_at',
        ]

    def get_action_label(self, obj):
        return action_label(obj.action)

    def get_target_label(self, obj):
        return target_label(obj.target_type, obj.target_id)

    def get_message(self, obj):
        return build_message(
            obj.action,
            obj.metadata_json,
            target_type=obj.target_type,
            target_id=obj.target_id,
        )


class RecentApplicationSerializer(serializers.ModelSerializer):
    application = InternalApplicationSerializer()

    class Meta:
        model = RecentApplication
        fields = [
            'id',
            'application',
            'opened_at',
        ]
