from django.urls import path, include, re_path
from rest_framework.routers import DefaultRouter
from .views_api import (
    GoalsViewSet,
    RecurringScheduleViewSet,
    TaskViewSet,
    WeeklySummaryViewSet,
    SummaryFilesViewSet,
    ReportsMonthCalendarView,
    ReportsDayView,
    DailyReportDetailView,
    DailyReportSubreportCreateView,
    DailyReportSubreportDetailView,
    DailyReportSubreportCommentView,
)

router = DefaultRouter()
router.register(r'tasks', TaskViewSet, basename='task')
router.register(r'recurring-schedules', RecurringScheduleViewSet, basename='recurring-schedule')
router.register(r'goals', GoalsViewSet, basename='goal')
router.register(r'summaries', WeeklySummaryViewSet, basename='weekly-summary')

urlpatterns = [
    path('', include(router.urls)),
    path('reports/month/', ReportsMonthCalendarView.as_view(), name='reports-month-calendar'),
    path('reports/day/', ReportsDayView.as_view(), name='reports-day-hub'),
    path('reports/daily/<uuid:report_id>/', DailyReportDetailView.as_view(), name='reports-daily-detail'),
    path('reports/daily/<uuid:report_id>/subreports/', DailyReportSubreportCreateView.as_view(), name='reports-daily-subreports-create'),
    path('reports/subreports/<uuid:subreport_id>/', DailyReportSubreportDetailView.as_view(), name='reports-subreport-detail'),
    path('reports/subreports/<uuid:subreport_id>/comments/', DailyReportSubreportCommentView.as_view(), name='reports-subreport-comments'),
    # Explicit endpoint for organization-wide summary to avoid router path drift
    path(
        'summaries/organization-summary/',
        WeeklySummaryViewSet.as_view({'get': 'organization_summary'}),
        name='weekly-summary-organization-summary',
    ),
    path(
        'summaries/organization_summary/',
        WeeklySummaryViewSet.as_view({'get': 'organization_summary'}),
        name='weekly-summary-organization-summary-underscore',
    ),
    # Explicit endpoints for Phase 2 summaries (ensure availability even if router action registration changes)
    path('summaries/comparison-metrics/', WeeklySummaryViewSet.as_view({'get': 'comparison_metrics'})),
    path('summaries/historical/', WeeklySummaryViewSet.as_view({'get': 'historical'})),
    # Explicit endpoint for user-to-user sharing (Phase 2)
    path('summaries/share-with-user/', WeeklySummaryViewSet.as_view({'post': 'share_with_user'})),
    path('summaries/share-status/', WeeklySummaryViewSet.as_view({'get': 'share_status'})),
    path('summaries/revoke-share/', WeeklySummaryViewSet.as_view({'post': 'revoke_share'})),
    path('summaries/user-shares/', WeeklySummaryViewSet.as_view({'get': 'user_shares'})),
    path('summaries/revoke-user-share/', WeeklySummaryViewSet.as_view({'post': 'revoke_user_share'})),
    # Nested route for summary files: GET /summaries/<id>/files/
    re_path(r'^summaries/(?P<summary_pk>[^/.]+)/files/$', SummaryFilesViewSet.as_view({'get': 'list'}), name='summary-files-list'),
]
