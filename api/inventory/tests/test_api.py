from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework import status
from rest_framework.test import APITestCase

from common.storage import public_url_for_key
from inventory.models import (
    InventoryAssignment,
    InventoryCategory,
    InventoryItem,
    InventoryMaintenanceLog,
    MaintenanceLogAttachment,
)
from inventory.s3 import maintenance_attachment_key_prefix

User = get_user_model()

PREFIX = maintenance_attachment_key_prefix()


class InventoryAPITests(APITestCase):
    def setUp(self):
        self.admin = User.objects.create_superuser(username='admin', password='password', email='admin@example.com')
        self.user = User.objects.create_user(username='user1', password='password', email='user1@example.com')
        
        self.category = InventoryCategory.objects.create(name='Laptops', description='Computing devices')
        self.item = InventoryItem.objects.create(
            name='MacBook Pro',
            category=self.category,
            serial_number='C0212345',
            status='available'
        )

    def test_category_create_admin_only(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/v1/inventory/categories', {'name': 'Phones', 'description': 'Mobile phones'})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        self.client.force_authenticate(user=self.user)
        response = self.client.post('/api/v1/inventory/categories', {'name': 'Tablets'})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_item_create_admin_only(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/v1/inventory/items', {
            'name': 'ThinkPad',
            'category_id': self.category.id,
            'serial_number': 'TP123'
        })
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(InventoryItem.objects.count(), 2)
        
        self.client.force_authenticate(user=self.user)
        response = self.client.post('/api/v1/inventory/items', {
            'name': 'iPad',
            'category_id': self.category.id
        })
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_assign_item(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f'/api/v1/inventory/items/{self.item.id}/assign', {
            'assigned_to_id': self.user.id,
            'condition_notes': 'Brand new'
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, 'assigned')
        self.assertEqual(self.item.current_assignee, self.user)
        
        # Check assignment record
        assignment = self.item.assignments.first()
        self.assertIsNotNone(assignment)
        self.assertEqual(assignment.assigned_to, self.user)
        self.assertEqual(assignment.assigned_by, self.admin)
        self.assertIsNone(assignment.returned_at)

    def test_return_item(self):
        # Assign first
        self.item.status = 'assigned'
        self.item.current_assignee = self.user
        self.item.save()
        assignment = InventoryAssignment.objects.create(
            item=self.item, assigned_to=self.user, assigned_by=self.admin
        )

        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f'/api/v1/inventory/items/{self.item.id}/return', {
            'condition_notes': 'Scratched'
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        
        self.item.refresh_from_db()
        self.assertEqual(self.item.status, 'available')
        self.assertIsNone(self.item.current_assignee)
        
        assignment.refresh_from_db()
        self.assertIsNotNone(assignment.returned_at)
        self.assertEqual(assignment.condition_notes, 'Scratched')

    def test_my_inventory(self):
        self.item.status = 'assigned'
        self.item.current_assignee = self.user
        self.item.save()

        self.client.force_authenticate(user=self.user)
        response = self.client.get('/api/v1/me/inventory')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['name'], 'MacBook Pro')
        
        # Another user should see nothing
        other_user = User.objects.create_user(username='user2', password='password')
        self.client.force_authenticate(user=other_user)
        response = self.client.get('/api/v1/me/inventory')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 0)

    def test_asset_code_generation_on_create(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/v1/inventory/items', {
            'name': 'Test Asset',
            'category_id': self.category.id,
            'serial_number': 'TEST1234'
        })
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('code', response.data)
        self.assertTrue(len(response.data['code']) == 6)
        self.assertTrue(response.data['code'].isdigit())

    @patch('inventory.models.random.choices')
    def test_asset_code_uniqueness_and_collision_retry(self, mock_choices):
        # Force a collision by making choices return the same list of digits twice, then a new one
        mock_choices.side_effect = [['1', '1', '1', '1', '1', '1'], ['1', '1', '1', '1', '1', '1'], ['2', '2', '2', '2', '2', '2']]
        
        # Create first item
        item1 = InventoryItem.objects.create(name='Item 1', category=self.category)
        self.assertEqual(item1.code, '111111')
        
        # Create second item, should retry on collision and get 222222
        item2 = InventoryItem.objects.create(name='Item 2', category=self.category)
        self.assertEqual(item2.code, '222222')

    def test_upload_photo_url_endpoint(self):
        self.client.force_authenticate(user=self.admin)
        
        # Test invalid content type
        response = self.client.post('/api/v1/inventory/items/photo-upload-url', {
            'file_name': 'doc.pdf',
            'content_type': 'application/pdf'
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        
        # Test valid content type
        response = self.client.post('/api/v1/inventory/items/photo-upload-url', {
            'file_name': 'photo.png',
            'content_type': 'image/png'
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('upload_url', response.data)
        self.assertIn('public_url', response.data)
        self.assertIn('object_key', response.data)

    def test_completed_maintenance_log_is_immutable(self):
        log = InventoryMaintenanceLog.objects.create(
            item=self.item,
            date='2026-09-01',
            issue_reported='Screen flickering',
            status='completed',
            created_by=self.admin
        )
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(f'/api/v1/inventory/maintenance-logs/{log.id}', {
            'issue_reported': 'New issue'
        })
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_can_complete_maintenance_log(self):
        log = InventoryMaintenanceLog.objects.create(
            item=self.item,
            date='2026-09-01',
            issue_reported='Screen flickering',
            status='open',
            created_by=self.admin
        )
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(f'/api/v1/inventory/maintenance-logs/{log.id}', {
            'status': 'completed',
            'action_taken': 'Fixed it'
        })
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        log.refresh_from_db()
        self.assertEqual(log.status, 'completed')

    def test_maintenance_log_attachment_creation(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/v1/inventory/maintenance-logs', {
            'item_id': self.item.id,
            'date': '2026-09-01',
            'issue_reported': 'Test issue',
            'status': 'open',
            'attachments': [
                {'object_key': f'{PREFIX}key1', 'file_name': 'test1.txt', 'content_type': 'text/plain', 'size': 123},
                {'object_key': f'{PREFIX}key2', 'file_name': 'test2.txt', 'content_type': 'text/plain', 'size': 456}
            ]
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        log = InventoryMaintenanceLog.objects.filter(item=self.item).first()
        self.assertIsNotNone(log)
        self.assertEqual(log.attachments.count(), 2)

    def test_maintenance_log_attachment_update_append(self):
        log = InventoryMaintenanceLog.objects.create(
            item=self.item,
            date='2026-09-01',
            issue_reported='Screen flickering',
            status='open',
            created_by=self.admin
        )
        # Create an existing attachment
        MaintenanceLogAttachment.objects.create(
            log=log,
            object_key=f'{PREFIX}existing_key',
            file_name='existing.txt',
            content_type='text/plain',
            size=100
        )
        
        self.client.force_authenticate(user=self.admin)
        # Update and provide the existing attachment + a new one
        response = self.client.patch(f'/api/v1/inventory/maintenance-logs/{log.id}', {
            'item_id': self.item.id,
            'date': '2026-09-01',
            'issue_reported': 'Screen flickering',
            'status': 'open',
            'attachments': [
                {'object_key': f'{PREFIX}existing_key', 'file_name': 'existing.txt', 'content_type': 'text/plain', 'size': 100},
                {'object_key': f'{PREFIX}new_key', 'file_name': 'new.txt', 'content_type': 'text/plain', 'size': 200}
            ]
        }, format='json')
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        log.refresh_from_db()
        self.assertEqual(log.attachments.count(), 2)
        keys = list(log.attachments.values_list('object_key', flat=True))
        self.assertIn(f'{PREFIX}existing_key', keys)
        self.assertIn(f'{PREFIX}new_key', keys)

    def test_maintenance_log_attachment_limit(self):
        self.client.force_authenticate(user=self.admin)
        attachments = [
            {'object_key': f'{PREFIX}key{i}', 'file_name': f'test{i}.txt', 'content_type': 'text/plain', 'size': 123}
            for i in range(6)
        ]
        response = self.client.post('/api/v1/inventory/maintenance-logs', {
            'item_id': self.item.id,
            'date': '2026-09-01',
            'issue_reported': 'Test issue',
            'status': 'open',
            'attachments': attachments
        }, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('attachments', response.data['error']['details'])

    def test_item_create_with_quantity(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/v1/inventory/items', {
            'name': 'Test Item Qty',
            'category_id': self.category.id,
            'quantity': 5,
            'status': 'available'
        })
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['quantity'], 5)

    def test_item_create_unaccounted_missing_reason(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/v1/inventory/items', {
            'name': 'Lost Item',
            'category_id': self.category.id,
            'status': 'unaccounted'
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('status_reason', response.data['error']['details'])

    def test_item_create_unaccounted_with_reason(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/v1/inventory/items', {
            'name': 'Lost Item 2',
            'category_id': self.category.id,
            'status': 'unaccounted',
            'status_reason': 'Stolen during conference'
        })
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['status'], 'unaccounted')
        self.assertEqual(response.data['status_reason'], 'Stolen during conference')

    def test_assign_item_unaccounted_fails(self):
        self.item.status = 'unaccounted'
        self.item.status_reason = 'Lost'
        self.item.save()

        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f'/api/v1/inventory/items/{self.item.id}/assign', {
            'assigned_to_id': self.user.id,
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Cannot assign an item with status \'unaccounted\'', str(response.data['error']['details']))

    def test_assign_item_retired_fails(self):
        self.item.status = 'retired'
        self.item.save()

        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f'/api/v1/inventory/items/{self.item.id}/assign', {
            'assigned_to_id': self.user.id,
        })
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Cannot assign an item with status \'retired\'', str(response.data['error']['details']))


class InventoryUploadRuleTests(InventoryAPITests):
    """What may be uploaded and attached in inventory."""

    def test_photo_upload_accepts_only_safe_image_types(self):
        self.client.force_authenticate(user=self.admin)
        url = '/api/v1/inventory/items/photo-upload-url'
        for content_type in ('image/svg+xml', 'text/html', 'application/pdf'):
            response = self.client.post(url, {'file_name': 'x', 'content_type': content_type})
            self.assertEqual(response.status_code, 400, content_type)
            self.assertIn('content_type', response.data['error']['details'])

    def test_photo_must_be_one_uploaded_through_the_portal(self):
        self.client.force_authenticate(user=self.admin)
        url = f'/api/v1/inventory/items/{self.item.id}'

        response = self.client.patch(url, {'photo_url': 'https://evil.example.com/tracker.png'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('photo_url', response.data['error']['details'])

        ours = public_url_for_key(f'{settings.AWS_INVENTORY_PHOTO_S3_PREFIX}/abc.png')
        self.assertEqual(self.client.patch(url, {'photo_url': ours}).status_code, 200)

    def test_maintenance_attachment_must_be_a_maintenance_upload(self):
        self.client.force_authenticate(user=self.admin)
        for key in ('https://evil.example.com/file.pdf', 'task-attachments/abc/file.pdf', f'{PREFIX}../secret'):
            response = self.client.post('/api/v1/inventory/maintenance-logs', {
                'item_id': self.item.id,
                'date': '2026-09-01',
                'issue_reported': 'Broken',
                'status': 'open',
                'attachments': [{'object_key': key, 'file_name': 'f.pdf', 'content_type': 'application/pdf', 'size': 1}],
            })
            self.assertEqual(response.status_code, 400, key)

    def test_maintenance_files_are_served_by_short_lived_links(self):
        self.client.force_authenticate(user=self.admin)
        created = self.client.post('/api/v1/inventory/maintenance-logs', {
            'item_id': self.item.id,
            'date': '2026-09-01',
            'issue_reported': 'Broken',
            'status': 'open',
            'attachments': [
                {'object_key': f'{PREFIX}report', 'file_name': 'f.pdf', 'content_type': 'application/pdf', 'size': 1},
            ],
        })
        self.assertEqual(created.status_code, 201)

        with patch('common.storage.s3_client') as client:
            client.return_value.generate_presigned_url.return_value = 'https://signed.example.com/f.pdf?sig=1'
            listed = self.client.get('/api/v1/inventory/maintenance-logs')

        attachment = listed.data['results'][0]['attachments'][0]
        self.assertEqual(attachment['file_url'], 'https://signed.example.com/f.pdf?sig=1')
        params = client.return_value.generate_presigned_url.call_args.kwargs
        self.assertEqual(params['ClientMethod'], 'get_object')
        self.assertEqual(params['Params']['Key'], f'{PREFIX}report')
