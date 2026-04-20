from django.urls import path

from applications import views_api

urlpatterns = [
    path('applications', views_api.ApplicationListView.as_view(), name='applications-list'),
    path('applications/<int:application_id>', views_api.ApplicationDetailView.as_view(), name='applications-detail'),
    path('applications/<int:application_id>/can-access', views_api.ApplicationCanAccessView.as_view(), name='applications-can-access'),
    path('applications/<int:application_id>/open', views_api.ApplicationOpenView.as_view(), name='applications-open'),
    path('admin/applications', views_api.AdminApplicationCreateView.as_view(), name='admin-applications-create'),
    path('admin/applications/logo-upload-url', views_api.AdminApplicationLogoUploadUrlView.as_view(), name='admin-applications-logo-upload-url'),
    path('admin/applications/<int:application_id>', views_api.AdminApplicationUpdateDeleteView.as_view(), name='admin-applications-update-delete'),
    path('admin/applications/<int:application_id>/departments', views_api.AdminApplicationDepartmentsView.as_view(), name='admin-applications-departments'),
    path('admin/applications/<int:application_id>/overrides', views_api.AdminApplicationOverridesCreateView.as_view(), name='admin-applications-overrides-create'),
    path('admin/applications/<int:application_id>/overrides/<int:override_id>', views_api.AdminApplicationOverrideDeleteView.as_view(), name='admin-applications-overrides-delete'),
    path('admin/audit-logs', views_api.AdminAuditLogListView.as_view(), name='admin-audit-logs-list'),
    path('admin/audit-logs/<int:log_id>', views_api.AdminAuditLogDetailView.as_view(), name='admin-audit-logs-detail'),
]
