from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.auth.models import User
from .models import InventoryCategory, InventoryItem, InventoryAssignment

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
        response = self.client.post('/api/v1/inventory/categories/', {'name': 'Phones', 'description': 'Mobile phones'})
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        
        self.client.force_authenticate(user=self.user)
        response = self.client.post('/api/v1/inventory/categories/', {'name': 'Tablets'})
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_item_create_admin_only(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post('/api/v1/inventory/items/', {
            'name': 'ThinkPad',
            'category': self.category.id,
            'serial_number': 'TP123'
        })
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(InventoryItem.objects.count(), 2)
        
        self.client.force_authenticate(user=self.user)
        response = self.client.post('/api/v1/inventory/items/', {
            'name': 'iPad',
            'category': self.category.id
        })
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_assign_item(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f'/api/v1/inventory/items/{self.item.id}/assign/', {
            'assigned_to': str(self.user.id),
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
        response = self.client.post(f'/api/v1/inventory/items/{self.item.id}/return_item/', {
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
        response = self.client.get('/api/v1/me/inventory/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['name'], 'MacBook Pro')
        
        # Another user should see nothing
        other_user = User.objects.create_user(username='user2', password='password')
        self.client.force_authenticate(user=other_user)
        response = self.client.get('/api/v1/me/inventory/')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 0)
