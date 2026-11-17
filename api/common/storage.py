"""Shared S3 helpers.

Each app keeps its own `s3.py` with its key layout, limits and error class;
the pieces that were copied between them live here.
"""

from __future__ import annotations

from urllib.parse import urlparse

import boto3
from django.conf import settings


def s3_client():
    region_name = getattr(settings, 'AWS_S3_REGION_NAME', '').strip() or None
    endpoint_url = getattr(settings, 'AWS_S3_ENDPOINT_URL', '').strip() or None
    return boto3.client('s3', region_name=region_name, endpoint_url=endpoint_url)


def bucket_name() -> str:
    return getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()


def file_suffix(file_name: str) -> str:
    """The lower-cased extension of an uploaded file name, with its dot, or ''."""
    base_name = file_name.strip().replace('\\', '/')
    if '.' not in base_name:
        return ''
    return f'.{base_name.rsplit(".", 1)[-1].lower()}'


def _normalize(value: str) -> str:
    return value.strip().rstrip('/')


def _host_from_setting(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ''
    if '://' not in normalized:
        normalized = f'https://{normalized}'
    return urlparse(normalized).netloc.lower()


def public_url_for_key(key: str) -> str:
    """The public URL of an object, honouring a custom domain or endpoint if set."""
    bucket = bucket_name()
    region_name = getattr(settings, 'AWS_S3_REGION_NAME', '').strip()
    custom_domain = getattr(settings, 'AWS_S3_CUSTOM_DOMAIN', '').strip()
    endpoint_url = getattr(settings, 'AWS_S3_ENDPOINT_URL', '').strip()

    if custom_domain:
        return f'https://{_normalize(custom_domain)}/{key}'

    if endpoint_url:
        return f'{_normalize(endpoint_url)}/{bucket}/{key}'

    if region_name:
        return f'https://{bucket}.s3.{region_name}.amazonaws.com/{key}'

    return f'https://{bucket}.s3.amazonaws.com/{key}'


def key_from_public_url(public_url: str, prefix: str) -> str | None:
    """The object key behind one of our public URLs, or None.

    Returns None unless the URL points at this bucket and the key sits under
    `prefix`, so a caller can never be tricked into touching another object.
    """
    bucket = bucket_name()
    region_name = getattr(settings, 'AWS_S3_REGION_NAME', '').strip()
    custom_domain = getattr(settings, 'AWS_S3_CUSTOM_DOMAIN', '').strip()
    endpoint_url = getattr(settings, 'AWS_S3_ENDPOINT_URL', '').strip()

    parsed = urlparse(public_url)
    host = parsed.netloc.lower()
    path = parsed.path.lstrip('/')

    if not host or not path:
        return None

    endpoint_host = _host_from_setting(endpoint_url)
    custom_host = _host_from_setting(custom_domain)
    default_hosts = {f'{bucket}.s3.amazonaws.com'}
    if region_name:
        default_hosts.add(f'{bucket}.s3.{region_name}.amazonaws.com')

    if endpoint_host and host == endpoint_host:
        bucket_prefix = f'{bucket}/'
        if not path.startswith(bucket_prefix):
            return None
        path = path[len(bucket_prefix):]
    elif custom_host and host == custom_host:
        pass
    elif host not in default_hosts:
        return None

    if not path.startswith(f'{prefix}/'):
        return None

    return path


# ---------------------------------------------------------------------------
# Verifying uploads
#
# Browsers upload straight to storage with a presigned URL, then tell the API
# what they uploaded. That report is not trusted: before a file is recorded,
# storage is asked what is actually there.
# ---------------------------------------------------------------------------

IMAGE_CONTENT_TYPES = frozenset({'image/png', 'image/jpeg', 'image/webp'})


class UploadRejected(Exception):
    """The uploaded object is missing, too large or of a type that is not allowed."""


class StorageUnavailable(Exception):
    """Storage could not be asked about the object."""


def attachment_content_types() -> set[str]:
    """Types accepted for task, support and maintenance attachments."""
    values = getattr(settings, 'TASK_ATTACHMENT_ALLOWED_CONTENT_TYPES', [])
    return {str(value).strip() for value in values if str(value).strip()}


def attachment_max_size() -> int:
    return int(getattr(settings, 'TASK_ATTACHMENT_MAX_SIZE', 10 * 1024 * 1024))


def delete_object(key: str) -> None:
    """Best-effort removal of an object that was refused."""
    from botocore.exceptions import BotoCoreError, ClientError

    try:
        s3_client().delete_object(Bucket=bucket_name(), Key=key)
    except (BotoCoreError, ClientError):
        pass


def verify_upload(key: str, *, max_size: int, allowed_types, claimed_size=None, claimed_type=''):
    """Check an uploaded object against storage and return `(size, content_type)`
    as storage reports them, which is what callers should record.

    Raises UploadRejected when the object does not exist, is larger than
    `max_size` or has a type outside `allowed_types`; a refused object is
    deleted so it does not sit in the bucket. Raises StorageUnavailable when
    storage cannot be reached.

    With settings.VERIFY_UPLOADS off (tests and the end-to-end stack, which
    have no storage) the client's own figures are returned unchecked.
    """
    if not settings.VERIFY_UPLOADS:
        return claimed_size, claimed_type

    from botocore.exceptions import BotoCoreError, ClientError

    try:
        head = s3_client().head_object(Bucket=bucket_name(), Key=key)
    except ClientError as exc:
        code = str(exc.response.get('Error', {}).get('Code', ''))
        if code in ('404', 'NoSuchKey', 'NotFound'):
            raise UploadRejected('The file has not been uploaded.') from exc
        raise StorageUnavailable('Could not verify the uploaded file.') from exc
    except BotoCoreError as exc:
        raise StorageUnavailable('Could not verify the uploaded file.') from exc

    size = int(head.get('ContentLength') or 0)
    content_type = str(head.get('ContentType') or '').split(';')[0].strip().lower()

    if size <= 0 or size > max_size:
        delete_object(key)
        raise UploadRejected(f'The file must be {max_size} bytes or smaller.')
    if allowed_types and content_type not in allowed_types:
        delete_object(key)
        raise UploadRejected('This type of file is not allowed.')

    return size, content_type


def presigned_download_url(key: str, *, file_name: str = '', content_type: str = '', expires_in: int = 60):
    """A short-lived link to a private object, or None if one cannot be made."""
    from botocore.exceptions import BotoCoreError, ClientError

    bucket = bucket_name()
    if not bucket:
        return None
    params = {'Bucket': bucket, 'Key': key}
    if file_name:
        params['ResponseContentDisposition'] = 'attachment; filename="%s"' % file_name.replace('"', '\\"')
    if content_type:
        params['ResponseContentType'] = content_type
    try:
        return s3_client().generate_presigned_url(ClientMethod='get_object', Params=params, ExpiresIn=expires_in)
    except (BotoCoreError, ClientError):
        return None
