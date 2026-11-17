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


class ApplicationLogoUploadError(RuntimeError):
    pass


def _logo_prefix() -> str:
    return getattr(settings, 'AWS_APPLICATION_LOGO_S3_PREFIX', 'application-logos').strip() or 'application-logos'


def build_application_logo_key(slug: str, file_name: str) -> str:
    return f'{_logo_prefix()}/{slug}/{uuid4().hex}{file_suffix(file_name)}'


def build_application_logo_public_url(key: str) -> str:
    return public_url_for_key(key)


def extract_application_logo_key_from_public_url(public_url: str) -> str | None:
    return key_from_public_url(public_url, _logo_prefix())


def delete_application_logo_by_public_url(public_url: str) -> bool:
    if not public_url:
        return False

    bucket_name = _bucket_name()
    if not bucket_name:
        raise ApplicationLogoUploadError('AWS_S3_BUCKET_NAME is not configured.')

    key = extract_application_logo_key_from_public_url(public_url)
    if not key:
        return False

    try:
        _s3_client().delete_object(Bucket=bucket_name, Key=key)
    except (BotoCoreError, ClientError) as exc:
        raise ApplicationLogoUploadError('Failed to delete previous logo from storage.') from exc

    return True


def generate_application_logo_upload_url(*, slug: str, file_name: str, content_type: str):
    bucket_name = _bucket_name()
    if not bucket_name:
        raise ApplicationLogoUploadError('AWS_S3_BUCKET_NAME is not configured.')

    key = build_application_logo_key(slug, file_name)
    expires_in = getattr(settings, 'AWS_APPLICATION_LOGO_UPLOAD_URL_EXPIRES_IN', 900)

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
        raise ApplicationLogoUploadError('Failed to generate upload URL.') from exc

    return {
        'upload_url': upload_url,
        'public_url': build_application_logo_public_url(key),
        'object_key': key,
        'bucket_name': bucket_name,
        'expires_in': expires_in,
    }
