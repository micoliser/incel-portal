from django.urls import include, path

import common.converters  # noqa: F401  (registers the isodate path converter)
from common.routers import ApiRouter

from .views_api import (
    DailyReportSubreportViewSet,
    DailyReportViewSet,
    GoalsViewSet,
    RecurringScheduleViewSet,
    SummaryFilesViewSet,
    TaskDraftViewSet,
    TaskViewSet,
    TodoItemViewSet,
    WeeklySummaryViewSet,
)

router = ApiRouter()
router.register(r'todos', TodoItemViewSet, basename='todo')
router.register(r'task-drafts', TaskDraftViewSet, basename='task-draft')
router.register(r'tasks', TaskViewSet, basename='task')
router.register(r'recurring-schedules', RecurringScheduleViewSet, basename='recurring-schedule')
router.register(r'goals', GoalsViewSet, basename='goal')

summary = WeeklySummaryViewSet.as_view
reports = DailyReportViewSet.as_view
subreports = DailyReportSubreportViewSet.as_view

urlpatterns = [
    path('', include(router.urls)),
    path('reports/month', reports({'get': 'month'}), name='reports-month-calendar'),
    path('reports/day', reports({'get': 'day', 'post': 'add_to_day'}), name='reports-day-hub'),
    path('reports/all', reports({'get': 'department_all'}), name='reports-department-all'),
    path('reports/daily/<uuid:report_id>', reports({'get': 'retrieve'}), name='reports-daily-detail'),
    path('reports/daily/<uuid:report_id>/send-email', reports({'post': 'send_email'}), name='reports-daily-send-email'),
    path(
        'reports/daily/<uuid:report_id>/subreports',
        reports({'post': 'add_subreport'}),
        name='reports-daily-subreports-create',
    ),
    path('reports/subreports/<uuid:subreport_id>', subreports({'get': 'retrieve'}), name='reports-subreport-detail'),
    path(
        'reports/subreports/<uuid:subreport_id>/comments',
        subreports({'post': 'add_comment'}),
        name='reports-subreport-comments',
    ),
    # Weekly summaries. A summary is addressed by the Monday its week starts on.
    path('summaries/weeks', summary({'get': 'weeks'}), name='summary-weeks'),
    path('summaries/weeks/<isodate:week>', summary({'get': 'retrieve'}), name='summary-detail'),
    path('summaries/weeks/<isodate:week>/comparison', summary({'get': 'comparison'}), name='summary-comparison'),
    path('summaries/weeks/<isodate:week>/history', summary({'get': 'history'}), name='summary-history'),
    path(
        'summaries/weeks/<isodate:week>/share',
        summary({'get': 'share_status', 'post': 'share_create', 'delete': 'share_revoke'}),
        name='summary-share',
    ),
    path(
        'summaries/weeks/<isodate:week>/user-shares',
        summary({'get': 'user_shares', 'post': 'user_share_create'}),
        name='summary-user-shares',
    ),
    path(
        'summaries/weeks/<isodate:week>/user-shares/<int:user_id>',
        summary({'delete': 'user_share_revoke'}),
        name='summary-user-share-detail',
    ),
    path('summaries/weeks/<isodate:week>/export', summary({'post': 'export'}), name='summary-export'),
    path('summaries/organization', summary({'get': 'organization'}), name='summary-organization'),
    path('summaries/shared/<str:token>', summary({'get': 'shared'}), name='summary-shared'),
    path('summaries/<uuid:summary_pk>/files', SummaryFilesViewSet.as_view({'get': 'list'}), name='summary-files-list'),
]
