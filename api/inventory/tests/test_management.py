from unittest.mock import patch, MagicMock
from io import BytesIO
from django.core.management import call_command
from django.test import TestCase, override_settings
from PIL import Image

from inventory.models import InventoryItem, InventoryCategory

@override_settings(AWS_S3_BUCKET_NAME='test-bucket', AWS_INVENTORY_PHOTO_S3_PREFIX='inventory/photos')
class CompressS3ImagesCommandTests(TestCase):
    def setUp(self):
        self.category = InventoryCategory.objects.create(name="Test Cat")
        self.item1 = InventoryItem.objects.create(
            name="Item 1", 
            category=self.category,
            photo_url="https://test-bucket.s3.amazonaws.com/inventory/photos/test1.jpg"
        )
        self.item2 = InventoryItem.objects.create(
            name="Item 2", 
            category=self.category,
            photo_url="https://test-bucket.s3.amazonaws.com/inventory/photos/test2.jpg"
        )

    @patch('inventory.management.commands.compress_s3_images._s3_client')
    def test_compress_s3_images(self, mock_s3_client):
        mock_s3 = MagicMock()
        mock_s3_client.return_value = mock_s3

        import os
        # Create a large dummy image in memory with random noise so it doesn't compress too small
        large_img = Image.frombytes('RGB', (2000, 2000), os.urandom(2000 * 2000 * 3))
        img_byte_arr = BytesIO()
        large_img.save(img_byte_arr, format='JPEG', quality=100)
        large_img_bytes = img_byte_arr.getvalue()

        # Mock the get_object response
        mock_s3.get_object.return_value = {
            'Body': MagicMock(read=MagicMock(return_value=large_img_bytes))
        }

        call_command('compress_s3_images')

        # Should be called twice (once for each item)
        self.assertEqual(mock_s3.get_object.call_count, 2)
        self.assertEqual(mock_s3.put_object.call_count, 2)

        # Check put_object args for one of them
        args, kwargs = mock_s3.put_object.call_args
        self.assertEqual(kwargs['Bucket'], 'test-bucket')
        self.assertEqual(kwargs['ContentType'], 'image/jpeg')
        self.assertIn('inventory/photos/test', kwargs['Key'])
        self.assertTrue(len(kwargs['Body']) < len(large_img_bytes))
