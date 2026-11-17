"""Weekly goals."""

import logging
from datetime import timedelta

from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ViewSet

from common.exceptions import Conflict
from common.params import date_param

from ..models import (
    UserGoal,
    WeeklySummary,
)
from ..serializers import (
    UserGoalCreateSerializer,
    UserGoalSerializer,
)
from ..services import (
    calculate_user_weekly_summary,
    check_user_goals,
)

logger = logging.getLogger(__name__)

def _get_week_bounds_from_start(week_start_date):

    return week_start_date, week_start_date + timedelta(days=6)


def _get_current_week_bounds():

    week_start = timezone.localdate() - timedelta(days=timezone.localdate().weekday())
    return week_start, week_start + timedelta(days=6)


def _get_goal_summary_data(user, week_start_date, week_end_date):
    summary = WeeklySummary.objects.filter(
        user=user,
        week_start_date=week_start_date,
    ).first()

    if summary:
        return summary.summary_data or {}


    return calculate_user_weekly_summary(user, week_start_date, week_end_date)


def _serialize_goals_with_progress(user, goals, week_start_date, week_end_date, summary_data):

    progress_map = check_user_goals(user, week_start_date, week_end_date, summary_data)
    serializer = UserGoalSerializer(goals, many=True)
    payload = []

    for goal in serializer.data:
        payload.append({
            **goal,
            'progress': progress_map.get(goal['metric']),
        })

    return payload


class GoalsViewSet(ViewSet):
    permission_classes = [IsAuthenticated]

    def _resolve_week(self, request):
        week_start = (
            date_param(request.query_params, 'week_start_date')
            or date_param(request.data, 'week_start_date')
        )
        if not week_start:
            week_start, _ = _get_current_week_bounds()

        return _get_week_bounds_from_start(week_start)

    def _list_goals_for_week(self, request, week_start, week_end):
        try:
            summary_data = _get_goal_summary_data(request.user, week_start, week_end)
        except WeeklySummary.DoesNotExist:
            raise NotFound('Summary not found for the specified week')

        goals = UserGoal.objects.filter(
            user=request.user,
            is_active=True,
            period_start=week_start,
            period_end=week_end,
        ).order_by('-created_at')

        return Response({
            'week_start_date': str(week_start),
            'week_end_date': str(week_end),
            'goals': _serialize_goals_with_progress(request.user, goals, week_start, week_end, summary_data),
        })

    def list(self, request):
        week_start, week_end = self._resolve_week(request)
        return self._list_goals_for_week(request, week_start, week_end)

    def create(self, request):
        serializer = UserGoalCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        week_start = serializer.validated_data.get('week_start_date')
        if week_start is None:
            week_start, week_end = _get_current_week_bounds()
        else:
            week_start, week_end = _get_week_bounds_from_start(week_start)

        if UserGoal.objects.filter(
            user=request.user,
            metric=serializer.validated_data['metric'],
            period_start=week_start,
            period_end=week_end,
            is_active=True,
        ).exists():
            raise Conflict('Goal already exists for this week and metric')

        goal = UserGoal.objects.create(
            user=request.user,
            metric=serializer.validated_data['metric'],
            target_value=serializer.validated_data['target_value'],
            period_start=week_start,
            period_end=week_end,
        )

        summary_data = _get_goal_summary_data(request.user, week_start, week_end)
        progress_map = _serialize_goals_with_progress(request.user, [goal], week_start, week_end, summary_data)
        return Response(progress_map[0], status=status.HTTP_201_CREATED)
