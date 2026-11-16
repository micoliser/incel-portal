from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views_api import (
    InventoryCategoryViewSet,
    InventoryItemViewSet,
    InventoryMaintenanceLogViewSet,
    MyInventoryView,
)

router = DefaultRouter()
router.register(r'inventory/categories', InventoryCategoryViewSet, basename='inventory-category')
router.register(r'inventory/items', InventoryItemViewSet, basename='inventory-item')
router.register(r'inventory/maintenance-logs', InventoryMaintenanceLogViewSet, basename='inventory-maintenance-log')

urlpatterns = [
    path('', include(router.urls)),
    path('me/inventory/', MyInventoryView.as_view(), name='my-inventory'),
]
