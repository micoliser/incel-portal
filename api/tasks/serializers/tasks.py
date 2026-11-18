"""Tasks, comments, history, attachments and drafts."""

import json
import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import URLValidator
from django.utils import timezone
from rest_framework import serializers

from common.serializers import UserSummarySerializer

from ..models import (
    Task,
    TaskActivity,
    TaskAttachment,
    TaskDraft,
)
from ..s3 import TaskAttachmentStorageError, generate_task_attachment_download_url

User = get_user_model()


# A request may assign work to at most this many people at once; beyond that
# one click could notify and email the whole company.
MAX_ASSIGNEES = 50


MAX_DRAFT_CONFIG_BYTES = 10_000


MAX_DRAFTS_PER_USER = 50


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


class TaskRejectSerializer(serializers.Serializer):
    """Sending work back: an optional reason, and where the task returns to."""

    reason = serializers.CharField(required=False, allow_blank=True, default='', max_length=2000)
    target_status = serializers.ChoiceField(choices=['in_progress', 'pending'], default='in_progress')


class TaskCommentCreateSerializer(serializers.Serializer):
    comment = serializers.CharField(allow_blank=True, trim_whitespace=True)
    attachments = serializers.ListField(child=serializers.DictField(), required=False)
    links = serializers.ListField(child=serializers.DictField(), required=False)

    def validate_comment(self, value):
        comment = value.strip()
        if not comment:
            raise serializers.ValidationError('Comment cannot be empty.')
        if len(comment) > 500:
            raise serializers.ValidationError('Comment cannot exceed 500 characters.')
        return comment

    def validate(self, attrs):
        # Validate attached links
        raw_links = attrs.get('links')
        if raw_links:
            if not isinstance(raw_links, list):
                raise serializers.ValidationError({'links': 'Links must be a list.'})
            if len(raw_links) > 10:
                raise serializers.ValidationError({'links': 'Maximum 10 links allowed.'})
            url_validator = URLValidator(schemes=['http', 'https'])
            validated_links = []
            for idx, item in enumerate(raw_links):
                if not isinstance(item, dict):
                    raise serializers.ValidationError({'links': f'Link at index {idx} must be an object.'})
                raw_url = str(item.get('url', '')).strip()
                if not raw_url:
                    raise serializers.ValidationError({'links': f'Link at index {idx} is missing a URL.'})
                try:
                    url_validator(raw_url)
                except DjangoValidationError:
                    raise serializers.ValidationError({'links': f'Link at index {idx} has an invalid URL.'})
                raw_title = str(item.get('title', '')).strip()[:200]
                validated_links.append({
                    'url': raw_url,
                    'title': raw_title or raw_url,
                })
            attrs['links'] = validated_links
        else:
            attrs['links'] = []

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


class TaskActivitySerializer(serializers.ModelSerializer):
    user = UserSummarySerializer(read_only=True)
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
            'links',
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
    assigned_by = UserSummarySerializer(read_only=True)
    assigned_to = UserSummarySerializer(read_only=True)
    recurrence_schedule = serializers.PrimaryKeyRelatedField(read_only=True)
    # The assigner is always the user creating the task, so there is no writable
    # assigner field. The assignee fields below are accepted on create only;
    # validate() rejects any attempt to change them on an existing task.
    assigned_to_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), write_only=True, source='assigned_to', required=False
    )
    assigned_to_ids = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True), write_only=True, many=True, required=False,
    )
    edit_reason = serializers.CharField(write_only=True, required=False, allow_blank=True)
    rejection_reason = serializers.CharField(write_only=True, required=False, allow_blank=True)

    class Meta:
        model = Task
        fields = [
            'id',
            'title',
            'description',
            'assigned_by',
            'assigned_to',
            'assigned_to_id',
            'assigned_to_ids',
            'status',
            'priority',
            'deadline',
            'recurrence_schedule',
            'recurrence_scheduled_for',
            'created_at',
            'updated_at',
            'completed_at',
            'edit_reason',
            'rejection_reason',
        ]
        read_only_fields = [
            'created_at',
            'updated_at',
            'completed_at',
            'assigned_by',
            'recurrence_schedule',
            'recurrence_scheduled_for',
        ]

    def validate_assigned_to_ids(self, value):
        if len(value) > MAX_ASSIGNEES:
            raise serializers.ValidationError(f'At most {MAX_ASSIGNEES} assignees at once.')
        return value

    def validate(self, attrs):
        request = self.context.get('request')
        current_user = getattr(request, 'user', None)
        deadline = attrs.get('deadline')
        errors = {}

        if not self.instance and deadline is None:
            errors['deadline'] = 'Deadline is required.'

        if deadline is not None:
            now = timezone.now().replace(second=0, microsecond=0)
            if deadline < now:
                errors['deadline'] = 'Deadline cannot be in the past.'

        if self.instance:
            # People on a task are fixed once it exists. Without this, the
            # assignee could reassign the task or make themselves the assigner
            # and approve their own work. Re-sending the current assignee is
            # harmless and is ignored.
            assigned_to = attrs.pop('assigned_to', None)
            assigned_to_ids = attrs.pop('assigned_to_ids', None)
            if assigned_to is not None and assigned_to != self.instance.assigned_to:
                errors['assigned_to_id'] = 'The assignee cannot be changed for an existing task.'
            if assigned_to_ids and any(user != self.instance.assigned_to for user in assigned_to_ids):
                errors['assigned_to_ids'] = 'The assignee cannot be changed for an existing task.'
        else:
            assigned_to = attrs.get('assigned_to')
            assigned_to_ids = attrs.get('assigned_to_ids')

            if not assigned_to and not assigned_to_ids:
                errors['assigned_to_id'] = 'Please select at least one assignee.'
            if assigned_to_ids and not assigned_to:
                attrs['assigned_to'] = assigned_to_ids[0]

            if current_user:
                if assigned_to and assigned_to == current_user:
                    errors['assigned_to_id'] = 'You cannot assign a task to yourself.'
                if assigned_to_ids and current_user in assigned_to_ids:
                    errors['assigned_to_ids'] = 'You cannot assign a task to yourself.'

        if errors:
            raise serializers.ValidationError(errors)

        if not self.instance:
            return attrs

        # Users cannot edit a completed task
        if self.instance.status == 'completed':
            editable_fields = {'title', 'description', 'priority', 'deadline'}
            has_detail_changes = any(
                field in attrs and getattr(self.instance, field) != attrs[field]
                for field in editable_fields
            )
            if has_detail_changes:
                raise serializers.ValidationError(
                    {'detail': 'Completed tasks cannot be edited.'}
                )
            new_status = attrs.get('status')
            if new_status and new_status != 'completed':
                raise serializers.ValidationError(
                    {'status': 'Completed tasks cannot be modified.'}
                )

        # Who may make a change is decided in the view (tasks.permissions.
        # require_may_change_task). Here: is the status change itself allowed?
        new_status = attrs.get('status')
        old_status = self.instance.status
        if new_status is None or new_status == old_status:
            return attrs

        if old_status == 'under_review':
            if new_status not in ['completed', 'in_progress', 'pending']:
                raise serializers.ValidationError(
                    {'status': 'Tasks under review can only be approved (completed) or rejected (in progress).'}
                )
        elif new_status == 'pending':
            raise serializers.ValidationError(
                {'status': 'Task progress cannot move back to pending once started.'}
            )
        elif new_status not in ['in_progress', 'under_review', 'completed']:
            raise serializers.ValidationError(
                {'status': f'Task status cannot be set to {new_status}.'}
            )

        return attrs


class TaskDraftSerializer(serializers.ModelSerializer):
    assigned_to_users = serializers.SerializerMethodField()

    class Meta:
        model = TaskDraft
        fields = [
            'id',
            'mode',
            'title',
            'description',
            'priority',
            'deadline',
            'assigned_to_ids',
            'assigned_to_users',
            'recurrence_config',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at', 'assigned_to_users']

    def validate_assigned_to_ids(self, value):
        if value in (None, ''):
            return []
        if not isinstance(value, list) or not all(isinstance(item, int) and item > 0 for item in value):
            raise serializers.ValidationError('Must be a list of user ids.')
        if len(value) > MAX_ASSIGNEES:
            raise serializers.ValidationError(f'At most {MAX_ASSIGNEES} assignees.')
        return value

    def validate_recurrence_config(self, value):
        if value is not None and len(json.dumps(value, default=str)) > MAX_DRAFT_CONFIG_BYTES:
            raise serializers.ValidationError('The recurrence settings are too large.')
        return value

    def get_assigned_to_users(self, obj):
        if not obj.assigned_to_ids:
            return []
        users = User.objects.filter(id__in=obj.assigned_to_ids)
        return UserSummarySerializer(users, many=True).data
