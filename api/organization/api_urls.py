from django.urls import path, include
from rest_framework.routers import DefaultRouter

from organization import views_api

router = DefaultRouter()
router.register(r'admin/organization/departments', views_api.DepartmentViewSet, basename='admin-departments')
router.register(r'admin/organization/units', views_api.UnitViewSet, basename='admin-units')
router.register(r'admin/organization/teams', views_api.TeamViewSet, basename='admin-teams')

urlpatterns = [
    path('organization/departments', views_api.DepartmentListView.as_view(), name='organization-departments-list'),
    path('organization/roles', views_api.RoleListView.as_view(), name='organization-roles-list'),
    path('organization/hierarchy', views_api.HierarchyView.as_view(), name='organization-hierarchy'),
    path('', include(router.urls)),
]
