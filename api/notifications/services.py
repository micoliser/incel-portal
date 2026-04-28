from __future__ import annotations

import logging
from typing import Any

from django.conf import settings
from django.contrib.auth.models import User

from notifications.models import Notification, PushSubscription

logger = logging.getLogger(__name__)


def create_notification(
    recipient: User,
    *,
    actor: User | None,
    notification_type: str,
    title: str,
    body: str,
    link_url: str = '',
    payload: dict[str, Any] | None = None,
    send_push: bool = True,
) -> Notification:
    notification = Notification.objects.create(
        recipient=recipient,
        actor=actor,
        notification_type=notification_type,
        title=title,
        body=body,
        link_url=link_url,
        payload_json=payload or {},
    )

    if send_push:
        _dispatch_push_for_notification(recipient, notification)

    return notification


def _dispatch_push_for_notification(recipient: User, notification: Notification) -> None:
    public_key = getattr(settings, 'WEB_PUSH_VAPID_PUBLIC_KEY', '')
    private_key = getattr(settings, 'WEB_PUSH_VAPID_PRIVATE_KEY', '')
    subject = getattr(settings, 'WEB_PUSH_VAPID_SUBJECT', '')

    if not public_key or not private_key or not subject:
        return

    subscriptions = PushSubscription.objects.filter(user=recipient, is_active=True)
    if not subscriptions.exists():
        return

    payload = {
        'title': notification.title,
        'body': notification.body,
        'url': notification.link_url,
        'notificationId': notification.id,
        'type': notification.notification_type,
    }

    try:
        from pywebpush import WebPushException, webpush
    except Exception:
        logger.warning('pywebpush is not available; skipping push delivery')
        return

    for subscription in subscriptions:
        subscription_info = {
            'endpoint': subscription.endpoint,
            'keys': {
                'p256dh': subscription.p256dh,
                'auth': subscription.auth,
            },
        }

        try:
            webpush(
                subscription_info=subscription_info,
                data=_to_json(payload),
                vapid_private_key=private_key,
                vapid_claims={'sub': subject},
            )
        except WebPushException as exc:
            status_code = getattr(getattr(exc, 'response', None), 'status_code', None)
            if status_code in {404, 410}:
                subscription.is_active = False
                subscription.save(update_fields=['is_active', 'updated_at'])
                continue
            logger.warning('Push send failed for subscription %s: %s', subscription.id, str(exc))
        except Exception as exc:
            logger.warning('Unexpected push send error for subscription %s: %s', subscription.id, str(exc))


def _to_json(data: dict[str, Any]) -> str:
    import json

    return json.dumps(data)
