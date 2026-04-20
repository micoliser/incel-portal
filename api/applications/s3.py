from uuid import uuid4
from urllib.parse import urlparse

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings


class ApplicationLogoUploadError(RuntimeError):
    pass


def _normalize(value: str) -> str:
	return value.strip().rstrip('/')


def _host_from_setting(value: str) -> str:
	normalized = value.strip()
	if not normalized:
		return ''
	if '://' not in normalized:
		normalized = f'https://{normalized}'
	return urlparse(normalized).netloc.lower()


def _s3_client():
	region_name = getattr(settings, 'AWS_S3_REGION_NAME', '').strip() or None
	endpoint_url = getattr(settings, 'AWS_S3_ENDPOINT_URL', '').strip() or None
	return boto3.client('s3', region_name=region_name, endpoint_url=endpoint_url)


def build_application_logo_key(slug: str, file_name: str) -> str:
    prefix = getattr(settings, 'AWS_APPLICATION_LOGO_S3_PREFIX', 'application-logos').strip() or 'application-logos'
    suffix = ''
    if '.' in file_name:
        suffix = f'.{file_name.rsplit(".", 1)[-1].lower()}'
    return f'{prefix}/{slug}/{uuid4().hex}{suffix}'


def build_application_logo_public_url(key: str) -> str:
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


def extract_application_logo_key_from_public_url(public_url: str) -> str | None:
	bucket_name = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
	region_name = getattr(settings, 'AWS_S3_REGION_NAME', '').strip()
	custom_domain = getattr(settings, 'AWS_S3_CUSTOM_DOMAIN', '').strip()
	endpoint_url = getattr(settings, 'AWS_S3_ENDPOINT_URL', '').strip()
	prefix = getattr(settings, 'AWS_APPLICATION_LOGO_S3_PREFIX', 'application-logos').strip() or 'application-logos'

	parsed = urlparse(public_url)
	host = parsed.netloc.lower()
	path = parsed.path.lstrip('/')

	if not host or not path:
		return None

	endpoint_host = _host_from_setting(endpoint_url)
	custom_host = _host_from_setting(custom_domain)
	default_hosts = {f'{bucket_name}.s3.amazonaws.com'}
	if region_name:
		default_hosts.add(f'{bucket_name}.s3.{region_name}.amazonaws.com')

	if endpoint_host and host == endpoint_host:
		bucket_prefix = f'{bucket_name}/'
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


def delete_application_logo_by_public_url(public_url: str) -> bool:
	if not public_url:
		return False

	bucket_name = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
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
    bucket_name = getattr(settings, 'AWS_S3_BUCKET_NAME', '').strip()
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
