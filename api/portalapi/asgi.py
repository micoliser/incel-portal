"""
ASGI entry point.

The REST API runs under gunicorn (WSGI). The realtime app runs this module
under uvicorn: plain HTTP is still handed to Django, and /ws/chat/ is the
chat WebSocket (chat/consumers.py).
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'portalapi.settings')

# Django must be set up before anything imports models.
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter  # noqa: E402
from django.urls import path  # noqa: E402

from chat.consumers import ChatConsumer  # noqa: E402

application = ProtocolTypeRouter(
    {
        'http': django_asgi_app,
        'websocket': URLRouter([path('ws/chat/', ChatConsumer.as_asgi())]),
    }
)
