from __future__ import annotations

import json
import logging
from typing import Any

from django.conf import settings
from django.contrib.auth.models import User
from django.db import transaction

from notifications.models import Notification, PushSubscription
from notifications.serializers import is_allowed_push_endpoint

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
    payload_json = payload or {}
    if payload_json:
        payload_json = json.loads(json.dumps(payload_json, default=str))

    notification = Notification.objects.create(
        recipient=recipient,
        actor=actor,
        notification_type=notification_type,
        title=title,
        body=body,
        link_url=link_url,
        payload_json=payload_json,
    )

    if send_push:
        # After the surrounding transaction commits: a notification that is
        # rolled back must not be pushed, and nothing slow runs while database
        # locks are held.
        transaction.on_commit(lambda: _queue_push(notification.id))

    return notification


def _queue_push(notification_id) -> None:
    if not _push_configured():
        return
    if settings.SEND_PUSH_CELERY:
        from notifications.tasks import send_push

        try:
            send_push.delay(str(notification_id))
            return
        except Exception:
            logger.warning('Could not queue push delivery; sending in-process instead')
    deliver_push(notification_id)


def _push_configured() -> bool:
    return bool(
        settings.WEB_PUSH_VAPID_PUBLIC_KEY and settings.WEB_PUSH_VAPID_PRIVATE_KEY and settings.WEB_PUSH_VAPID_SUBJECT
    )


def deliver_push(notification_id) -> None:
    """Send one notification to every active browser subscription of its recipient."""
    if not _push_configured():
        return
    notification = Notification.objects.filter(id=notification_id).first()
    if notification is None:
        return

    private_key = settings.WEB_PUSH_VAPID_PRIVATE_KEY
    subject = settings.WEB_PUSH_VAPID_SUBJECT
    subscriptions = PushSubscription.objects.filter(user_id=notification.recipient_id, is_active=True)
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
        # Subscriptions stored before endpoints were restricted are not trusted.
        if not is_allowed_push_endpoint(subscription.endpoint):
            subscription.is_active = False
            subscription.save(update_fields=['is_active', 'updated_at'])
            continue

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
                timeout=settings.WEB_PUSH_TIMEOUT_SECONDS,
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
    return json.dumps(data, default=str)
