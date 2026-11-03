from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from applications.models import AuditLog
from accounts.models import StaffProfile
from common.test_utils import BaseAPITestCase
from notifications.models import Notification
from tasks.models import Task, TaskActivity, TaskAttachment


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
        self.assertEqual(audit.metadata_json.get('assigned_to_id'), str(self.staff_user.id))

        assigned_notifications = Notification.objects.filter(
            recipient=self.staff_user,
            notification_type='task_assigned',
        )
        self.assertEqual(assigned_notifications.count(), 1)
        first_assigned = assigned_notifications.first()
        self.assertEqual(first_assigned.title, 'New Task')
        self.assertIn('Fix broken flow', first_assigned.body)
        self.assertIn(self.admin_user.username, first_assigned.body)

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
        self.assertEqual(ids.count(str(task.id)), 1)

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
        self.assertEqual(response.data['id'], str(task.id))

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

        # Assignee cannot complete directly
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {'status': 'completed'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Only the assigner can approve and finalize task completion', str(response.data))

        # Assignee submits for review
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {'status': 'under_review'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        task.refresh_from_db()
        self.assertEqual(task.status, 'under_review')

        # Assigner approves completion
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('task-approve', kwargs={'pk': task.id}),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        task.refresh_from_db()
        self.assertEqual(task.status, 'completed')
        self.assertIsNotNone(task.completed_at)

        completion_activity = TaskActivity.objects.filter(task=task, activity_type='status_change').order_by('-created_at').first()
        self.assertEqual(completion_activity.old_value, 'under_review')
        self.assertEqual(completion_activity.new_value, 'completed')

        status_logs = AuditLog.objects.filter(
            action='TASK_STATUS_CHANGED',
            target_type='task',
            target_id=str(task.id),
        )
        self.assertEqual(status_logs.count(), 3)
        latest_log = status_logs.order_by('-created_at').first()
        self.assertEqual(latest_log.actor_user, self.admin_user)
        self.assertEqual(latest_log.metadata_json.get('old_status'), 'under_review')
        self.assertEqual(latest_log.metadata_json.get('new_status'), 'completed')

        # Notification sent to assignee on approval
        approval_notification = Notification.objects.filter(
            recipient=self.staff_user,
            notification_type='task_status_changed',
        ).order_by('-created_at').first()
        self.assertIsNotNone(approval_notification)
        self.assertEqual(approval_notification.title, f'Task approved: {task.title}')

    def test_assigner_can_reject_task_under_review_with_reason(self):
        task = Task.objects.create(
            title='Reject me',
            description='Test revision request',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
            status='under_review',
        )

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('task-reject', kwargs={'pk': task.id}),
            {'reason': 'Please revise the second section.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        task.refresh_from_db()
        self.assertEqual(task.status, 'in_progress')

        activity = TaskActivity.objects.filter(task=task, activity_type='status_change').order_by('-created_at').first()
        self.assertEqual(activity.old_value, 'under_review')
        self.assertEqual(activity.new_value, 'in_progress')
        self.assertIn('Please revise the second section.', activity.comment)

        rejection_notification = Notification.objects.filter(
            recipient=self.staff_user,
            notification_type='task_status_changed',
        ).order_by('-created_at').first()
        self.assertIsNotNone(rejection_notification)
        self.assertEqual(rejection_notification.title, f'Changes requested: {task.title}')
        self.assertIn('Please revise the second section.', rejection_notification.body)

    def test_assigner_can_edit_task_details_with_audit_log(self):
        task = Task.objects.create(
            title='Original Title',
            description='Original Description',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
            priority='low',
            deadline=timezone.now() + timedelta(days=2),
        )

        new_deadline = timezone.now() + timedelta(days=5)
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {
                'title': 'Updated Title',
                'priority': 'high',
                'deadline': new_deadline.isoformat(),
                'edit_reason': 'Client requested urgent delivery and extended timeframe',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        task.refresh_from_db()
        self.assertEqual(task.title, 'Updated Title')
        self.assertEqual(task.priority, 'high')

        edit_activity = TaskActivity.objects.filter(task=task, activity_type='task_edited').first()
        self.assertIsNotNone(edit_activity)
        self.assertIn('Priority changed from low to high', edit_activity.new_value)
        self.assertIn('Client requested urgent delivery', edit_activity.comment)

        audit_log = AuditLog.objects.filter(action='TASK_EDITED', target_id=str(task.id)).first()
        self.assertIsNotNone(audit_log)
        self.assertEqual(audit_log.actor_user, self.admin_user)
        self.assertIn('priority', audit_log.metadata_json.get('changes', {}))

    def test_assignee_cannot_edit_task_details(self):
        task = Task.objects.create(
            title='Assignee Cannot Edit',
            description='Desc',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
            priority='low',
            deadline=timezone.now() + timedelta(days=2),
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {'priority': 'high'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Only the assigner can edit task details', str(response.data))

    def test_cannot_edit_completed_task_details(self):
        task = Task.objects.create(
            title='Completed Task',
            description='Finished task',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
            priority='low',
            status='completed',
            completed_at=timezone.now(),
        )

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {
                'title': 'Attempting edit',
                'priority': 'high',
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Completed tasks cannot be edited', str(response.data))

    def test_cannot_change_status_of_completed_task(self):
        task = Task.objects.create(
            title='Completed Task Status Change',
            description='Finished task',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
            priority='low',
            status='completed',
            completed_at=timezone.now(),
        )

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': task.id}),
            {'status': 'in_progress'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('Completed tasks cannot be modified', str(response.data))

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
        self.assertEqual([item['id'] for item in response.data], [str(second.id), str(first.id)])

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

    def test_assigner_can_add_comment(self):
        task = Task.objects.create(
            title='Commentable task',
            description='Assigner can comment',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('task-comments', kwargs={'pk': task.id}),
            {'comment': 'Please prioritize this today.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['activity_type'], 'comment')
        self.assertEqual(response.data['comment'], 'Please prioritize this today.')
        self.assertEqual(response.data['user']['id'], self.admin_user.id)
        self.assertTrue(
            TaskActivity.objects.filter(
                task=task,
                user=self.admin_user,
                activity_type='comment',
                comment='Please prioritize this today.',
            ).exists()
        )

    def test_assignee_can_add_comment(self):
        task = Task.objects.create(
            title='Commentable task',
            description='Assignee can comment',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('task-comments', kwargs={'pk': task.id}),
            {'comment': 'Started and making progress.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['activity_type'], 'comment')
        self.assertEqual(response.data['comment'], 'Started and making progress.')
        self.assertEqual(response.data['user']['id'], self.staff_user.id)

    def test_non_involved_user_cannot_add_comment(self):
        task = Task.objects.create(
            title='Restricted comment task',
            description='Only involved users can comment',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.other_user))
        response = self.client.post(
            reverse('task-comments', kwargs={'pk': task.id}),
            {'comment': 'I should not be able to comment.'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_comment_must_not_be_empty(self):
        task = Task.objects.create(
            title='Non-empty comment task',
            description='Comment validation',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('task-comments', kwargs={'pk': task.id}),
            {'comment': '   '},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('comment', response.data['error']['details'])

    def test_comment_must_not_exceed_500_characters(self):
        task = Task.objects.create(
            title='Bounded comment task',
            description='Comment length validation',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('task-comments', kwargs={'pk': task.id}),
            {'comment': 'a' * 501},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('comment', response.data['error']['details'])

        # 500 characters should succeed
        response = self.client.post(
            reverse('task-comments', kwargs={'pk': task.id}),
            {'comment': 'a' * 500},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_comments_can_be_added_after_completion_and_show_in_timeline(self):
        task = Task.objects.create(
            title='Completed with comments',
            description='Comments remain available after completion',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
            status='completed',
            completed_at=timezone.now(),
        )

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        comment_text = 'Post completion note for handoff'
        create_response = self.client.post(
            reverse('task-comments', kwargs={'pk': task.id}),
            {'comment': comment_text},
            format='json',
        )
        self.assertEqual(create_response.status_code, status.HTTP_201_CREATED)

        activities_response = self.client.get(
            reverse('task-activities', kwargs={'pk': task.id})
        )
        self.assertEqual(activities_response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(activities_response.data), 1)
        self.assertEqual(activities_response.data[0]['activity_type'], 'comment')
        self.assertEqual(activities_response.data[0]['comment'], comment_text)

        comment_notifications = Notification.objects.filter(
            recipient=self.staff_user,
            notification_type='task_comment',
        )
        self.assertEqual(comment_notifications.count(), 1)
        notification = comment_notifications.first()
        self.assertEqual(notification.title, f'New comment on task {task.title}')
        self.assertIn('made a new comment "Post completion note..."', notification.body)

    def test_attachment_upload_url_returns_presigned_payload(self):
        task = Task.objects.create(
            title='Upload URL task',
            description='Presigned uploads',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        with patch('tasks.views_api.generate_task_attachment_upload_url') as mock_upload_url:
            mock_upload_url.return_value = {
                'upload_url': 'https://uploads.example/object',
                'object_key': f'task-attachments/{task.id}/sample.pdf',
                'expires_in': 900,
            }
            response = self.client.post(
                reverse('task-attachment-upload-url', kwargs={'pk': task.id}),
                {
                    'file_name': 'sample.pdf',
                    'content_type': 'application/pdf',
                    'size': 12345,
                },
                format='json',
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['object_key'], f'task-attachments/{task.id}/sample.pdf')
        self.assertEqual(response.data['upload_url'], 'https://uploads.example/object')

    def test_comment_with_attachment_creates_attachment_and_timeline_entry(self):
        task = Task.objects.create(
            title='Attachment comment task',
            description='Comment with a file',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )
        object_key = f'task-attachments/{task.id}/report.pdf'

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('task-comments', kwargs={'pk': task.id}),
            {
                'comment': 'Here is the report.',
                'attachment_object_key': object_key,
                'attachment_file_name': 'report.pdf',
                'attachment_content_type': 'application/pdf',
                'attachment_size': 2048,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIsNotNone(response.data['attachments'][0]['download_url'])
        self.assertIn('report.pdf', response.data['attachments'][0]['download_url'])
        self.assertEqual(TaskAttachment.objects.filter(activity__task=task).count(), 1)

        activities_response = self.client.get(reverse('task-activities', kwargs={'pk': task.id}))
        self.assertEqual(activities_response.status_code, status.HTTP_200_OK)
        self.assertEqual(activities_response.data[0]['attachments'][0]['file_name'], 'report.pdf')
        self.assertIsNotNone(activities_response.data[0]['attachments'][0]['download_url'])

    def test_comment_with_attachment_rejects_key_for_other_task(self):
        task = Task.objects.create(
            title='Attachment validation task',
            description='Attachment key must belong to the task',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('task-comments', kwargs={'pk': task.id}),
            {
                'comment': 'Trying to attach a file.',
                'attachment_object_key': 'task-attachments/not-this-task/file.pdf',
                'attachment_file_name': 'file.pdf',
                'attachment_content_type': 'application/pdf',
                'attachment_size': 1024,
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(TaskActivity.objects.filter(task=task).count(), 0)


class ManagerTaskAccessTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.manager_user = User.objects.create_user(
            username='eng_manager@example.com',
            email='eng_manager@example.com',
            password='ManagerPass123!',
        )
        StaffProfile.objects.create(
            user=self.manager_user,
            role=self.role_staff,
            department=self.dep_eng,
        )
        self.dep_eng.line_manager = self.manager_user
        self.dep_eng.save()

        self.hr_user = User.objects.create_user(
            username='hr_staff@example.com',
            email='hr_staff@example.com',
            password='HrStaffPass123!',
        )
        StaffProfile.objects.create(
            user=self.hr_user,
            role=self.role_staff,
            department=self.dep_hr,
        )

        self.assigner_user = User.objects.create_user(
            username='eng_assigner@example.com',
            email='eng_assigner@example.com',
            password='AssignerPass123!',
        )
        StaffProfile.objects.create(
            user=self.assigner_user,
            role=self.role_staff,
            department=self.dep_eng,
        )

        self.task = Task.objects.create(
            title='Subordinate Engineering Task',
            description='Fix backend query latency',
            assigned_by=self.assigner_user,
            assigned_to=self.staff_user,
            status='in_progress',
            priority='high',
            deadline=timezone.now() + timedelta(days=2),
        )

    def test_manager_can_view_subordinate_task(self):
        self.client.credentials(**self.auth_headers_for(self.manager_user))
        response = self.client.get(reverse('task-detail', kwargs={'pk': self.task.id}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['id'], str(self.task.id))

    def test_manager_can_view_subordinate_task_activities(self):
        TaskActivity.objects.create(
            task=self.task,
            user=self.assigner_user,
            activity_type='status_change',
            comment='Task started',
        )
        self.client.credentials(**self.auth_headers_for(self.manager_user))
        response = self.client.get(reverse('task-activities', kwargs={'pk': self.task.id}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)

    def test_manager_can_post_comment_on_subordinate_task(self):
        self.client.credentials(**self.auth_headers_for(self.manager_user))
        response = self.client.post(
            reverse('task-comments', kwargs={'pk': self.task.id}),
            {'comment': 'Please ensure indexes are used.'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(TaskActivity.objects.filter(task=self.task, user=self.manager_user).count(), 1)

    def test_comment_with_valid_links_saved_and_returned(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('task-comments', kwargs={'pk': self.task.id}),
            {
                'comment': 'Check out this design and doc.',
                'links': [
                    {'url': 'https://drive.google.com/file/d/xyz', 'title': 'Project Design Doc'},
                    {'url': 'https://figma.com/file/abc', 'title': 'Figma Mockups'},
                ],
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertIn('links', response.data)
        self.assertEqual(len(response.data['links']), 2)
        self.assertEqual(response.data['links'][0]['url'], 'https://drive.google.com/file/d/xyz')
        self.assertEqual(response.data['links'][0]['title'], 'Project Design Doc')

        activity = TaskActivity.objects.get(id=response.data['id'])
        self.assertEqual(len(activity.links), 2)
        self.assertEqual(activity.links[0]['title'], 'Project Design Doc')

    def test_comment_with_invalid_links_rejected(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('task-comments', kwargs={'pk': self.task.id}),
            {
                'comment': 'Bad link',
                'links': [{'url': 'not_a_valid_url'}],
            },
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


    def test_manager_cannot_edit_task_details(self):
        self.client.credentials(**self.auth_headers_for(self.manager_user))
        response = self.client.patch(
            reverse('task-detail', kwargs={'pk': self.task.id}),
            {'title': 'Unauthorized Manager Title Edit'},
            format='json',
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_manager_cannot_approve_task(self):
        self.task.status = 'under_review'
        self.task.save()
        self.client.credentials(**self.auth_headers_for(self.manager_user))
        response = self.client.post(reverse('task-approve', kwargs={'pk': self.task.id}))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_unrelated_user_cannot_view_task(self):
        self.client.credentials(**self.auth_headers_for(self.hr_user))
        response = self.client.get(reverse('task-detail', kwargs={'pk': self.task.id}))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_team_view_returns_subordinate_tasks(self):
        self.client.credentials(**self.auth_headers_for(self.manager_user))
        response = self.client.get(reverse('task-list') + '?view=team')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        task_ids = [t['id'] for t in response.data['results']]
        self.assertIn(str(self.task.id), task_ids)

    def test_global_access_user_can_view_any_task(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.get(reverse('task-detail', kwargs={'pk': self.task.id}))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
