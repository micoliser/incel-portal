from django.urls import path

from applications import views_api

urlpatterns = [
    path('applications', views_api.ApplicationListView.as_view(), name='applications-list'),
    path(
        'applications/logo-upload-url',
        views_api.ApplicationLogoUploadUrlView.as_view(),
        name='applications-logo-upload-url',
    ),
    path('applications/<uuid:application_id>', views_api.ApplicationDetailView.as_view(), name='applications-detail'),
    path(
        'applications/<uuid:application_id>/can-access',
        views_api.ApplicationCanAccessView.as_view(),
        name='applications-can-access',
    ),
    path('applications/<uuid:application_id>/open', views_api.ApplicationOpenView.as_view(), name='applications-open'),
    path(
        'applications/<uuid:application_id>/overrides',
        views_api.ApplicationOverrideListView.as_view(),
        name='applications-overrides',
    ),
    path(
        'applications/<uuid:application_id>/overrides/<uuid:override_id>',
        views_api.ApplicationOverrideDetailView.as_view(),
        name='applications-override-detail',
    ),
    path('me/recent-applications', views_api.RecentApplicationsView.as_view(), name='me-recent-applications'),
    path('audit-logs', views_api.AuditLogListView.as_view(), name='audit-logs-list'),
    path('audit-logs/<uuid:log_id>', views_api.AuditLogDetailView.as_view(), name='audit-logs-detail'),
]
