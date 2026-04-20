from rest_framework import serializers

from applications.models import ApplicationAccessOverride, AuditLog, InternalApplication
from organization.models import Department


def _validated_department_ids(department_ids):
    if len(department_ids) != len(set(department_ids)):
        raise serializers.ValidationError('department_ids cannot contain duplicates.')

    if any(department_id < 1 for department_id in department_ids):
        raise serializers.ValidationError('department_ids must contain positive integers only.')

    existing_ids = set(Department.objects.filter(id__in=department_ids).values_list('id', flat=True))
    missing = [department_id for department_id in department_ids if department_id not in existing_ids]
    if missing:
        raise serializers.ValidationError(f'Invalid department IDs: {missing}')

    return department_ids


class InternalApplicationSerializer(serializers.ModelSerializer):
    department_ids = serializers.SerializerMethodField()

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
            'created_at',
            'updated_at',
        ]

    def get_department_ids(self, obj):
        return list(obj.departments.values_list('id', flat=True))


class InternalApplicationWriteSerializer(serializers.ModelSerializer):
    department_ids = serializers.ListField(
        child=serializers.IntegerField(),
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
        if not value.startswith('image/'):
            raise serializers.ValidationError('content_type must be an image MIME type.')
        return value


class AccessOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = ApplicationAccessOverride
        fields = ['id', 'application', 'user', 'effect', 'reason', 'expires_at', 'created_at', 'updated_at']


class AccessOverrideCreateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)
    effect = serializers.ChoiceField(choices=ApplicationAccessOverride.Effect.choices)
    reason = serializers.CharField(required=False, allow_blank=True)
    expires_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_reason(self, value):
        return value.strip()


class SetApplicationDepartmentsSerializer(serializers.Serializer):
    department_ids = serializers.ListField(
        child=serializers.IntegerField(min_value=1),
        allow_empty=True,
    )

    def validate_department_ids(self, value):
        return _validated_department_ids(value)


class AuditLogSerializer(serializers.ModelSerializer):
    actor_username = serializers.SerializerMethodField()

    class Meta:
        model = AuditLog
        fields = [
            'id',
            'actor_user',
            'actor_username',
            'action',
            'target_type',
            'target_id',
            'metadata_json',
            'ip_address',
            'created_at',
            'updated_at',
        ]

    def get_actor_username(self, obj):
        if not obj.actor_user:
            return None
        return obj.actor_user.username
