from __future__ import annotations

from uuid import uuid4

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings


class SupportAttachmentStorageError(RuntimeError):
    pass


def _s3_client():
    region_name = getattr(settings, 'AWS_S3_REGION_NAME', '').strip() or None
    endpoint_url = getattr(settings, 'AWS_S3_ENDPOINT_URL', '').strip() or None
    return boto3.client('s3', region_name=region_name, endpoint_url=endpoint_url)


def _support_prefix() -> str:
    prefix = getattr(settings, 'SUPPORT_ATTACHMENT_S3_PREFIX', 'support-attachments').strip()
    return prefix or 'support-attachments'


def _request_path(request_id) -> str:
    return f'{_support_prefix()}/{request_id}'


def build_support_attachment_key(request_id, file_name: str) -> str:
    suffix = ''
    base_name = file_name.strip().replace('\\', '/')
    if '.' in base_name:
        suffix = f'.{base_name.rsplit(".", 1)[-1].lower()}'
    return f'{_request_path(request_id)}/{uuid4().hex}{suffix}'


def generate_support_attachment_upload_url(*, request_id, file_name: str, content_type: str):
    bucket_name = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
    if not bucket_name:
        raise SupportAttachmentStorageError('AWS_S3_BUCKET_NAME is not configured.')

    key = build_support_attachment_key(request_id, file_name)
    expires_in = getattr(settings, 'SUPPORT_ATTACHMENT_UPLOAD_URL_EXPIRES_IN', 900)

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
        raise SupportAttachmentStorageError('Failed to generate attachment upload URL.') from exc

    return {
        'upload_url': upload_url,
        'object_key': key,
        'expires_in': expires_in,
    }


def generate_support_attachment_download_url(*, object_key: str, file_name: str, content_type: str):
    bucket_name = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
    if not bucket_name:
        raise SupportAttachmentStorageError('AWS_S3_BUCKET_NAME is not configured.')

    expires_in = getattr(settings, 'SUPPORT_ATTACHMENT_DOWNLOAD_URL_EXPIRES_IN', 60)
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
        raise SupportAttachmentStorageError('Failed to generate attachment download URL.') from exc

    return download_url
