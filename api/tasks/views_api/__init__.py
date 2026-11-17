"""API views for the tasks app, one module per domain.

Everything is re-exported here so `tasks.api_urls` and other importers can
keep using `tasks.views_api.<ViewName>`.
"""

from .goals import GoalsViewSet
from .recurring import RecurringScheduleViewSet
from .reports import (
    DailyReportDetailView,
    DailyReportSendEmailView,
    DailyReportSubreportCommentView,
    DailyReportSubreportCreateView,
    DailyReportSubreportDetailView,
    DepartmentReportsAllView,
    ReportsDayView,
    ReportsMonthCalendarView,
)
from .summaries import SummaryFilesViewSet, WeeklySummaryViewSet
from .tasks import TaskDraftViewSet, TaskViewSet
from .todos import TodoItemViewSet

__all__ = [
    'DailyReportDetailView',
    'DailyReportSendEmailView',
    'DailyReportSubreportCommentView',
    'DailyReportSubreportCreateView',
    'DailyReportSubreportDetailView',
    'DepartmentReportsAllView',
    'GoalsViewSet',
    'RecurringScheduleViewSet',
    'ReportsDayView',
    'ReportsMonthCalendarView',
    'SummaryFilesViewSet',
    'TaskDraftViewSet',
    'TaskViewSet',
    'TodoItemViewSet',
    'WeeklySummaryViewSet',
]
