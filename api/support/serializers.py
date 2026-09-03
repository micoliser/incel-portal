from django.core.validators import RegexValidator
from django.contrib.auth.models import User
from rest_framework import serializers

from .models import SupportAttachment, SupportComment, SupportRequest
from .s3 import generate_support_attachment_download_url


class UserBasicSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'full_name', 'email']

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username


class DepartmentBasicSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    code = serializers.CharField()


# ---------------------------------------------------------------------------
# Attachment
# ---------------------------------------------------------------------------

class SupportAttachmentSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = SupportAttachment
        fields = ['id', 'file_name', 'content_type', 'size', 'download_url', 'created_at']

    def get_download_url(self, obj):
        try:
            return generate_support_attachment_download_url(
                object_key=obj.object_key,
                file_name=obj.file_name,
                content_type=obj.content_type,
            )
        except Exception:
            return None


class SupportAttachmentUploadRequestSerializer(serializers.Serializer):
    file_name = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=255)
    size = serializers.IntegerField(min_value=1)



class SupportAttachmentConfirmSerializer(serializers.Serializer):
    object_key = serializers.CharField(
        max_length=1024,
        validators=[
            RegexValidator(
                regex=r'^[\w-]+/[\w-]+/[0-9a-f]{32}(?:\.[a-zA-Z0-9_.-]+)?$',
                message='Invalid attachment key format.'
            )
        ]
    )
    file_name = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=255)
    size = serializers.IntegerField(min_value=1)


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

class SupportCommentSerializer(serializers.ModelSerializer):
    author = UserBasicSerializer(read_only=True)
    attachments = SupportAttachmentSerializer(many=True, read_only=True)

    class Meta:
        model = SupportComment
        fields = ['id', 'author', 'body', 'is_system', 'attachments', 'created_at']


class SupportCommentCreateSerializer(serializers.Serializer):
    body = serializers.CharField()


# ---------------------------------------------------------------------------
# Support Request
# ---------------------------------------------------------------------------

class SupportRequestListSerializer(serializers.ModelSerializer):
    requester = UserBasicSerializer(read_only=True)
    department = DepartmentBasicSerializer(read_only=True)
    assigned_to = UserBasicSerializer(read_only=True, allow_null=True)
    can_manage = serializers.SerializerMethodField()

    class Meta:
        model = SupportRequest
        fields = [
            'id', 'title', 'category', 'priority', 'status',
            'requester', 'department', 'assigned_to',
            'can_manage',
            'created_at', 'updated_at',
        ]

    def get_can_manage(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        return obj.department and obj.department.line_manager_id == request.user.id


class SupportRequestDetailSerializer(serializers.ModelSerializer):
    requester = UserBasicSerializer(read_only=True)
    department = DepartmentBasicSerializer(read_only=True)
    assigned_to = UserBasicSerializer(read_only=True, allow_null=True)
    assigned_by = UserBasicSerializer(read_only=True, allow_null=True)
    comments = SupportCommentSerializer(many=True, read_only=True)
    attachments = SupportAttachmentSerializer(many=True, read_only=True)
    attachment_count = serializers.SerializerMethodField()
    can_manage = serializers.SerializerMethodField()
    can_act = serializers.SerializerMethodField()

    class Meta:
        model = SupportRequest
        fields = [
            'id', 'title', 'category', 'priority', 'description', 'status',
            'requester', 'department', 'assigned_to', 'assigned_by',
            'line_manager', 'resolved_at', 'closed_at',
            'comments', 'attachments', 'attachment_count',
            'can_manage', 'can_act',
            'created_at', 'updated_at',
        ]

    def get_attachment_count(self, obj):
        return obj.attachments.count()

    def _is_line_manager(self, obj):
        """Check if the requesting user is the line manager of the request's department."""
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        return obj.department and obj.department.line_manager_id == request.user.id

    def get_can_manage(self, obj):
        """Current user can manage (assign) this request."""
        return self._is_line_manager(obj)

    def get_can_act(self, obj):
        """Current user can act on this request: assigned handler, or line manager (only if unassigned)."""
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return False
        # Assigned handler can always act on their assigned request
        if obj.assigned_to == request.user:
            return True
        # Line manager can act only if the request has not yet been assigned
        if self._is_line_manager(obj) and obj.assigned_to is None:
            return True
        # Requester can confirm/reopen when resolved or closed
        if obj.requester == request.user and obj.status in ('resolved', 'closed'):
            return True
        return False


class SupportRequestCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    category = serializers.ChoiceField(choices=SupportRequest.CATEGORY_CHOICES)
    priority = serializers.ChoiceField(choices=SupportRequest.PRIORITY_CHOICES, default='medium')
    description = serializers.CharField()


class SupportRequestAssignSerializer(serializers.Serializer):
    assigned_to = serializers.IntegerField()

    def validate_assigned_to(self, value):
        try:
            return User.objects.get(id=value, is_active=True)
        except User.DoesNotExist:
            raise serializers.ValidationError('User not found or inactive.')


class SupportRequestStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[
        choice for choice in SupportRequest.STATUS_CHOICES
        if choice[0] in ('open', 'assigned', 'in_progress', 'resolved', 'closed')
    ])
