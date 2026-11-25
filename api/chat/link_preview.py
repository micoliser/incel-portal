"""Link previews for chat: the title, description and a small picture for a
link someone is about to send.

The browser cannot read other sites' pages (they do not allow it), so the
sender's browser asks this server to fetch the page. The server sees the link
at that moment but not the message, and stores nothing; the preview it returns
is encrypted into the message by the browser like everything else.

Fetching addresses chosen by users is a classic way to probe a private
network (SSRF), so this only connects to public addresses: the host name is
resolved, every address is checked, and the connection is made to the checked
address itself (so a second, different DNS answer cannot slip in). Redirects
are followed by hand and checked the same way. Only http(s) on ports 80 and
443, and small size limits.

The fetch runs inside an API request, so a slow site must not hold a worker:
one deadline covers the whole preview (DNS, connecting, every redirect, the
page, the picture), reads are done a packet at a time so a server dripping one
byte at a time still stops at the deadline, and only a few previews run at
once across the API (`preview_slot`).
"""

from __future__ import annotations

import base64
import io
import ipaddress
import logging
import socket
import time
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from contextlib import contextmanager
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import urllib3
from django.core.cache import cache

logger = logging.getLogger(__name__)

# The whole preview, page and picture, gets this long; each wait at most the
# shorter limits below (or whatever is left of the deadline).
TOTAL_SECONDS = 5.0
CONNECT_SECONDS = 2.0
READ_SECONDS = 2.0
CHUNK = 16 * 1024
# Previews running at the same time across the API (each holds a worker).
MAX_CONCURRENT = 2
MAX_HTML_BYTES = 512 * 1024
MAX_IMAGE_BYTES = 3 * 1024 * 1024
MAX_REDIRECTS = 3
THUMB_EDGE = 320
MAX_IMAGE_PIXELS = 40_000_000  # refuse decompression bombs
IMAGE_FORMATS = ('JPEG', 'PNG', 'GIF', 'WEBP')
# IPv6 ranges that carry an IPv4 address inside (NAT64, IPv4-compatible,
# IPv4-mapped, 6to4, Teredo). Python counts some as public, but on a network
# that translates them they reach the IPv4 address, which may be internal.
EMBEDDED_IPV4 = tuple(
    ipaddress.ip_network(net)
    for net in ('64:ff9b::/96', '64:ff9b:1::/48', '::/96', '::ffff:0:0/96', '2002::/16', '2001::/32')
)
# DNS lookups run here so that a slow DNS server cannot outlast the deadline.
_resolver = ThreadPoolExecutor(max_workers=4, thread_name_prefix='link-preview-dns')
USER_AGENT = 'Mozilla/5.0 (compatible; IncelPortalLinkPreview/1.0)'


class PreviewUnavailable(Exception):
    """No preview for this link (blocked, unreachable, not a web page, too slow)."""


class _Deadline:
    def __init__(self, seconds: float):
        self.end = time.monotonic() + seconds

    def left(self) -> float:
        """Seconds left; PreviewUnavailable once there are none."""
        left = self.end - time.monotonic()
        if left <= 0:
            raise PreviewUnavailable('The site took too long.')
        return left


@contextmanager
def preview_slot():
    """True while one of the few preview slots is held, False when all are busy."""
    key = 'chat:link-preview:running'
    try:
        cache.add(key, 0, 60)
        running = cache.incr(key)
    except Exception:  # cache unavailable: carry on, the per-user rate limit still applies
        yield True
        return
    try:
        yield running <= MAX_CONCURRENT
    finally:
        try:
            cache.decr(key)
        except Exception:
            pass


def _is_public(ip) -> bool:
    if not ip.is_global or ip.is_multicast:
        # Loopback, private ranges, link-local (cloud metadata), reserved…
        return False
    return not (ip.version == 6 and any(ip in net for net in EMBEDDED_IPV4))


def _public_addresses(host: str, port: int, deadline: _Deadline | None = None) -> list[str]:
    deadline = deadline or _Deadline(TOTAL_SECONDS)
    lookup = _resolver.submit(socket.getaddrinfo, host, port, type=socket.SOCK_STREAM)
    try:
        infos = lookup.result(timeout=deadline.left())
    except FutureTimeout as exc:
        raise PreviewUnavailable('The site took too long.') from exc
    except (socket.gaierror, UnicodeError) as exc:
        raise PreviewUnavailable('The address could not be found.') from exc
    addresses = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not _is_public(ip):
            raise PreviewUnavailable('That address is not on the public internet.')
        addresses.append(str(ip))
    if not addresses:
        raise PreviewUnavailable('The address could not be found.')
    return addresses


def _read(response, max_bytes: int, deadline: _Deadline) -> bytes:
    """The body, a packet at a time, stopping at max_bytes or the deadline."""
    chunks, total = [], 0
    while total <= max_bytes:
        wait = min(READ_SECONDS, deadline.left())
        sock = getattr(getattr(response, 'connection', None), 'sock', None)
        if sock is not None:
            sock.settimeout(wait)
        try:
            chunk = response.read1(CHUNK)
        except (urllib3.exceptions.HTTPError, OSError) as exc:
            raise PreviewUnavailable('The site did not answer.') from exc
        if not chunk:
            break
        chunks.append(chunk)
        total += len(chunk)
    return b''.join(chunks)[:max_bytes]


def _get(url: str, *, max_bytes: int, accept: str, deadline: _Deadline | None = None):
    """GET a public URL, following up to MAX_REDIRECTS checked redirects, all
    within the deadline. Returns (final_url, content_type, body)."""
    deadline = deadline or _Deadline(TOTAL_SECONDS)
    for _ in range(MAX_REDIRECTS + 1):
        parts = urlsplit(url)
        if parts.scheme not in ('http', 'https') or not parts.hostname:
            raise PreviewUnavailable('Only web links have previews.')
        if parts.username or parts.password:
            raise PreviewUnavailable('Links with a user name have no preview.')
        port = parts.port or (443 if parts.scheme == 'https' else 80)
        if port not in (80, 443):
            raise PreviewUnavailable('Only standard web ports are fetched.')
        address = _public_addresses(parts.hostname, port, deadline)[0]
        path = parts.path or '/'
        if parts.query:
            path = f'{path}?{parts.query}'
        headers = {'Host': parts.netloc, 'User-Agent': USER_AGENT, 'Accept': accept, 'Accept-Language': 'en'}
        left = deadline.left()
        timeout = urllib3.Timeout(connect=min(CONNECT_SECONDS, left), read=min(READ_SECONDS, left))
        if parts.scheme == 'https':
            # Connect to the checked address, but verify the certificate for the real host name.
            pool = urllib3.HTTPSConnectionPool(
                address, port=port, server_hostname=parts.hostname, assert_hostname=parts.hostname,
                timeout=timeout, retries=False, cert_reqs='CERT_REQUIRED',
            )
        else:
            pool = urllib3.HTTPConnectionPool(address, port=port, timeout=timeout, retries=False)
        try:
            response = pool.urlopen('GET', path, headers=headers, redirect=False, preload_content=False)
        except urllib3.exceptions.HTTPError as exc:
            raise PreviewUnavailable('The site did not answer.') from exc
        try:
            if response.status in (301, 302, 303, 307, 308) and response.headers.get('Location'):
                url = urljoin(url, response.headers['Location'])
                continue
            if response.status != 200:
                raise PreviewUnavailable('The site did not give a page.')
            body = _read(response, max_bytes, deadline)
            content_type = (response.headers.get('Content-Type') or '').split(';')[0].strip().lower()
            return url, content_type, body
        finally:
            response.release_conn()
            pool.close()
    raise PreviewUnavailable('Too many redirects.')


class _MetaParser(HTMLParser):
    """Reads <title> and the Open Graph / Twitter / description meta tags."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.meta: dict[str, str] = {}
        self.title = ''
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        values = {k.lower(): (v or '') for k, v in attrs}
        if tag == 'meta':
            key = (values.get('property') or values.get('name') or '').lower()
            if key and 'content' in values and key not in self.meta:
                self.meta[key] = values['content'].strip()
        elif tag == 'title':
            self._in_title = True

    def handle_endtag(self, tag):
        if tag == 'title':
            self._in_title = False
        if tag == 'head':
            raise _StopParsing

    def handle_data(self, data):
        if self._in_title and len(self.title) < 300:
            self.title += data


class _StopParsing(Exception):
    pass


def _clean(text: str, limit: int) -> str:
    text = ' '.join(text.split())
    return text if len(text) <= limit else text[: limit - 1] + '…'


def _thumbnail(image_bytes: bytes) -> str | None:
    """A small JPEG of the preview picture, as a data URL (it is encrypted with the message)."""
    from PIL import Image

    try:
        # Only common web formats (Pillow would otherwise try dozens, some of
        # them calling outside programs), and the size is checked before any
        # pixels are decoded.
        with Image.open(io.BytesIO(image_bytes), formats=IMAGE_FORMATS) as img:
            width, height = img.size
            if width * height > MAX_IMAGE_PIXELS:
                return None
            if img.format == 'JPEG':
                img.draft('RGB', (THUMB_EDGE, THUMB_EDGE))  # decode at a smaller size
            img.thumbnail((THUMB_EDGE, THUMB_EDGE))
            if img.mode not in ('RGB', 'L'):
                background = Image.new('RGB', img.size, (255, 255, 255))
                img = img.convert('RGBA')
                background.paste(img, mask=img.split()[-1])
                img = background
            out = io.BytesIO()
            img.convert('RGB').save(out, format='JPEG', quality=78, optimize=True)
    except Exception:
        return None
    return 'data:image/jpeg;base64,' + base64.b64encode(out.getvalue()).decode()


def fetch_preview(url: str) -> dict:
    """The preview for a link, or PreviewUnavailable."""
    deadline = _Deadline(TOTAL_SECONDS)
    final_url, content_type, body = _get(
        url, max_bytes=MAX_HTML_BYTES, accept='text/html,application/xhtml+xml', deadline=deadline
    )
    if content_type not in ('text/html', 'application/xhtml+xml'):
        raise PreviewUnavailable('That link is not a web page.')
    parser = _MetaParser()
    try:
        parser.feed(body.decode('utf-8', errors='replace'))
    except _StopParsing:
        pass
    meta = parser.meta
    title = meta.get('og:title') or meta.get('twitter:title') or parser.title
    description = meta.get('og:description') or meta.get('twitter:description') or meta.get('description') or ''
    site = meta.get('og:site_name') or (urlsplit(final_url).hostname or '').removeprefix('www.')
    if not title.strip() and not description.strip():
        raise PreviewUnavailable('The page has no title.')

    image = None
    image_url = meta.get('og:image') or meta.get('og:image:url') or meta.get('twitter:image')
    if image_url:
        try:
            # The picture shares the page's deadline; without time left the preview has no picture.
            _, image_type, image_bytes = _get(
                urljoin(final_url, image_url), max_bytes=MAX_IMAGE_BYTES, accept='image/*', deadline=deadline
            )
            if image_type.startswith('image/') and image_type != 'image/svg+xml':
                image = _thumbnail(image_bytes)
        except PreviewUnavailable:
            image = None

    return {
        'url': url,
        'title': _clean(title, 200),
        'description': _clean(description, 300),
        'site_name': _clean(site, 80),
        'image': image,
    }
