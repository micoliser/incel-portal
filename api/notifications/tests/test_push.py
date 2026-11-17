"""Where a browser push subscription may point, and when pushes are sent."""

from unittest.mock import patch

from django.db import transaction
from django.test import override_settings
from django.urls import reverse
from rest_framework import status

from common.test_utils import BaseAPITestCase
from notifications.models import Notification, PushSubscription
from notifications.serializers import is_allowed_push_endpoint
from notifications.services import create_notification, deliver_push

VAPID = {
    'WEB_PUSH_VAPID_PUBLIC_KEY': 'public',
    'WEB_PUSH_VAPID_PRIVATE_KEY': 'private',
    'WEB_PUSH_VAPID_SUBJECT': 'mailto:admin@example.com',
}
GOOD = 'https://fcm.googleapis.com/fcm/send/abc'


class PushEndpointTests(BaseAPITestCase):
    def test_only_known_push_services_over_https_are_allowed(self):
        allowed = [
            GOOD,
            'https://updates.push.services.mozilla.com/wpush/v2/abc',
            'https://web.push.apple.com/abc',
            'https://db5p.notify.windows.com/w/?token=abc',
        ]
        refused = [
            'http://fcm.googleapis.com/fcm/send/abc',  # not https
            'https://169.254.169.254/latest/meta-data/',  # cloud metadata address
            'https://localhost:6379/',
            'https://internal.service/hook',
            'https://fcm.googleapis.com:8443/fcm/send/abc',  # explicit port
            'https://user:pass@fcm.googleapis.com/fcm/send/abc',  # credentials
            'https://fcm.googleapis.com.evil.example/abc',  # lookalike host
            'https://evilpush.apple.com/abc',  # suffix without the dot
            'not a url',
            '',
        ]
        for endpoint in allowed:
            self.assertTrue(is_allowed_push_endpoint(endpoint), endpoint)
        for endpoint in refused:
            self.assertFalse(is_allowed_push_endpoint(endpoint), endpoint)

    def test_subscribing_with_another_address_is_refused(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        url = reverse('notifications-subscriptions')

        for endpoint in ('https://169.254.169.254/latest/meta-data/', 'http://internal:6379/'):
            response = self.client.post(
                url, {'subscription': {'endpoint': endpoint, 'keys': {'p256dh': 'k', 'auth': 'a'}}}
            )
            self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, endpoint)
            self.assertIn('endpoint', response.data['error']['details'])
        self.assertEqual(PushSubscription.objects.count(), 0)

        response = self.client.post(url, {'subscription': {'endpoint': GOOD, 'keys': {'p256dh': 'k', 'auth': 'a'}}})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)


@override_settings(**VAPID)
class PushDeliveryTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.subscription = PushSubscription.objects.create(
            user=self.staff_user, endpoint=GOOD, p256dh='k', auth='a', is_active=True,
        )

    def _notify(self):
        return create_notification(
            self.staff_user,
            actor=self.admin_user,
            notification_type=Notification.TYPE_TASK_COMMENT,
            title='Hello',
            body='World',
        )

    @patch('pywebpush.webpush')
    def test_push_is_sent_after_commit_with_a_timeout(self, webpush):
        with self.captureOnCommitCallbacks(execute=True):
            self._notify()
            webpush.assert_not_called()  # nothing leaves while the transaction is open

        webpush.assert_called_once()
        self.assertEqual(webpush.call_args.kwargs['timeout'], 10)
        self.assertEqual(webpush.call_args.kwargs['subscription_info']['endpoint'], GOOD)

    @patch('pywebpush.webpush')
    def test_a_rolled_back_notification_is_never_pushed(self, webpush):
        with self.captureOnCommitCallbacks(execute=True):
            try:
                with transaction.atomic():
                    self._notify()
                    raise RuntimeError('the surrounding work failed')
            except RuntimeError:
                pass

        webpush.assert_not_called()
        self.assertEqual(Notification.objects.count(), 0)

    @patch('pywebpush.webpush')
    def test_an_untrusted_stored_endpoint_is_switched_off_not_called(self, webpush):
        """Covers subscriptions saved before endpoints were restricted."""
        PushSubscription.objects.filter(pk=self.subscription.pk).update(endpoint='https://169.254.169.254/x')
        notification = Notification.objects.create(
            recipient=self.staff_user, notification_type=Notification.TYPE_TASK_COMMENT, title='t', body='b',
        )

        deliver_push(notification.id)

        webpush.assert_not_called()
        self.subscription.refresh_from_db()
        self.assertFalse(self.subscription.is_active)

    @override_settings(SEND_PUSH_CELERY=True)
    @patch('notifications.tasks.send_push.delay')
    def test_delivery_is_handed_to_the_worker_when_enabled(self, delay):
        with self.captureOnCommitCallbacks(execute=True):
            notification = self._notify()
        delay.assert_called_once_with(str(notification.id))
