from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views_api import SupportRequestViewSet

router = DefaultRouter()
router.register(r'requests', SupportRequestViewSet, basename='support-request')

urlpatterns = [
    path('', include(router.urls)),
]
