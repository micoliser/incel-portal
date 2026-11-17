from django.urls import include, path

from common.routers import ApiRouter
from organization import views_api

router = ApiRouter()
router.register(r'organization/departments', views_api.DepartmentViewSet, basename='department')
router.register(r'organization/units', views_api.UnitViewSet, basename='unit')
router.register(r'organization/teams', views_api.TeamViewSet, basename='team')

urlpatterns = [
    path('organization/roles', views_api.RoleListView.as_view(), name='organization-roles-list'),
    path('organization/hierarchy', views_api.HierarchyView.as_view(), name='organization-hierarchy'),
    path('', include(router.urls)),
]
