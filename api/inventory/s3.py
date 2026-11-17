from uuid import uuid4

from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings

from common.storage import (
    bucket_name as _bucket_name,
)
from common.storage import (
    file_suffix,
    key_from_public_url,
    public_url_for_key,
)
from common.storage import (
    s3_client as _s3_client,
)


class MaintenanceAttachmentUploadError(RuntimeError):
    pass


def _maintenance_prefix() -> str:
    prefix = getattr(settings, 'AWS_MAINTENANCE_ATTACHMENT_S3_PREFIX', 'maintenance-attachments').strip()
    return prefix or 'maintenance-attachments'


def _photo_prefix() -> str:
    return getattr(settings, 'AWS_INVENTORY_PHOTO_S3_PREFIX', 'inventory/photos').strip() or 'inventory/photos'


def build_maintenance_attachment_key(file_name: str) -> str:
    return f'{_maintenance_prefix()}/{uuid4().hex}{file_suffix(file_name)}'


def maintenance_attachment_key_prefix() -> str:
    return f'{_maintenance_prefix()}/'


def maintenance_attachment_key(stored: str) -> str | None:
    """The object key for a stored attachment reference, or None.

    Older rows hold the file's public URL instead of its key; those are mapped
    back to the key when they point at our bucket, and ignored otherwise.
    """
    if not stored:
        return None
    if stored.startswith(('http://', 'https://')):
        return key_from_public_url(stored, _maintenance_prefix())
    return stored if stored.startswith(maintenance_attachment_key_prefix()) else None


def _presigned_upload(*, key: str, content_type: str, expires_in: int):
    bucket_name = _bucket_name()
    if not bucket_name:
        raise MaintenanceAttachmentUploadError('AWS_S3_BUCKET_NAME is not configured.')

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
        'public_url': public_url_for_key(key),
        'object_key': key,
        'bucket_name': bucket_name,
        'expires_in': expires_in,
    }


def generate_maintenance_attachment_upload_url(*, file_name: str, content_type: str):
    return _presigned_upload(
        key=build_maintenance_attachment_key(file_name),
        content_type=content_type,
        expires_in=getattr(settings, 'AWS_MAINTENANCE_ATTACHMENT_UPLOAD_URL_EXPIRES_IN', 900),
    )


def build_inventory_photo_key(file_name: str) -> str:
    return f'{_photo_prefix()}/{uuid4().hex}{file_suffix(file_name)}'


def generate_inventory_photo_upload_url(*, file_name: str, content_type: str):
    return _presigned_upload(
        key=build_inventory_photo_key(file_name),
        content_type=content_type,
        expires_in=getattr(settings, 'AWS_INVENTORY_PHOTO_UPLOAD_URL_EXPIRES_IN', 900),
    )


def extract_inventory_photo_key_from_public_url(public_url: str) -> str | None:
    return key_from_public_url(public_url, _photo_prefix())


def delete_inventory_photo_by_public_url(public_url: str) -> bool:
    if not public_url:
        return False

    bucket_name = _bucket_name()
    if not bucket_name:
        raise MaintenanceAttachmentUploadError('AWS_S3_BUCKET_NAME is not configured.')

    key = extract_inventory_photo_key_from_public_url(public_url)
    if not key:
        return False

    try:
        _s3_client().delete_object(Bucket=bucket_name, Key=key)
        return True
    except (BotoCoreError, ClientError) as exc:
        raise MaintenanceAttachmentUploadError('Failed to delete previous photo from storage.') from exc
