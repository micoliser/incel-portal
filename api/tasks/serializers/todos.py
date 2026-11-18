"""To-do items."""

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers

from ..models import (
    TodoItem,
)


class TodoSnoozeSerializer(serializers.Serializer):
    minutes = serializers.IntegerField(min_value=1, default=10)


class TodoItemSerializer(serializers.ModelSerializer):
    reminder_offsets = serializers.ListField(
        child=serializers.CharField(max_length=32), required=False, max_length=20,
    )
    is_overdue = serializers.SerializerMethodField()
    status_category = serializers.SerializerMethodField()

    class Meta:
        model = TodoItem
        fields = [
            'id',
            'title',
            'description',
            'due_date',
            'due_time',
            'due_datetime',
            'priority',
            'is_completed',
            'completed_at',
            'reminder_at',
            'reminder_offset',
            'reminder_offsets',
            'reminders_sent',
            'reminder_sent',
            'reminder_sent_at',
            'send_email_reminder',
            'is_overdue',
            'status_category',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'completed_at',
            'reminders_sent',
            'reminder_sent',
            'reminder_sent_at',
            'is_overdue',
            'status_category',
            'created_at',
            'updated_at',
        ]

    def get_is_overdue(self, obj):
        if obj.is_completed or not obj.due_datetime:
            return False
        return obj.due_datetime < timezone.now()

    def get_status_category(self, obj):
        if obj.is_completed:
            return 'completed'
        if not obj.due_datetime:
            return 'no_date'
        now = timezone.now()
        if obj.due_datetime < now:
            return 'overdue'
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        today_end = today_start + timedelta(days=1)
        if today_start <= obj.due_datetime < today_end:
            return 'today'
        return 'upcoming'

    def create(self, validated_data):
        validated_data['user'] = self.context['request'].user
        return super().create(validated_data)
