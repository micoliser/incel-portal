"""Storage for encrypted chat files. Every object is opaque bytes."""

from __future__ import annotations

from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings

from common.storage import bucket_name, s3_client

CONTENT_TYPE = 'application/octet-stream'


class ChatStorageError(RuntimeError):
    pass


def _prefix() -> str:
    return (getattr(settings, 'CHAT_ATTACHMENT_S3_PREFIX', '') or 'chat-attachments').strip().strip('/')


def file_key(conversation_id, attachment_id) -> str:
    return f'{_prefix()}/{conversation_id}/{attachment_id}.bin'


def thumb_key(conversation_id, attachment_id) -> str:
    return f'{_prefix()}/{conversation_id}/{attachment_id}.thumb.bin'


def upload_url(key: str) -> str:
    bucket = bucket_name()
    if not bucket:
        raise ChatStorageError('File storage is not configured.')
    try:
        return s3_client().generate_presigned_url(
            ClientMethod='put_object',
            Params={'Bucket': bucket, 'Key': key, 'ContentType': CONTENT_TYPE},
            ExpiresIn=settings.CHAT_UPLOAD_URL_EXPIRES_IN,
        )
    except (BotoCoreError, ClientError) as exc:
        raise ChatStorageError('Could not prepare the upload.') from exc


def download_url(key: str) -> str:
    bucket = bucket_name()
    if not bucket:
        raise ChatStorageError('File storage is not configured.')
    try:
        return s3_client().generate_presigned_url(
            ClientMethod='get_object',
            Params={'Bucket': bucket, 'Key': key, 'ResponseContentType': CONTENT_TYPE},
            ExpiresIn=settings.CHAT_DOWNLOAD_URL_EXPIRES_IN,
        )
    except (BotoCoreError, ClientError) as exc:
        raise ChatStorageError('Could not prepare the download.') from exc
