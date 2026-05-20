from django.urls import path, include, re_path
from rest_framework.routers import DefaultRouter
from .views_api import RecurringScheduleViewSet, TaskViewSet, WeeklySummaryViewSet, SummaryFilesViewSet

router = DefaultRouter()
router.register(r'tasks', TaskViewSet, basename='task')
router.register(r'recurring-schedules', RecurringScheduleViewSet, basename='recurring-schedule')
router.register(r'summaries', WeeklySummaryViewSet, basename='weekly-summary')

urlpatterns = [
    path('', include(router.urls)),
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
