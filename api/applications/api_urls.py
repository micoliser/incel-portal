from django.urls import path

from applications.views_api import (
    ApplicationOverrideViewSet,
    ApplicationViewSet,
    AuditLogViewSet,
    RecentApplicationsView,
)

# Explicit paths keep the route names and typed ids the portal and tests use.
applications = ApplicationViewSet.as_view
overrides = ApplicationOverrideViewSet.as_view
audit_logs = AuditLogViewSet.as_view

urlpatterns = [
    path('applications', applications({'get': 'list', 'post': 'create'}), name='applications-list'),
    path(
        'applications/logo-upload-url',
        applications({'post': 'logo_upload_url'}),
        name='applications-logo-upload-url',
    ),
    path(
        'applications/<uuid:application_id>',
        applications({'get': 'retrieve', 'patch': 'partial_update', 'delete': 'destroy'}),
        name='applications-detail',
    ),
    path(
        'applications/<uuid:application_id>/can-access',
        applications({'get': 'can_access'}),
        name='applications-can-access',
    ),
    path('applications/<uuid:application_id>/open', applications({'post': 'open'}), name='applications-open'),
    path(
        'applications/<uuid:application_id>/overrides',
        overrides({'get': 'list', 'post': 'create'}),
        name='applications-overrides',
    ),
    path(
        'applications/<uuid:application_id>/overrides/<uuid:override_id>',
        overrides({'delete': 'destroy'}),
        name='applications-override-detail',
    ),
    path('me/recent-applications', RecentApplicationsView.as_view(), name='me-recent-applications'),
    path('audit-logs', audit_logs({'get': 'list'}), name='audit-logs-list'),
    path('audit-logs/<uuid:log_id>', audit_logs({'get': 'retrieve'}), name='audit-logs-detail'),
]
