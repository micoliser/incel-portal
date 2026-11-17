"""Upload checks for views: storage errors become API errors."""

from rest_framework.exceptions import ValidationError

from common.exceptions import ServiceUnavailable
from common.storage import (
    StorageUnavailable,
    UploadRejected,
    attachment_content_types,
    attachment_max_size,
    verify_upload,
)


def checked_upload(key, *, field, claimed_size=None, claimed_type='', max_size=None, allowed_types=None):
    """Verify an uploaded attachment and return `(size, content_type)` as storage
    reports them. A bad upload is a 400 on `field`; unreachable storage is a 503."""
    try:
        return verify_upload(
            key,
            max_size=max_size or attachment_max_size(),
            allowed_types=attachment_content_types() if allowed_types is None else allowed_types,
            claimed_size=claimed_size,
            claimed_type=claimed_type,
        )
    except UploadRejected as exc:
        raise ValidationError({field: [str(exc)]})
    except StorageUnavailable as exc:
        raise ServiceUnavailable(str(exc))
