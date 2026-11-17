from django.urls import include, path

from common.routers import ApiRouter

from .views_api import SupportRequestViewSet

router = ApiRouter()
router.register(r'requests', SupportRequestViewSet, basename='support-request')

urlpatterns = [
    path('', include(router.urls)),
]
