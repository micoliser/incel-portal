"""Checking weekly goals against a summary."""

from __future__ import annotations

from datetime import datetime

from django.contrib.auth import get_user_model

from ..models import (
    UserGoal,
)

User = get_user_model()


def check_user_goals(user: User, week_start: datetime.date, week_end: datetime.date, summary_data: dict) -> dict:
    """Check if user achieved their goals for the week"""
    
    goals = UserGoal.objects.filter(
        user=user,
        is_active=True,
        period_start__lte=week_start,
        period_end__gte=week_end
    )
    
    goal_results = {}
    for goal in goals:
        metric = goal.metric
        current_value = summary_data.get(
            metric.replace('_', '_percent') if 'rate' in metric else metric, 0
        )
        
        achieved = current_value >= goal.target_value
        goal_results[metric] = {
            'target': goal.target_value,
            'current': current_value,
            'achieved': achieved,
            'difference': current_value - goal.target_value,
        }
    
    return goal_results
