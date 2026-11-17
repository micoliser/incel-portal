from django.contrib.auth.models import User
from rest_framework import serializers

from common.users import display_name


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
