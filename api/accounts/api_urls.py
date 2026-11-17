from django.urls import path

from accounts import views_api

urlpatterns = [
    path('auth/login', views_api.LoginView.as_view(), name='auth-login'),
    path('auth/logout', views_api.LogoutView.as_view(), name='auth-logout'),
    path('auth/refresh', views_api.RefreshTokenView.as_view(), name='auth-refresh'),
    path('auth/heartbeat', views_api.HeartbeatView.as_view(), name='auth-heartbeat'),
    path('auth/change-password', views_api.ChangePasswordView.as_view(), name='auth-change-password'),
    path('auth/password-reset', views_api.PasswordResetRequestView.as_view(), name='auth-password-reset-request'),
    path('auth/password-reset/validate', views_api.PasswordResetValidateView.as_view(), name='auth-password-reset-validate'),
    path('auth/password-reset/confirm', views_api.PasswordResetConfirmView.as_view(), name='auth-password-reset-confirm'),
    path('me', views_api.MeView.as_view(), name='me'),
    path('me/permissions', views_api.MePermissionsView.as_view(), name='me-permissions'),
    path('users', views_api.UserListView.as_view(), name='users-list'),
    path('users/<int:user_id>', views_api.UserDetailView.as_view(), name='users-detail'),
    # Called by another service: its path and response shape must not change.
    path('external/users', views_api.ExternalUserListView.as_view(), name='external-users-list'),
]
