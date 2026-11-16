"""API views for the tasks app, one module per domain.

Everything is re-exported here so `tasks.api_urls` and other importers can
keep using `tasks.views_api.<ViewName>`.
"""

from .goals import GoalsViewSet
from .recurring import RecurringSchedulePagination, RecurringScheduleViewSet
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
from .tasks import TaskDraftViewSet, TaskPagination, TaskViewSet
from .todos import TodoItemViewSet, TodoPagination

__all__ = [
    'DailyReportDetailView',
    'DailyReportSendEmailView',
    'DailyReportSubreportCommentView',
    'DailyReportSubreportCreateView',
    'DailyReportSubreportDetailView',
    'DepartmentReportsAllView',
    'GoalsViewSet',
    'RecurringSchedulePagination',
    'RecurringScheduleViewSet',
    'ReportsDayView',
    'ReportsMonthCalendarView',
    'SummaryFilesViewSet',
    'TaskDraftViewSet',
    'TaskPagination',
    'TaskViewSet',
    'TodoItemViewSet',
    'TodoPagination',
    'WeeklySummaryViewSet',
]
