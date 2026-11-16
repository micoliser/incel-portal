from datetime import timedelta
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework import status

from accounts.models import StaffProfile
from common.test_utils import BaseAPITestCase
from tasks.models import Task, TaskDraft


class TaskDraftsAndMultiAssignApiTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.second_user = User.objects.create_user(
            username='second@example.com',
            email='second@example.com',
            password='SecondStrongPass123!',
            first_name='Second',
            last_name='User',
        )
        StaffProfile.objects.create(
            user=self.second_user,
            role=self.role_staff,
            department=self.dep_hr,
        )

        self.third_user = User.objects.create_user(
            username='third@example.com',
            email='third@example.com',
            password='ThirdStrongPass123!',
            first_name='Third',
            last_name='User',
        )
        StaffProfile.objects.create(
            user=self.third_user,
            role=self.role_staff,
            department=self.dep_hr,
        )

    def test_create_task_with_single_assignee_backward_compat(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        deadline = (timezone.now() + timedelta(days=2)).isoformat()
        response = self.client.post(
            '/api/v1/tasks/',
            {
                'title': 'Single Assignee Task',
                'description': 'Test description',
                'assigned_to_id': self.second_user.id,
                'priority': 'medium',
                'deadline': deadline,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['title'], 'Single Assignee Task')
        self.assertEqual(response.data['assigned_to']['id'], self.second_user.id)
        self.assertTrue(Task.objects.filter(title='Single Assignee Task', assigned_to=self.second_user).exists())

    def test_create_task_with_multiple_assignees(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        deadline = (timezone.now() + timedelta(days=3)).isoformat()
        response = self.client.post(
            '/api/v1/tasks/',
            {
                'title': 'Team Broadcast Task',
                'description': 'Important assignment for all',
                'assigned_to_ids': [self.second_user.id, self.third_user.id],
                'priority': 'high',
                'deadline': deadline,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['count'], 2)
        self.assertEqual(len(response.data['tasks']), 2)

        # Confirm 2 distinct tasks created in database
        tasks = Task.objects.filter(title='Team Broadcast Task')
        self.assertEqual(tasks.count(), 2)
        assignee_ids = set(tasks.values_list('assigned_to_id', flat=True))
        self.assertEqual(assignee_ids, {self.second_user.id, self.third_user.id})

    def test_cannot_assign_to_self_in_multi_assign(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        deadline = (timezone.now() + timedelta(days=3)).isoformat()
        response = self.client.post(
            '/api/v1/tasks/',
            {
                'title': 'Self assignment test',
                'assigned_to_ids': [self.staff_user.id, self.second_user.id],
                'priority': 'low',
                'deadline': deadline,
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        details = response.data.get('error', {}).get('details', response.data)
        self.assertIn('assigned_to_ids', details)

    def test_task_draft_crud(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))

        # 1. Create a draft with partial data
        create_res = self.client.post(
            '/api/v1/task-drafts/',
            {
                'title': 'Draft in progress',
                'description': 'Still writing...',
                'assigned_to_ids': [self.second_user.id],
                'priority': 'high',
            },
            format='json',
        )
        self.assertEqual(create_res.status_code, status.HTTP_201_CREATED)
        draft_id = create_res.data['id']
        self.assertEqual(create_res.data['title'], 'Draft in progress')
        self.assertEqual(len(create_res.data['assigned_to_users']), 1)
        self.assertEqual(create_res.data['assigned_to_users'][0]['id'], self.second_user.id)

        # 2. List drafts
        list_res = self.client.get('/api/v1/task-drafts/')
        self.assertEqual(list_res.status_code, status.HTTP_200_OK)
        self.assertEqual(len(list_res.data), 1)

        # Another user should see zero drafts
        self.client.credentials(**self.auth_headers_for(self.second_user))
        other_list_res = self.client.get('/api/v1/task-drafts/')
        self.assertEqual(len(other_list_res.data), 0)

        # 3. Update the draft
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        update_res = self.client.patch(
            f'/api/v1/task-drafts/{draft_id}/',
            {
                'title': 'Draft updated title',
                'assigned_to_ids': [self.second_user.id, self.third_user.id],
            },
            format='json',
        )
        self.assertEqual(update_res.status_code, status.HTTP_200_OK)
        self.assertEqual(update_res.data['title'], 'Draft updated title')
        self.assertEqual(len(update_res.data['assigned_to_users']), 2)

        # 4. Delete the draft
        del_res = self.client.delete(f'/api/v1/task-drafts/{draft_id}/')
        self.assertEqual(del_res.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(TaskDraft.objects.filter(id=draft_id).exists())
