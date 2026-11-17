import ipaddress

from django.conf import settings


def client_ip(request):
    """The address of the client, as seen by the outermost proxy we trust.

    Every proxy appends the address it received the request from to
    X-Forwarded-For, so only the rightmost entries were written by our own
    infrastructure; anything further left is supplied by the caller and can be
    forged. With TRUSTED_PROXY_COUNT proxies in front of the API, the client is
    the entry that many places from the right.

    Returns None when the value is not an IP address.
    """
    if request is None:
        return None

    candidate = request.META.get('REMOTE_ADDR')
    proxies = settings.TRUSTED_PROXY_COUNT
    forwarded = request.META.get('HTTP_X_FORWARDED_FOR')
    if proxies > 0 and forwarded:
        entries = [entry.strip() for entry in forwarded.split(',') if entry.strip()]
        if entries:
            # A header shorter than expected means the request did not pass
            # through every proxy; the leftmost entry is then the best we have.
            candidate = entries[-min(proxies, len(entries))]

    try:
        return str(ipaddress.ip_address((candidate or '').strip()))
    except ValueError:
        return None
