from django.urls import path

from organization import views_api

urlpatterns = [
    path('organization/departments', views_api.DepartmentListView.as_view(), name='organization-departments-list'),
    path('organization/roles', views_api.RoleListView.as_view(), name='organization-roles-list'),
]
