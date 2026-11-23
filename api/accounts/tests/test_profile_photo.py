from unittest.mock import patch

from django.test import override_settings

from applications.models import AuditLog
from common.test_utils import BaseAPITestCase


@override_settings(AWS_S3_BUCKET_NAME='bucket', AWS_S3_CUSTOM_DOMAIN='cdn.example.com', AWS_S3_ENDPOINT_URL='')
class ProfilePhotoTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.client.credentials(**self.auth_headers_for(self.staff_user))

    def upload_url(self, **data):
        with patch('accounts.s3.s3_client') as client:
            client.return_value.generate_presigned_url.return_value = 'https://upload.example/x'
            return self.client.post('/api/v1/me/profile-photo/upload-url', data, format='json')

    def test_upload_use_and_remove_a_picture(self):
        response = self.upload_url(content_type='image/jpeg', size=200_000)
        self.assertEqual(response.status_code, 200, response.content)
        url = response.json()['public_url']
        self.assertTrue(url.startswith(f'https://cdn.example.com/profile-photos/{self.staff_user.id}/'))
        self.assertTrue(url.endswith('.jpg'))

        saved = self.client.put('/api/v1/me/profile-photo', {'avatar_url': url}, format='json')
        self.assertEqual(saved.status_code, 200, saved.content)
        self.assertEqual(saved.json()['avatar_url'], url)
        self.assertEqual(self.client.get('/api/v1/me').json()['avatar_url'], url)
        self.assertTrue(AuditLog.objects.filter(action='PROFILE_PHOTO_UPDATED').exists())

        with patch('accounts.s3.s3_client') as client:
            removed = self.client.delete('/api/v1/me/profile-photo')
        self.assertEqual(removed.status_code, 200)
        self.assertIsNone(removed.json()['avatar_url'])
        client.return_value.delete_object.assert_called_once()

    def test_only_images_up_to_5_mb(self):
        self.assertEqual(self.upload_url(content_type='image/svg+xml', size=1000).status_code, 400)
        self.assertEqual(self.upload_url(content_type='application/pdf', size=1000).status_code, 400)
        self.assertEqual(self.upload_url(content_type='image/png', size=6 * 1024 * 1024).status_code, 400)

    def test_only_a_picture_from_your_own_folder(self):
        someone_else = f'https://cdn.example.com/profile-photos/{self.admin_user.id}/abc.jpg'
        for url in (someone_else, 'https://evil.example/x.jpg', 'https://cdn.example.com/application-logos/a/b.png'):
            response = self.client.put('/api/v1/me/profile-photo', {'avatar_url': url}, format='json')
            self.assertEqual(response.status_code, 400, url)
