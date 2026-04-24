from django.urls import path

from accounts import views_api

urlpatterns = [
    path('auth/login', views_api.LoginView.as_view(), name='auth-login'),
    path('auth/logout', views_api.LogoutView.as_view(), name='auth-logout'),
    path('auth/refresh', views_api.RefreshTokenView.as_view(), name='auth-refresh'),
    path('auth/change-password', views_api.ChangePasswordView.as_view(), name='auth-change-password'),
    path('me', views_api.MeView.as_view(), name='me'),
    path('me/permissions', views_api.MePermissionsView.as_view(), name='me-permissions'),
    path('me/applications', views_api.MeApplicationsView.as_view(), name='me-applications'),
    path('users', views_api.AuthenticatedUserListView.as_view(), name='users-list'),
    path('admin/users', views_api.AdminUserListView.as_view(), name='admin-users-list'),
    path('admin/users/<int:user_id>', views_api.AdminUserDetailView.as_view(), name='admin-users-detail'),
    path('admin/users/<int:user_id>/role', views_api.AdminUserRoleUpdateView.as_view(), name='admin-users-role'),
    path('admin/users/<int:user_id>/department', views_api.AdminUserDepartmentUpdateView.as_view(), name='admin-users-department'),
    path('admin/users/<int:user_id>/status', views_api.AdminUserStatusUpdateView.as_view(), name='admin-users-status'),
]
