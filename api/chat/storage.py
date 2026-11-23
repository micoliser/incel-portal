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


def group_photo_prefix(conversation_id) -> str:
    return f'{_prefix()}/{conversation_id}/group-photo-'


def group_photo_key(conversation_id) -> str:
    from uuid import uuid4

    return f'{group_photo_prefix(conversation_id)}{uuid4().hex}.bin'


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


def copy_object(source_key: str, destination_key: str) -> None:
    """Duplicate an encrypted object inside the bucket (forwarding a file to
    another chat). Nothing is decrypted: the bytes are copied as they are.

    Off (CHAT_STORAGE_COPY false) where there is no real storage, such as the
    end-to-end test stack."""
    if not settings.CHAT_STORAGE_COPY:
        return
    bucket = bucket_name()
    if not bucket:
        raise ChatStorageError('File storage is not configured.')
    try:
        s3_client().copy_object(
            Bucket=bucket,
            Key=destination_key,
            CopySource={'Bucket': bucket, 'Key': source_key},
            ContentType=CONTENT_TYPE,
            MetadataDirective='REPLACE',
        )
    except (BotoCoreError, ClientError) as exc:
        raise ChatStorageError('Could not copy the file.') from exc
