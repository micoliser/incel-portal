from django.urls import include, path

urlpatterns = [
    path('', include('accounts.api_urls')),
    path('', include('organization.api_urls')),
    path('', include('applications.api_urls')),
]
