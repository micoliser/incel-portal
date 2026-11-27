from django.urls import include, path

from common.routers import ApiRouter

from .views_api import (
    CreditClientImportConfirmView,
    CreditClientImportListView,
    CreditClientImportPreviewView,
    CreditClientImportTemplateView,
    CreditClientViewSet,
)

router = ApiRouter()
router.register(r'clients', CreditClientViewSet, basename='credit-client')

urlpatterns = [
    # Before the router, so "imports" is never read as a client id.
    path('clients/imports', CreditClientImportListView.as_view(), name='credit-client-imports'),
    path('clients/imports/template', CreditClientImportTemplateView.as_view(), name='credit-client-import-template'),
    path('clients/imports/preview', CreditClientImportPreviewView.as_view(), name='credit-client-import-preview'),
    path('clients/imports/confirm', CreditClientImportConfirmView.as_view(), name='credit-client-import-confirm'),
    path('', include(router.urls)),
]
