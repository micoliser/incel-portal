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

    @override_settings(DEBUG=False, ADMIN_ALLOWED_IPS=['10.0.0.1'])
    def test_admin_blocked_with_x_forwarded_for(self):
        # Test that X-Forwarded-For is respected
        response = self.client.get('/admin/', HTTP_X_FORWARDED_FOR='192.168.1.5, 10.0.0.2')
        self.assertEqual(response.status_code, 403)
        
    @override_settings(DEBUG=False, ADMIN_ALLOWED_IPS=['192.168.1.5'])
    def test_admin_allowed_with_x_forwarded_for(self):
        response = self.client.get('/admin/', HTTP_X_FORWARDED_FOR='192.168.1.5, 10.0.0.2')
        self.assertNotEqual(response.status_code, 403)

    @override_settings(DEBUG=True, ADMIN_ALLOWED_IPS=['10.0.0.1'])
    def test_debug_mode_bypasses_ip_check(self):
        response = self.client.get('/admin/', REMOTE_ADDR='192.168.1.5')
        self.assertNotEqual(response.status_code, 403)
