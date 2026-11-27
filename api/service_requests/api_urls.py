from django.urls import include, path

from common.routers import ApiRouter

from .views_api import EvidenceUploadUrlView, ServiceRequestViewSet, SuggestionsView

router = ApiRouter()
router.register(r'service-requests', ServiceRequestViewSet, basename='service-request')

urlpatterns = [
    path('service-requests/evidence-upload-url', EvidenceUploadUrlView.as_view(), name='service-request-evidence-upload-url'),
    path('service-requests/suggestions', SuggestionsView.as_view(), name='service-request-suggestions'),
    path('', include(router.urls)),
]
