import os

from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework import serializers

from .models import Task, TaskActivity, TaskAttachment
from .s3 import TaskAttachmentStorageError, generate_task_attachment_download_url


def _allowed_attachment_content_types() -> set[str]:
    values = getattr(settings, 'TASK_ATTACHMENT_ALLOWED_CONTENT_TYPES', [])
    return {str(value).strip() for value in values if str(value).strip()}


def _max_attachment_size() -> int:
    return int(getattr(settings, 'TASK_ATTACHMENT_MAX_SIZE', 10 * 1024 * 1024))


def _normalize_file_name(file_name: str) -> str:
    normalized = os.path.basename(str(file_name).replace('\\', '/')).strip()
    if not normalized:
        raise serializers.ValidationError('file_name is required.')
    if len(normalized) > 255:
        raise serializers.ValidationError('file_name must be 255 characters or fewer.')
    return normalized


def _validate_attachment_content_type(content_type: str) -> str:
    normalized = str(content_type).strip()
    if not normalized:
        raise serializers.ValidationError('content_type is required.')

    allowed_types = _allowed_attachment_content_types()
    if allowed_types and normalized not in allowed_types:
        raise serializers.ValidationError('Unsupported attachment content type.')

    return normalized


def _validate_attachment_size(size: int) -> int:
    max_size = _max_attachment_size()
    if size <= 0:
        raise serializers.ValidationError('size must be greater than zero.')
    if size > max_size:
        raise serializers.ValidationError(f'Attachment size must be {max_size} bytes or smaller.')
    return size


class TaskAttachmentUploadRequestSerializer(serializers.Serializer):
    file_name = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=255)
    size = serializers.IntegerField(min_value=1)

    def validate_file_name(self, value):
        return _normalize_file_name(value)

    def validate_content_type(self, value):
        return _validate_attachment_content_type(value)

    def validate_size(self, value):
        return _validate_attachment_size(value)


class TaskCommentCreateSerializer(serializers.Serializer):
    comment = serializers.CharField(allow_blank=True, trim_whitespace=True)
    attachments = serializers.ListField(child=serializers.DictField(), required=False)

    def validate_comment(self, value):
        comment = value.strip()
        if not comment:
            raise serializers.ValidationError('Comment cannot be empty.')
        if len(comment) > 200:
            raise serializers.ValidationError('Comment cannot exceed 200 characters.')
        return comment

    def validate(self, attrs):
        # Backwards compatibility: accept single-file legacy fields and normalize
        # Note: legacy fields may appear in initial_data but not in attrs (since not defined fields),
        # so check self.initial_data as well.
        if 'attachments' not in attrs:
            init = getattr(self, 'initial_data', {}) or {}
            if 'attachments' not in init and any(k in init for k in ('attachment_object_key', 'attachment_file_name', 'attachment_content_type', 'attachment_size')):
                single = {
                    'object_key': init.get('attachment_object_key'),
                    'file_name': init.get('attachment_file_name'),
                    'content_type': init.get('attachment_content_type'),
                    'size': init.get('attachment_size'),
                }
                attrs['attachments'] = [single]

        # Validate attachments list (if provided)
        attachments = attrs.get('attachments')
        if attachments is None:
            return attrs

        if not isinstance(attachments, list):
            raise serializers.ValidationError({'attachments': 'Attachments must be a list.'})

        max_files = int(getattr(settings, 'TASK_ATTACHMENT_MAX_FILES', 10))
        if len(attachments) > max_files:
            raise serializers.ValidationError({'attachments': f'Maximum {max_files} attachments allowed.'})

        validated = []
        for idx, item in enumerate(attachments):
            if not isinstance(item, dict):
                raise serializers.ValidationError({'attachments': f'Attachment at index {idx} must be an object.'})

            required_keys = ('object_key', 'file_name', 'content_type', 'size')
            missing = [k for k in required_keys if item.get(k) in (None, '')]
            if missing:
                raise serializers.ValidationError({'attachments': f'Attachment at index {idx} missing fields: {", ".join(missing)}'})

            # validate file_name, content_type, size via upload serializer
            attachment_serializer = TaskAttachmentUploadRequestSerializer(
                data={
                    'file_name': item['file_name'],
                    'content_type': item['content_type'],
                    'size': item['size'],
                }
            )
            attachment_serializer.is_valid(raise_exception=True)

            validated.append({
                'object_key': item['object_key'],
                'file_name': attachment_serializer.validated_data['file_name'],
                'content_type': attachment_serializer.validated_data['content_type'],
                'size': attachment_serializer.validated_data['size'],
            })

        attrs['attachments'] = validated

        return attrs


class UserSimpleSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    full_name = serializers.CharField(source='get_full_name', read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'full_name', 'email']


class TaskActivitySerializer(serializers.ModelSerializer):
    user = UserSimpleSerializer(read_only=True)
    attachments = serializers.SerializerMethodField()

    class Meta:
        model = TaskActivity
        fields = [
            'id',
            'task',
            'user',
            'activity_type',
            'old_value',
            'new_value',
            'comment',
            'attachments',
            'created_at',
        ]
        read_only_fields = ['user', 'created_at', 'task', 'attachments']

    def get_attachments(self, obj):
        return TaskAttachmentSerializer(obj.attachments.all(), many=True).data


class TaskAttachmentSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = TaskAttachment
        fields = [
            'id',
            'file_name',
            'content_type',
            'size',
            'download_url',
            'created_at',
        ]
        read_only_fields = fields

    def get_download_url(self, obj):
        try:
            payload = generate_task_attachment_download_url(
                object_key=obj.object_key,
                file_name=obj.file_name,
                content_type=obj.content_type,
            )
        except TaskAttachmentStorageError:
            return None

        return payload['download_url']


class TaskSerializer(serializers.ModelSerializer):
    assigned_by = UserSimpleSerializer(read_only=True)
    assigned_to = UserSimpleSerializer(read_only=True)
    assigned_by_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), write_only=True, source='assigned_by', required=False
    )
    assigned_to_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), write_only=True, source='assigned_to'
    )

    class Meta:
        model = Task
        fields = [
            'id',
            'title',
            'description',
            'assigned_by',
            'assigned_by_id',
            'assigned_to',
            'assigned_to_id',
            'status',
            'priority',
            'deadline',
            'created_at',
            'updated_at',
            'completed_at',
        ]
        read_only_fields = ['created_at', 'updated_at', 'completed_at', 'assigned_by']

    def validate(self, attrs):
        request = self.context.get('request')
        current_user = getattr(request, 'user', None)
        deadline = attrs.get('deadline')

        if not self.instance and deadline is None:
            raise serializers.ValidationError(
                {'deadline': 'Deadline is required.'}
            )

        if deadline is not None:
            now = timezone.now().replace(second=0, microsecond=0)
            if deadline < now:
                raise serializers.ValidationError(
                    {'deadline': 'Deadline cannot be in the past.'}
                )

        assigned_to = attrs.get('assigned_to')
        if assigned_to is not None and current_user and assigned_to == current_user:
            raise serializers.ValidationError(
                {'assigned_to_id': 'You cannot assign a task to yourself.'}
            )

        if not self.instance:
            return attrs

        new_status = attrs.get('status')
        if new_status is None:
            return attrs

        old_status = self.instance.status
        if new_status == old_status:
            return attrs

        if current_user and current_user != self.instance.assigned_to:
            raise serializers.ValidationError(
                {'status': 'Only the assignee can change task progress.'}
            )

        if new_status == 'pending' and old_status != 'pending':
            raise serializers.ValidationError(
                {'status': 'Task progress cannot move back to pending once started.'}
            )

        return attrs
