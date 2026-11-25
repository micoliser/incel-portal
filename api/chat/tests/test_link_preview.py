from unittest.mock import patch

from chat.link_preview import PreviewUnavailable, fetch_preview
from chat.tests.test_api import ChatTestCase

PAGE = b"""<html><head>
<title>Fallback title</title>
<meta property="og:title" content="Quarterly report">
<meta property="og:description" content="Results for the quarter.">
<meta property="og:site_name" content="Example News">
</head><body>ignored</body></html>"""


class AddressCheckTests(ChatTestCase):
    def test_private_and_odd_addresses_are_refused(self):
        for url in (
            'http://127.0.0.1/',
            'http://localhost/',
            'http://10.0.0.5/admin',
            'http://169.254.169.254/latest/meta-data/',  # cloud metadata
            'http://[::1]/',
            'ftp://example.com/file',
            'http://example.com:8080/',
            'http://user:pass@example.com/',
        ):
            with self.subTest(url=url), self.assertRaises(PreviewUnavailable):
                fetch_preview(url)

    def test_a_redirect_to_a_private_address_is_refused(self):
        # The first host is public; the redirect target resolves to a private address.
        with patch('chat.link_preview._public_addresses', side_effect=[['93.184.216.34'], PreviewUnavailable('private')]):
            with patch('urllib3.HTTPSConnectionPool.urlopen') as urlopen:
                urlopen.return_value.status = 302
                urlopen.return_value.headers = {'Location': 'http://10.0.0.1/secret'}
                with self.assertRaises(PreviewUnavailable):
                    fetch_preview('https://example.com/start')


class PreviewTests(ChatTestCase):
    def test_reads_open_graph_tags(self):
        with patch('chat.link_preview._get', return_value=('https://example.com/r', 'text/html', PAGE)):
            preview = fetch_preview('https://example.com/r')
        self.assertEqual(preview['title'], 'Quarterly report')
        self.assertEqual(preview['description'], 'Results for the quarter.')
        self.assertEqual(preview['site_name'], 'Example News')
        self.assertIsNone(preview['image'])

    def test_endpoint_returns_null_when_there_is_no_preview(self):
        self.set_up_chat(self.staff_user)
        self.as_user(self.staff_user)
        with patch('chat.link_preview._get', side_effect=PreviewUnavailable('no')):
            response = self.client.post('/api/v1/chat/link-preview', {'url': 'https://example.com'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()['preview'])
        bad = self.client.post('/api/v1/chat/link-preview', {'url': 'javascript:alert(1)'}, format='json')
        self.assertEqual(bad.status_code, 400)


class SlowSiteTests(ChatTestCase):
    """A preview runs inside an API request, so a slow site must not hold a worker."""

    def test_a_site_dripping_bytes_stops_at_the_deadline(self):
        import time

        from chat.link_preview import _Deadline, _read

        class Drip:
            connection = None

            def read1(self, amount):
                time.sleep(0.05)  # one byte at a time, never quite timing out
                return b'x'

        started = time.monotonic()
        with self.assertRaises(PreviewUnavailable):
            _read(Drip(), 10_000_000, _Deadline(0.3))
        self.assertLess(time.monotonic() - started, 5)

    def test_a_slow_dns_answer_stops_at_the_deadline(self):
        import time

        from chat.link_preview import _Deadline, _public_addresses

        def slow_lookup(*args, **kwargs):
            time.sleep(10)
            return []

        started = time.monotonic()
        with patch('chat.link_preview.socket.getaddrinfo', side_effect=slow_lookup):
            with self.assertRaises(PreviewUnavailable):
                _public_addresses('slow.example', 443, _Deadline(0.2))
        self.assertLess(time.monotonic() - started, 5)

    def test_only_a_few_previews_run_at_once(self):
        from chat.link_preview import MAX_CONCURRENT, preview_slot

        held = []
        for _ in range(MAX_CONCURRENT):
            slot = preview_slot()
            held.append(slot)
            self.assertTrue(slot.__enter__())
        with preview_slot() as free:
            self.assertFalse(free)
        for slot in held:
            slot.__exit__(None, None, None)
        with preview_slot() as free:
            self.assertTrue(free)


class AddressRangeTests(ChatTestCase):
    def test_ipv6_ranges_that_carry_an_ipv4_address_are_refused(self):
        import ipaddress

        from chat.link_preview import _is_public

        for address in ('64:ff9b::a9fe:a9fe', '::127.0.0.1', '::ffff:10.0.0.1', '2002:7f00:1::', '2001:0:4136:e378::1'):
            with self.subTest(address=address):
                self.assertFalse(_is_public(ipaddress.ip_address(address)))
        self.assertTrue(_is_public(ipaddress.ip_address('2606:4700:4700::1111')))
        self.assertTrue(_is_public(ipaddress.ip_address('93.184.216.34')))


class PictureTests(ChatTestCase):
    def picture(self, image, fmt):
        import io

        out = io.BytesIO()
        image.save(out, format=fmt)
        return out.getvalue()

    def test_common_formats_become_a_small_jpeg(self):
        from PIL import Image

        from chat.link_preview import _thumbnail

        thumb = _thumbnail(self.picture(Image.new('RGB', (800, 600), 'red'), 'PNG'))
        self.assertTrue(thumb.startswith('data:image/jpeg;base64,'))

    def test_other_formats_and_huge_pictures_are_skipped(self):
        from PIL import Image

        from chat.link_preview import _thumbnail

        self.assertIsNone(_thumbnail(self.picture(Image.new('RGB', (40, 40)), 'BMP')))
        # 48 million pixels: refused before decoding (1-bit, so the test file is small).
        self.assertIsNone(_thumbnail(self.picture(Image.new('1', (8000, 6000)), 'PNG')))
