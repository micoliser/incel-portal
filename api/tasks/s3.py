from __future__ import annotations

from uuid import uuid4

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings


class TaskAttachmentStorageError(RuntimeError):
    pass


def _s3_client():
    region_name = getattr(settings, 'AWS_S3_REGION_NAME', '').strip() or None
    endpoint_url = getattr(settings, 'AWS_S3_ENDPOINT_URL', '').strip() or None
    return boto3.client('s3', region_name=region_name, endpoint_url=endpoint_url)


def _attachment_prefix() -> str:
    prefix = getattr(settings, 'TASK_ATTACHMENT_S3_PREFIX', 'task-attachments').strip()
    return prefix or 'task-attachments'


def _allowed_content_types() -> set[str]:
    values = getattr(settings, 'TASK_ATTACHMENT_ALLOWED_CONTENT_TYPES', [])
    return {str(value).strip() for value in values if str(value).strip()}


def _task_path(task_id) -> str:
    return f'{_attachment_prefix()}/{task_id}'


def build_task_attachment_key(task_id, file_name: str) -> str:
    suffix = ''
    base_name = file_name.strip().replace('\\', '/')
    if '.' in base_name:
        suffix = f'.{base_name.rsplit(".", 1)[-1].lower()}'
    return f'{_task_path(task_id)}/{uuid4().hex}{suffix}'


def build_task_attachment_key_prefix(task_id) -> str:
    return f'{_task_path(task_id)}/'


def generate_task_attachment_upload_url(*, task_id, file_name: str, content_type: str):
    bucket_name = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
    if not bucket_name:
        raise TaskAttachmentStorageError('AWS_S3_BUCKET_NAME is not configured.')

    if content_type not in _allowed_content_types():
        raise TaskAttachmentStorageError('Unsupported attachment content type.')

    key = build_task_attachment_key(task_id, file_name)
    expires_in = getattr(settings, 'TASK_ATTACHMENT_UPLOAD_URL_EXPIRES_IN', 900)

    params = {
        'Bucket': bucket_name,
        'Key': key,
        'ContentType': content_type,
    }

    try:
        upload_url = _s3_client().generate_presigned_url(
            ClientMethod='put_object',
            Params=params,
            ExpiresIn=expires_in,
        )
    except (BotoCoreError, ClientError) as exc:
        raise TaskAttachmentStorageError('Failed to generate attachment upload URL.') from exc

    return {
        'upload_url': upload_url,
        'object_key': key,
        'expires_in': expires_in,
    }


def generate_task_attachment_download_url(*, object_key: str, file_name: str, content_type: str):
    bucket_name = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
    if not bucket_name:
        raise TaskAttachmentStorageError('AWS_S3_BUCKET_NAME is not configured.')

    expires_in = getattr(settings, 'TASK_ATTACHMENT_DOWNLOAD_URL_EXPIRES_IN', 60)
    quoted_file_name = file_name.replace('"', '\\"')

    params = {
        'Bucket': bucket_name,
        'Key': object_key,
        'ResponseContentDisposition': f'attachment; filename="{quoted_file_name}"',
        'ResponseContentType': content_type,
    }

    try:
        download_url = _s3_client().generate_presigned_url(
            ClientMethod='get_object',
            Params=params,
            ExpiresIn=expires_in,
        )
    except (BotoCoreError, ClientError) as exc:
        raise TaskAttachmentStorageError('Failed to generate attachment download URL.') from exc

    return {
        'download_url': download_url,
        'expires_in': expires_in,
    }
