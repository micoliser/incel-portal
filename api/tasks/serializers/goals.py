"""Weekly goals."""

import math

from rest_framework import serializers

from common.serializers import OptionalDateField

from ..models import (
    UserGoal,
)


class GoalWeekSerializer(serializers.Serializer):
    """The week a goals request is about, when sent in the body."""

    week_start_date = OptionalDateField()


class UserGoalCreateSerializer(serializers.Serializer):
    """Serializer for creating a current-week user goal"""
    metric = serializers.ChoiceField(choices=UserGoal.GOAL_METRICS)
    target_value = serializers.FloatField()
    week_start_date = serializers.DateField(required=False)

    def validate_target_value(self, value):
        # FloatField accepts "nan" and "inf", which cannot be stored or sent back as JSON.
        if not math.isfinite(value):
            raise serializers.ValidationError('Target must be a number.')
        return value


class UserGoalSerializer(serializers.ModelSerializer):
    """Serializer for user goals"""
    class Meta:
        model = UserGoal
        fields = ['id', 'metric', 'target_value', 'period_start', 'period_end', 'is_active', 'created_at']
        read_only_fields = ['id', 'created_at']
