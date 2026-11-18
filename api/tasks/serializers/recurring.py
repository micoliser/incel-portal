"""Recurring schedules."""

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework import serializers

from common.serializers import UserSummarySerializer

from ..models import (
    RecurringSchedule,
)
from .tasks import MAX_ASSIGNEES

User = get_user_model()


class RecurringScheduleSerializer(serializers.ModelSerializer):
    assigned_by = UserSummarySerializer(read_only=True)
    assigned_to = UserSummarySerializer(read_only=True)
    assigned_to_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True),
        write_only=True,
        source='assigned_to',
        required=False,
    )
    assigned_to_ids = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.filter(is_active=True),
        write_only=True,
        many=True,
        required=False,
    )
    paused_by = UserSummarySerializer(read_only=True)
    ended_by = UserSummarySerializer(read_only=True)
    weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        required=False,
        allow_empty=True,
        max_length=7,
    )
    # At most one run an hour.
    times = serializers.ListField(
        child=serializers.CharField(max_length=8),
        required=False,
        allow_empty=False,
        max_length=24,
    )
    interval = serializers.IntegerField(required=False, min_value=1, max_value=365)
    # At most a year after the run.
    deadline_offset_minutes = serializers.IntegerField(required=False, min_value=0, max_value=525_600, default=0)

    class Meta:
        model = RecurringSchedule
        fields = [
            'id',
            'title',
            'description',
            'assigned_by',
            'assigned_to',
            'assigned_to_id',
            'assigned_to_ids',
            'priority',
            'frequency',
            'interval',
            'include_weekends',
            'weekdays',
            'times',
            'timezone',
            'deadline_offset_minutes',
            'start_at',
            'end_at',
            'next_run_at',
            'is_active',
            'is_paused',
            'paused_at',
            'paused_by',
            'ended_at',
            'ended_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'assigned_by',
            'assigned_to',
            'next_run_at',
            'is_active',
            'is_paused',
            'paused_at',
            'paused_by',
            'ended_at',
            'ended_by',
            'created_at',
            'updated_at',
        ]

    def validate_assigned_to_id(self, value):
        if self.instance and value != self.instance.assigned_to:
            raise serializers.ValidationError(
                'The assignee cannot be changed for an existing recurring schedule.'
            )
        return value

    def validate_timezone(self, value):
        timezone_name = str(value).strip() or 'UTC'
        try:
            ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError as exc:
            raise serializers.ValidationError('Timezone is invalid.') from exc
        return timezone_name

    def validate_times(self, value):
        normalized: list[str] = []
        seen: set[str] = set()
        for raw_time in value:
            time_value = str(raw_time).strip()
            try:
                parsed = datetime.strptime(time_value, '%H:%M')
            except ValueError as exc:
                raise serializers.ValidationError('Times must use HH:MM format.') from exc

            normalized_time = parsed.strftime('%H:%M')
            if normalized_time in seen:
                continue
            seen.add(normalized_time)
            normalized.append(normalized_time)

        if not normalized:
            raise serializers.ValidationError('At least one time is required.')

        return normalized

    def validate_weekdays(self, value):
        normalized: list[int] = []
        seen: set[int] = set()
        for raw_day in value:
            weekday = int(raw_day)
            if weekday in seen:
                continue
            seen.add(weekday)
            normalized.append(weekday)
        return normalized

    def validate_assigned_to_ids(self, value):
        if len(value) > MAX_ASSIGNEES:
            raise serializers.ValidationError(f'At most {MAX_ASSIGNEES} assignees at once.')
        return value

    def validate(self, attrs):
        request = self.context.get('request')
        current_user = getattr(request, 'user', None)
        assigned_to = attrs.get('assigned_to')
        assigned_to_ids = attrs.get('assigned_to_ids')
        errors = {}

        if not self.instance:
            if not assigned_to and not assigned_to_ids:
                errors['assigned_to_id'] = 'Please select at least one assignee.'
            if assigned_to_ids and not assigned_to:
                attrs['assigned_to'] = assigned_to_ids[0]

        if current_user:
            if assigned_to and assigned_to == current_user:
                errors['assigned_to_id'] = 'You cannot assign a recurring task to yourself.'
            if assigned_to_ids and current_user in assigned_to_ids:
                errors['assigned_to_ids'] = 'You cannot assign a recurring task to yourself.'

        if attrs.get('frequency') == 'weekly' and not attrs.get('weekdays'):
            errors['weekdays'] = 'Weekly recurring tasks require at least one weekday.'

        if attrs.get('interval', 1) < 1:
            errors['interval'] = 'Interval must be at least 1.'

        start_at = attrs.get('start_at')
        end_at = attrs.get('end_at')
        if start_at and end_at and end_at < start_at:
            errors['end_at'] = 'End date must be after the start date.'

        if self.instance and (not self.instance.is_active or self.instance.ended_at is not None):
            raise serializers.ValidationError(
                {'detail': 'Ended recurring task schedules cannot be edited.'}
            )

        if self.instance and start_at and start_at != self.instance.start_at:
            if self.instance.start_at <= timezone.now():
                errors['start_at'] = 'Start date cannot be changed after the schedule has started.'

        if errors:
            raise serializers.ValidationError(errors)

        return attrs

    def create(self, validated_data):
        validated_data['assigned_by'] = self.context['request'].user
        return super().create(validated_data)
