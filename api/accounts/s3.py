"""Profile pictures in S3. Public, like application logos: each user's
pictures sit under their own folder, so a saved URL can be checked to belong
to the person saving it."""

from uuid import uuid4

from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings

from common.storage import bucket_name, key_from_public_url, public_url_for_key, s3_client

# Photos only (no SVG: it can carry scripts). The browser converts to JPEG first.
PROFILE_PHOTO_TYPES = {'image/jpeg', 'image/png', 'image/webp'}
PROFILE_PHOTO_MAX_SIZE = 5 * 1024 * 1024
_SUFFIX = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp'}


class ProfilePhotoError(RuntimeError):
    pass


def _prefix() -> str:
    return getattr(settings, 'AWS_PROFILE_PHOTO_S3_PREFIX', 'profile-photos').strip().strip('/') or 'profile-photos'


def user_folder(user_id) -> str:
    return f'{_prefix()}/{user_id}'


def generate_profile_photo_upload_url(*, user_id, content_type: str) -> dict:
    bucket = bucket_name()
    if not bucket:
        raise ProfilePhotoError('File storage is not configured.')
    key = f'{user_folder(user_id)}/{uuid4().hex}{_SUFFIX[content_type]}'
    expires_in = getattr(settings, 'AWS_PROFILE_PHOTO_UPLOAD_URL_EXPIRES_IN', 900)
    try:
        upload_url = s3_client().generate_presigned_url(
            ClientMethod='put_object',
            Params={'Bucket': bucket, 'Key': key, 'ContentType': content_type},
            ExpiresIn=expires_in,
        )
    except (BotoCoreError, ClientError) as exc:
        raise ProfilePhotoError('Could not prepare the upload.') from exc
    return {'upload_url': upload_url, 'public_url': public_url_for_key(key), 'expires_in': expires_in}


def own_photo_key(public_url: str, user_id) -> str | None:
    """The object key behind a URL, only if it is in this user's own folder."""
    key = key_from_public_url(public_url, _prefix())
    if not key or not key.startswith(f'{user_folder(user_id)}/'):
        return None
    return key


def delete_profile_photo(public_url: str, user_id) -> None:
    key = own_photo_key(public_url, user_id) if public_url else None
    bucket = bucket_name()
    if not key or not bucket:
        return
    try:
        s3_client().delete_object(Bucket=bucket, Key=key)
    except (BotoCoreError, ClientError):
        pass  # An old picture left behind is harmless; the profile no longer points at it.
