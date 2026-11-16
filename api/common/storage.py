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
