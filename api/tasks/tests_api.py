from datetime import timedelta

from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from applications.models import AuditLog
from common.test_utils import BaseAPITestCase
from tasks.models import Task, TaskActivity


class TasksApiTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.other_user = User.objects.create_user(
            username='other@example.com',
            email='other@example.com',
            password='OtherStrongPass123!',
        )

    def create_task(self, **overrides):
        payload = {
            'title': 'Task title',
            'description': 'Task description',
            'assigned_to_id': self.staff_user.id,
            'priority': 'medium',
            'deadline': (timezone.now() + timedelta(days=2)).isoformat(),
        }
        payload.update(overrides)

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(reverse('task-list'), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        return response

    def _list_results(self, response):
        self.assertIn('results', response.data)
        return response.data['results']

    def test_list_requires_authentication(self):
        response = self.client.get(reverse('task-list'))

        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_create_task_logs_created_activity_and_uses_request_user_as_assigner(self):
        deadline = timezone.now() + timedelta(days=3)

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('task-list'),
            {
                'title': 'Fix broken flow',
                'description': 'Handle edge cases',
                'assigned_to_id': self.staff_user.id,
                'priority': 'high',
                'deadline': deadline.isoformat(),
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['assigned_by']['id'], self.admin_user.id)
        self.assertEqual(response.data['assigned_to']['id'], self.staff_user.id)
        self.assertEqual(response.data['status'], 'pending')

        task = Task.objects.get(id=response.data['id'])
        activities = TaskActivity.objects.filter(task=task)
        self.assertEqual(activities.count(), 1)
        activity = activities.get()
        self.assertEqual(activity.activity_type, 'created')
        self.assertEqual(activity.user, self.admin_user)
        self.assertIn('Task created', activity.comment or '')

        audit = AuditLog.objects.filter(action='TASK_CREATED', target_type='task', target_id=str(task.id)).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.actor_user, self.admin_user)
        self.assertEqual(audit.metadata_json.get('status'), 'pending')
        self.assertEqual(audit.metadata_json.get('assigned_to_id'), self.staff_user.id)

    def test_create_task_does_not_require_assigned_by_id(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('task-list'),
            {
                'title': 'Server owned assigner',
                'assigned_to_id': self.staff_user.id,
                'priority': 'low',
                'deadline': (timezone.now() + timedelta(days=2)).isoformat(),
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['assigned_by']['id'], self.admin_user.id)

    def test_create_task_rejects_missing_assigned_to(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('task-list'),
            {
                'title': 'Missing assignee',
                'priority': 'medium',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('details', response.data['error'])
        self.assertIn('assigned_to_id', response.data['error']['details'])

    def test_create_task_rejects_invalid_priority(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('task-list'),
            {
                'title': 'Bad priority',
                'assigned_to_id': self.staff_user.id,
                'priority': 'urgent',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('details', response.data['error'])
        self.assertIn('priority', response.data['error']['details'])

    def test_create_task_rejects_missing_deadline(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('task-list'),
            {
                'title': 'Missing deadline',
                'assigned_to_id': self.staff_user.id,
                'priority': 'medium',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('details', response.data['error'])
        self.assertIn('deadline', response.data['error']['details'])

    def test_create_task_rejects_past_deadline(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        past_deadline = timezone.now() - timedelta(days=1)
        response = self.client.post(
            reverse('task-list'),
            {
                'title': 'Past deadline blocked',
                'assigned_to_id': self.staff_user.id,
                'priority': 'medium',
                'deadline': past_deadline.isoformat(),
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('details', response.data['error'])
        self.assertIn('deadline', response.data['error']['details'])

    def test_create_task_rejects_self_assignment(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('task-list'),
            {
                'title': 'Self assignment blocked',
                'assigned_to_id': self.admin_user.id,
                'priority': 'medium',
                'deadline': (timezone.now() + timedelta(days=2)).isoformat(),
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('details', response.data['error'])
        self.assertIn('assigned_to_id', response.data['error']['details'])

    def test_list_returns_tasks_assigned_to_or_created_by_current_user_only(self):
        self.create_task(title='Assigned to staff', assigned_to_id=self.staff_user.id)
        self.create_task(title='Created by admin', assigned_to_id=self.other_user.id)

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('task-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = {item['title'] for item in self._list_results(response)}
        self.assertIn('Assigned to staff', titles)
        self.assertNotIn('Created by admin', titles)

    def test_list_deduplicates_task_when_user_is_both_assigner_and_assignee(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        task = Task.objects.create(
            title='Self assigned',
            description='Single row only',
            assigned_by=self.staff_user,
            assigned_to=self.staff_user,
        )

        response = self.client.get(reverse('task-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [item['id'] for item in self._list_results(response)]
        self.assertEqual(ids.count(task.id), 1)

    def test_list_supports_backend_view_and_attribute_filters(self):
        Task.objects.create(
            title='Assigned pending high',
            description='match',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
            status='pending',
            priority='high',
        )
        Task.objects.create(
            title='Assigned completed low',
            description='no match status',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
            status='completed',
            priority='low',
        )
        Task.objects.create(
            title='Created pending high',
            description='different view',
            assigned_by=self.staff_user,
            assigned_to=self.other_user,
            status='pending',
            priority='high',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(
            reverse('task-list'),
            {
                'view': 'assigned',
                'status': 'pending',
                'priority': 'high',
            },
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        titles = [item['title'] for item in self._list_results(response)]
        self.assertEqual(titles, ['Assigned pending high'])

    def test_list_is_paginated_with_20_items_per_page(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        for index in range(21):
            Task.objects.create(
                title=f'Paginated task {index}',
                description='bulk',
                assigned_by=self.admin_user,
                assigned_to=self.staff_user,
                status='pending',
                priority='medium',
            )

        response = self.client.get(reverse('task-list'), {'view': 'assigned'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['count'], 21)
        self.assertEqual(len(self._list_results(response)), 20)
        self.assertIsNotNone(response.data['next'])

    def test_task_detail_requires_involvement(self):
        task = Task.objects.create(
            title='Hidden task',
            description='Not for other user',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.other_user))
        response = self.client.get(reverse('task-detail', kwargs={'pk': task.id}))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_task_detail_allows_assigner_and_assignee(self):
        task = Task.objects.create(
            title='Visible task',
            description='Both parties can read it',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('task-detail', kwargs={'pk': task.id}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['id'], task.id)

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.get(reverse('task-detail', kwargs={'pk': task.id}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_non_involved_user_cannot_update_task(self):
        task = Task.objects.create(
            title='Blocked update',
            description='Other user should not edit',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.other_user))
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {'status': 'in_progress'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_status_change_creates_activity_and_sets_completed_at(self):
        task = Task.objects.create(
            title='Complete me',
            description='Track completion',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {'status': 'in_progress'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        task.refresh_from_db()
        self.assertEqual(task.status, 'in_progress')
        self.assertIsNone(task.completed_at)
        self.assertEqual(TaskActivity.objects.filter(task=task, activity_type='status_change').count(), 1)

        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {'status': 'completed'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        task.refresh_from_db()
        self.assertEqual(task.status, 'completed')
        self.assertIsNotNone(task.completed_at)

        completion_activity = TaskActivity.objects.filter(task=task, activity_type='status_change').order_by('-created_at').first()
        self.assertEqual(completion_activity.old_value, 'in_progress')
        self.assertEqual(completion_activity.new_value, 'completed')

        status_logs = AuditLog.objects.filter(
            action='TASK_STATUS_CHANGED',
            target_type='task',
            target_id=str(task.id),
        )
        self.assertEqual(status_logs.count(), 2)
        latest_log = status_logs.order_by('-created_at').first()
        self.assertEqual(latest_log.actor_user, self.staff_user)
        self.assertEqual(latest_log.metadata_json.get('old_status'), 'in_progress')
        self.assertEqual(latest_log.metadata_json.get('new_status'), 'completed')

    def test_assigner_cannot_change_status(self):
        task = Task.objects.create(
            title='Assigner blocked',
            description='Only assignee can move progress',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {'status': 'in_progress'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('details', response.data['error'])
        self.assertIn('status', response.data['error']['details'])

    def test_status_cannot_move_back_to_pending_after_progress(self):
        task = Task.objects.create(
            title='No pending regression',
            description='Cannot go back once started',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
            status='in_progress',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {'status': 'pending'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('details', response.data['error'])
        self.assertIn('status', response.data['error']['details'])

    def test_repeating_same_status_does_not_create_duplicate_activity(self):
        task = Task.objects.create(
            title='No-op update',
            description='Same status should not log activity',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
            status='in_progress',
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {'status': 'in_progress'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(TaskActivity.objects.filter(task=task).count(), 0)

    def test_activities_endpoint_returns_timeline_newest_first(self):
        task = Task.objects.create(
            title='Timeline task',
            description='Activity order matters',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )
        first = TaskActivity.objects.create(
            task=task,
            user=self.admin_user,
            activity_type='comment',
            comment='First note',
        )
        second = TaskActivity.objects.create(
            task=task,
            user=self.staff_user,
            activity_type='status_change',
            old_value='pending',
            new_value='in_progress',
        )

        TaskActivity.objects.filter(pk=first.pk).update(created_at=timezone.now() - timedelta(minutes=1))
        TaskActivity.objects.filter(pk=second.pk).update(created_at=timezone.now())

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('task-activities', kwargs={'pk': task.id}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual([item['id'] for item in response.data], [second.id, first.id])

    def test_completed_task_can_stay_completed_without_extra_activity(self):
        task = Task.objects.create(
            title='Already done',
            description='Regression on completion timestamp',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
            status='completed',
            completed_at=timezone.now(),
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {'status': 'completed'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(TaskActivity.objects.filter(task=task, activity_type='status_change').count(), 0)
