import uuid
from datetime import datetime

from django.contrib.auth import get_user_model
from rest_framework import serializers

from common.users import display_name

User = get_user_model()


class UserSummarySerializer(serializers.ModelSerializer):
    """How a user appears wherever another record refers to one (an assignee,
    an author, a manager). Every app uses this one shape."""

    full_name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'email', 'first_name', 'last_name', 'full_name', 'is_active']
        read_only_fields = fields

    def get_full_name(self, obj):
        return display_name(obj)


class OptionalUUIDField(serializers.Field):
    """A UUID, or None when missing or blank. Same message as `common.params.uuid_param`."""

    def __init__(self, **kwargs):
        kwargs.setdefault('required', False)
        kwargs.setdefault('allow_null', True)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        text = str(data).strip()
        if not text:
            return None
        try:
            return uuid.UUID(text)
        except ValueError:
            raise serializers.ValidationError('Must be a valid UUID.')

    def to_representation(self, value):
        return str(value) if value else None


class OptionalDateField(serializers.Field):
    """A YYYY-MM-DD date, or None when missing or blank. Same message as `common.params.date_param`."""

    def __init__(self, **kwargs):
        kwargs.setdefault('required', False)
        kwargs.setdefault('allow_null', True)
        super().__init__(**kwargs)

    def to_internal_value(self, data):
        text = str(data).strip()
        if not text:
            return None
        try:
            return datetime.strptime(text, '%Y-%m-%d').date()
        except ValueError:
            raise serializers.ValidationError('Must be a date in YYYY-MM-DD format.')

    def to_representation(self, value):
        return value.isoformat() if value else None
