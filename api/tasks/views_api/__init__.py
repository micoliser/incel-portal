"""API views for the tasks app, one module per domain.

Everything is re-exported here so `tasks.api_urls` and other importers can
keep using `tasks.views_api.<ViewName>`.
"""

from .goals import GoalsViewSet
from .recurring import RecurringScheduleViewSet
from .reports import (
    DailyReportSubreportViewSet,
    DailyReportViewSet,
)
from .summaries import SummaryFilesViewSet, WeeklySummaryViewSet
from .tasks import TaskDraftViewSet, TaskViewSet
from .todos import TodoItemViewSet

__all__ = [
    'DailyReportSubreportViewSet',
    'DailyReportViewSet',
    'GoalsViewSet',
    'RecurringScheduleViewSet',
    'SummaryFilesViewSet',
    'TaskDraftViewSet',
    'TaskViewSet',
    'TodoItemViewSet',
    'WeeklySummaryViewSet',
]
