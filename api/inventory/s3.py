from uuid import uuid4
from urllib.parse import urlparse

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings


class MaintenanceAttachmentUploadError(RuntimeError):
    pass


def _normalize(value: str) -> str:
    return value.strip().rstrip('/')


def _s3_client():
    region_name = getattr(settings, 'AWS_S3_REGION_NAME', '').strip() or None
    endpoint_url = getattr(settings, 'AWS_S3_ENDPOINT_URL', '').strip() or None
    return boto3.client('s3', region_name=region_name, endpoint_url=endpoint_url)


def build_maintenance_attachment_key(file_name: str) -> str:
    prefix = getattr(settings, 'AWS_MAINTENANCE_ATTACHMENT_S3_PREFIX', 'maintenance-attachments').strip() or 'maintenance-attachments'
    suffix = ''
    if '.' in file_name:
        suffix = f'.{file_name.rsplit(".", 1)[-1].lower()}'
    return f'{prefix}/{uuid4().hex}{suffix}'


def build_maintenance_attachment_public_url(key: str) -> str:
    bucket_name = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
    region_name = getattr(settings, 'AWS_S3_REGION_NAME', '').strip()
    custom_domain = getattr(settings, 'AWS_S3_CUSTOM_DOMAIN', '').strip()
    endpoint_url = getattr(settings, 'AWS_S3_ENDPOINT_URL', '').strip()

    if custom_domain:
        return f'https://{_normalize(custom_domain)}/{key}'

    if endpoint_url:
        return f'{_normalize(endpoint_url)}/{bucket_name}/{key}'

    if region_name:
        return f'https://{bucket_name}.s3.{region_name}.amazonaws.com/{key}'

    return f'https://{bucket_name}.s3.amazonaws.com/{key}'


def generate_maintenance_attachment_upload_url(*, file_name: str, content_type: str):
    bucket_name = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
    if not bucket_name:
        raise MaintenanceAttachmentUploadError('AWS_S3_BUCKET_NAME is not configured.')

    key = build_maintenance_attachment_key(file_name)
    expires_in = getattr(settings, 'AWS_MAINTENANCE_ATTACHMENT_UPLOAD_URL_EXPIRES_IN', 900)

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
        raise MaintenanceAttachmentUploadError('Failed to generate upload URL.') from exc

    return {
        'upload_url': upload_url,
        'public_url': build_maintenance_attachment_public_url(key),
        'object_key': key,
        'bucket_name': bucket_name,
        'expires_in': expires_in,
    }


def build_inventory_photo_key(file_name: str) -> str:
    prefix = getattr(settings, 'AWS_INVENTORY_PHOTO_S3_PREFIX', 'inventory/photos').strip() or 'inventory/photos'
    suffix = ''
    if '.' in file_name:
        suffix = f'.{file_name.rsplit(".", 1)[-1].lower()}'
    return f'{prefix}/{uuid4().hex}{suffix}'


def generate_inventory_photo_upload_url(*, file_name: str, content_type: str):
    bucket_name = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
    if not bucket_name:
        raise MaintenanceAttachmentUploadError('AWS_S3_BUCKET_NAME is not configured.')

    key = build_inventory_photo_key(file_name)
    expires_in = getattr(settings, 'AWS_INVENTORY_PHOTO_UPLOAD_URL_EXPIRES_IN', 900)

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
        raise MaintenanceAttachmentUploadError('Failed to generate upload URL.') from exc

    return {
        'upload_url': upload_url,
        'public_url': build_maintenance_attachment_public_url(key),
        'object_key': key,
        'bucket_name': bucket_name,
        'expires_in': expires_in,
    }
