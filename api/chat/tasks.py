"""Background work for chat: pushes, removing files from storage, and
clearing files that were uploaded but never sent."""

from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

logger = logging.getLogger(__name__)


def _run(task, *args):
    """Queue on Celery when it is in use, otherwise run in this process."""
    if settings.SEND_PUSH_CELERY:
        try:
            task.delay(*args)
            return
        except Exception:
            logger.warning('Could not queue %s; running in-process instead', task.name)
    task(*args)


@shared_task(name='chat.send_message_push', ignore_result=True)
def send_message_push(user_id, payload):
    from notifications.services import push_to_user

    push_to_user(user_id, payload)


def queue_message_push(user_id, payload) -> None:
    from notifications.services import _push_configured

    if _push_configured():
        _run(send_message_push, user_id, payload)


@shared_task(name='chat.delete_objects', ignore_result=True)
def delete_objects(keys):
    from common.storage import bucket_name, delete_object

    if not bucket_name():
        return
    for key in keys:
        delete_object(key)


def queue_object_deletion(keys) -> None:
    if keys:
        _run(delete_objects, list(keys))


@shared_task(name='chat.remove_unsent_attachments', ignore_result=True)
def remove_unsent_attachments():
    """Files reserved more than a day ago and never attached to a message."""
    from chat.models import MessageAttachment

    cutoff = timezone.now() - timedelta(days=1)
    stale = MessageAttachment.objects.filter(message__isnull=True, created_at__lt=cutoff)
    keys = []
    for item in stale:
        keys.extend(k for k in (item.file_key, item.thumb_key) if k)
    count = stale.count()
    stale.delete()
    if keys:
        delete_objects(keys)
    if count:
        logger.info('Removed %s unsent chat attachments', count)
