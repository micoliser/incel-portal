from django.contrib.auth.models import User
from django.urls import reverse
from rest_framework import status

from common.test_utils import BaseAPITestCase
from notifications.models import Notification, PushSubscription


class NotificationsApiTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.other_user = User.objects.create_user(
            username='other-notify@example.com',
            email='other-notify@example.com',
            password='OtherStrongPass123!',
        )

    def test_list_requires_authentication(self):
        response = self.client.get(reverse('notifications-list'))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_list_returns_only_my_notifications(self):
        mine = Notification.objects.create(
            recipient=self.staff_user,
            actor=self.admin_user,
            notification_type='task_assigned',
            title='Assigned',
            body='Task assigned',
            link_url='/tasks/1',
        )
        Notification.objects.create(
            recipient=self.other_user,
            actor=self.admin_user,
            notification_type='task_assigned',
            title='Not mine',
            body='Task assigned',
            link_url='/tasks/2',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('notifications-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['id'], mine.id)

    def test_unread_count_endpoint(self):
        Notification.objects.create(
            recipient=self.staff_user,
            actor=self.admin_user,
            notification_type='task_assigned',
            title='Unread 1',
            body='Task assigned',
        )
        Notification.objects.create(
            recipient=self.staff_user,
            actor=self.admin_user,
            notification_type='task_comment',
            title='Unread 2',
            body='Task comment',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('notifications-unread-count'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['unread_count'], 2)

    def test_mark_single_notification_read(self):
        notification = Notification.objects.create(
            recipient=self.staff_user,
            actor=self.admin_user,
            notification_type='task_assigned',
            title='Needs read',
            body='Task assigned',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('notifications-mark-read', kwargs={'notification_id': notification.id})
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        notification.refresh_from_db()
        self.assertTrue(notification.is_read)
        self.assertIsNotNone(notification.read_at)

    def test_mark_single_notification_read_rejects_other_user(self):
        notification = Notification.objects.create(
            recipient=self.other_user,
            actor=self.admin_user,
            notification_type='task_assigned',
            title='Other user',
            body='Task assigned',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('notifications-mark-read', kwargs={'notification_id': notification.id})
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_mark_all_read(self):
        Notification.objects.create(
            recipient=self.staff_user,
            actor=self.admin_user,
            notification_type='task_assigned',
            title='One',
            body='Body',
        )
        Notification.objects.create(
            recipient=self.staff_user,
            actor=self.admin_user,
            notification_type='task_comment',
            title='Two',
            body='Body',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(reverse('notifications-read-all'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['updated'], 2)
        self.assertEqual(
            Notification.objects.filter(recipient=self.staff_user, is_read=False).count(),
            0,
        )

    def test_clear_single_notification(self):
        notification = Notification.objects.create(
            recipient=self.staff_user,
            actor=self.admin_user,
            notification_type='task_assigned',
            title='Clear me',
            body='Body',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.delete(
            reverse('notifications-delete', kwargs={'notification_id': notification.id})
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Notification.objects.filter(id=notification.id).exists())

    def test_clear_single_notification_rejects_other_user(self):
        notification = Notification.objects.create(
            recipient=self.other_user,
            actor=self.admin_user,
            notification_type='task_assigned',
            title='Not yours',
            body='Body',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.delete(
            reverse('notifications-delete', kwargs={'notification_id': notification.id})
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_clear_all_notifications(self):
        Notification.objects.create(
            recipient=self.staff_user,
            actor=self.admin_user,
            notification_type='task_assigned',
            title='One',
            body='Body',
        )
        Notification.objects.create(
            recipient=self.staff_user,
            actor=self.admin_user,
            notification_type='task_comment',
            title='Two',
            body='Body',
        )
        Notification.objects.create(
            recipient=self.other_user,
            actor=self.admin_user,
            notification_type='task_comment',
            title='Other',
            body='Body',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.delete(reverse('notifications-clear-all'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['deleted'], 2)
        self.assertEqual(Notification.objects.filter(recipient=self.staff_user).count(), 0)
        self.assertEqual(Notification.objects.filter(recipient=self.other_user).count(), 1)

    def test_push_subscription_upsert_and_delete(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))

        create_response = self.client.post(
            reverse('notifications-subscriptions'),
            {
                'subscription': {
                    'endpoint': 'https://example.com/endpoint/abc',
                    'keys': {
                        'p256dh': 'p256dh-key',
                        'auth': 'auth-key',
                    },
                },
                'user_agent': 'pytest-agent',
            },
            format='json',
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)
        subscription_id = create_response.data['id']
        self.assertTrue(
            PushSubscription.objects.filter(id=subscription_id, user=self.staff_user).exists()
        )

        update_response = self.client.post(
            reverse('notifications-subscriptions'),
            {
                'subscription': {
                    'endpoint': 'https://example.com/endpoint/abc',
                    'keys': {
                        'p256dh': 'new-p256dh-key',
                        'auth': 'new-auth-key',
                    },
                },
            },
            format='json',
        )
        self.assertEqual(update_response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(update_response.data['id'], subscription_id)

        delete_response = self.client.delete(
            reverse('notifications-subscription-delete', kwargs={'subscription_id': subscription_id})
        )
        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(PushSubscription.objects.filter(id=subscription_id).exists())
