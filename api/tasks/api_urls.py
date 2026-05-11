from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views_api import RecurringScheduleViewSet, TaskViewSet

router = DefaultRouter()
router.register(r'tasks', TaskViewSet, basename='task')
router.register(r'recurring-schedules', RecurringScheduleViewSet, basename='recurring-schedule')

urlpatterns = [
    path('', include(router.urls)),
]
