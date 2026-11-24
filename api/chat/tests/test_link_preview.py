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
