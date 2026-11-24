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
443, short timeouts, and small size limits.
"""

from __future__ import annotations

import base64
import io
import ipaddress
import logging
import socket
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import urllib3

logger = logging.getLogger(__name__)

TIMEOUT = urllib3.Timeout(connect=3.0, read=4.0)
MAX_HTML_BYTES = 512 * 1024
MAX_IMAGE_BYTES = 3 * 1024 * 1024
MAX_REDIRECTS = 3
THUMB_EDGE = 320
USER_AGENT = 'Mozilla/5.0 (compatible; IncelPortalLinkPreview/1.0)'


class PreviewUnavailable(Exception):
    """No preview for this link (blocked, unreachable, not a web page)."""


def _public_addresses(host: str, port: int) -> list[str]:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError) as exc:
        raise PreviewUnavailable('The address could not be found.') from exc
    addresses = []
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if not ip.is_global or ip.is_multicast:
            # Loopback, private ranges, link-local (cloud metadata), reserved…
            raise PreviewUnavailable('That address is not on the public internet.')
        addresses.append(str(ip))
    if not addresses:
        raise PreviewUnavailable('The address could not be found.')
    return addresses


def _get(url: str, *, max_bytes: int, accept: str):
    """GET a public URL, following up to MAX_REDIRECTS checked redirects.
    Returns (final_url, content_type, body)."""
    for _ in range(MAX_REDIRECTS + 1):
        parts = urlsplit(url)
        if parts.scheme not in ('http', 'https') or not parts.hostname:
            raise PreviewUnavailable('Only web links have previews.')
        if parts.username or parts.password:
            raise PreviewUnavailable('Links with a user name have no preview.')
        port = parts.port or (443 if parts.scheme == 'https' else 80)
        if port not in (80, 443):
            raise PreviewUnavailable('Only standard web ports are fetched.')
        address = _public_addresses(parts.hostname, port)[0]
        path = parts.path or '/'
        if parts.query:
            path = f'{path}?{parts.query}'
        headers = {'Host': parts.netloc, 'User-Agent': USER_AGENT, 'Accept': accept, 'Accept-Language': 'en'}
        if parts.scheme == 'https':
            # Connect to the checked address, but verify the certificate for the real host name.
            pool = urllib3.HTTPSConnectionPool(
                address, port=port, server_hostname=parts.hostname, assert_hostname=parts.hostname,
                timeout=TIMEOUT, retries=False, cert_reqs='CERT_REQUIRED',
            )
        else:
            pool = urllib3.HTTPConnectionPool(address, port=port, timeout=TIMEOUT, retries=False)
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
            body = response.read(max_bytes + 1, decode_content=True)
            if len(body) > max_bytes:
                body = body[:max_bytes]
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

    Image.MAX_IMAGE_PIXELS = 40_000_000  # refuse decompression bombs
    try:
        with Image.open(io.BytesIO(image_bytes)) as img:
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
    final_url, content_type, body = _get(url, max_bytes=MAX_HTML_BYTES, accept='text/html,application/xhtml+xml')
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
            _, image_type, image_bytes = _get(urljoin(final_url, image_url), max_bytes=MAX_IMAGE_BYTES, accept='image/*')
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
