from django.test import TestCase, override_settings


class AdminIPAllowlistMiddlewareTests(TestCase):
    
    @override_settings(DEBUG=False, ADMIN_ALLOWED_IPS=['10.0.0.1'])
    def test_admin_blocked_for_unallowed_ip(self):
        response = self.client.get('/admin/', REMOTE_ADDR='192.168.1.5')
        self.assertEqual(response.status_code, 403)

    @override_settings(DEBUG=False, ADMIN_ALLOWED_IPS=['192.168.1.5'])
    def test_admin_allowed_for_allowed_ip(self):
        # By default /admin/ redirects to login, so we expect 302 not 403
        response = self.client.get('/admin/', REMOTE_ADDR='192.168.1.5')
        self.assertNotEqual(response.status_code, 403)

    # With one trusted proxy, the client is the rightmost X-Forwarded-For entry
    # (the address the proxy saw). Anything to its left was sent by the caller.
    @override_settings(DEBUG=False, ADMIN_ALLOWED_IPS=['10.0.0.1'], TRUSTED_PROXY_COUNT=1)
    def test_forged_forwarded_address_does_not_pass_the_allowlist(self):
        response = self.client.get('/admin/', HTTP_X_FORWARDED_FOR='10.0.0.1, 192.168.1.5')
        self.assertEqual(response.status_code, 403)

    @override_settings(DEBUG=False, ADMIN_ALLOWED_IPS=['192.168.1.5'], TRUSTED_PROXY_COUNT=1)
    def test_address_seen_by_the_proxy_is_used(self):
        response = self.client.get('/admin/', HTTP_X_FORWARDED_FOR='8.8.8.8, 192.168.1.5')
        self.assertNotEqual(response.status_code, 403)

    @override_settings(DEBUG=False, ADMIN_ALLOWED_IPS=['192.168.1.5'], TRUSTED_PROXY_COUNT=2)
    def test_two_proxies_use_the_second_entry_from_the_right(self):
        response = self.client.get('/admin/', HTTP_X_FORWARDED_FOR='8.8.8.8, 192.168.1.5, 10.0.0.2')
        self.assertNotEqual(response.status_code, 403)

    @override_settings(DEBUG=False, ADMIN_ALLOWED_IPS=['192.168.1.5'], TRUSTED_PROXY_COUNT=0)
    def test_no_proxy_ignores_the_header(self):
        response = self.client.get('/admin/', HTTP_X_FORWARDED_FOR='192.168.1.5', REMOTE_ADDR='8.8.8.8')
        self.assertEqual(response.status_code, 403)

    @override_settings(DEBUG=True, ADMIN_ALLOWED_IPS=['10.0.0.1'])
    def test_debug_mode_bypasses_ip_check(self):
        response = self.client.get('/admin/', REMOTE_ADDR='192.168.1.5')
        self.assertNotEqual(response.status_code, 403)

class CSPMiddlewareTests(TestCase):
    def test_api_responses_allow_nothing_to_run(self):
        policy = self.client.get('/health/').headers['Content-Security-Policy']
        self.assertIn("default-src 'none'", policy)
        self.assertIn("frame-ancestors 'none'", policy)
        self.assertNotIn('script-src', policy)
        self.assertNotIn('unsafe-inline', policy)

    @override_settings(DEBUG=True)
    def test_django_admin_keeps_what_it_needs_but_no_outside_scripts(self):
        policy = self.client.get('/admin/login/').headers['Content-Security-Policy']
        self.assertIn("script-src 'self' 'unsafe-inline'", policy)
        self.assertNotIn('https://*', policy)

    def test_csp_header_not_overwritten_if_already_present(self):
        # We need a view that sets its own CSP
        from django.http import HttpResponse
        from django.test import RequestFactory

        from common.middleware import CSPMiddleware
        
        request = RequestFactory().get('/')
        def get_response(req):
            resp = HttpResponse()
            resp['Content-Security-Policy'] = "default-src 'self'"
            return resp
            
        middleware = CSPMiddleware(get_response)
        response = middleware(request)
        self.assertEqual(response['Content-Security-Policy'], "default-src 'self'")
