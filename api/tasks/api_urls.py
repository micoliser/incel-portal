from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views_api import RecurringScheduleViewSet, TaskViewSet, WeeklySummaryViewSet

router = DefaultRouter()
router.register(r'tasks', TaskViewSet, basename='task')
router.register(r'recurring-schedules', RecurringScheduleViewSet, basename='recurring-schedule')
router.register(r'summaries', WeeklySummaryViewSet, basename='weekly-summary')

urlpatterns = [
    path('', include(router.urls)),
]
