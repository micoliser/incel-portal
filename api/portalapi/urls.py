"""
URL configuration for portalapi project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/6.0/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
import logging

from django.contrib import admin
from django.core.cache import caches
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path

logger = logging.getLogger(__name__)


def health_check(request):
    """200 when the API can reach its database, 503 when it cannot, so the
    platform stops routing to (or restarts) an instance that is up but broken.
    A cache that cannot be reached is reported as "degraded" (still 200)."""
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1')
    except Exception:
        logger.exception('Health check: database unreachable')
        return JsonResponse({'status': 'unavailable', 'database': 'unreachable'}, status=503)

    # A broken cache does not stop the API (common/cache.py), so it is
    # reported here instead of failing the check: still 200, but visible.
    backend = caches['default']
    if hasattr(backend, 'is_available') and not backend.is_available():
        return JsonResponse({'status': 'degraded', 'cache': 'unreachable'})
    return JsonResponse({'status': 'ok'})

urlpatterns = [
    path('health/', health_check),
    path('admin/', admin.site.urls),
    path('api/v1/', include('portalapi.api_urls')),
]
