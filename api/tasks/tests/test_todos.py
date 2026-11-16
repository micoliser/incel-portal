import datetime
from unittest.mock import patch
from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from notifications.models import Notification
from tasks.models import TodoItem
from tasks.tasks import check_due_todo_reminders


class TodoItemAPITests(TestCase):
    def setUp(self):
        self.user1 = User.objects.create_user(
            username='user1@incelgroup.com',
            email='user1@incelgroup.com',
            password='Password123!',
            first_name='User',
            last_name='One',
        )
        self.user2 = User.objects.create_user(
            username='user2@incelgroup.com',
            email='user2@incelgroup.com',
            password='Password123!',
            first_name='User',
            last_name='Two',
        )

        self.client1 = APIClient()
        self.client1.force_authenticate(user=self.user1)

        self.client2 = APIClient()
        self.client2.force_authenticate(user=self.user2)

    def test_create_and_read_todo(self):
        payload = {
            'title': 'Prepare Q3 slide deck',
            'description': 'Gather finance charts',
            'due_date': timezone.now().date().isoformat(),
            'due_time': '16:00',
            'priority': 'high',
            'reminder_offset': '15m',
        }
        response = self.client1.post('/api/v1/todos/', data=payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        data = response.json()
        self.assertEqual(data['title'], 'Prepare Q3 slide deck')
        self.assertEqual(data['priority'], 'high')
        self.assertFalse(data['is_completed'])
        self.assertIsNotNone(data['reminder_at'])
        self.assertIsNotNone(data['due_datetime'])

        # Check list endpoint
        list_resp = self.client1.get('/api/v1/todos/')
        self.assertEqual(list_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(list_resp.json()), 1)

    def test_user_isolation(self):
        # User 1 creates a todo
        todo1 = TodoItem.objects.create(
            user=self.user1,
            title='Confidential strategy note',
            priority='high',
        )

        # User 2 lists todos - should see 0
        resp = self.client2.get('/api/v1/todos/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.json()), 0)

        # User 2 attempts to retrieve User 1's todo - should 404
        resp = self.client2.get(f'/api/v1/todos/{todo1.id}/')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

        # User 2 attempts to modify User 1's todo - should 404
        resp = self.client2.patch(f'/api/v1/todos/{todo1.id}/', {'title': 'Hacked'})
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_toggle_complete(self):
        todo = TodoItem.objects.create(
            user=self.user1,
            title='Review pull request',
            is_completed=False,
        )
        self.assertIsNone(todo.completed_at)

        # Toggle to completed
        resp = self.client1.post(f'/api/v1/todos/{todo.id}/toggle-complete/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.json()['is_completed'])
        self.assertIsNotNone(resp.json()['completed_at'])

        # Toggle back to incomplete
        resp = self.client1.post(f'/api/v1/todos/{todo.id}/toggle-complete/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertFalse(resp.json()['is_completed'])
        self.assertIsNone(resp.json()['completed_at'])

    def test_snooze(self):
        now = timezone.now()
        todo = TodoItem.objects.create(
            user=self.user1,
            title='Team daily standup',
            reminder_at=now,
            reminder_sent=True,
        )

        resp = self.client1.post(f'/api/v1/todos/{todo.id}/snooze/', {'minutes': 20})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        todo.refresh_from_db()
        self.assertFalse(todo.reminder_sent)
        self.assertGreater(todo.reminder_at, now)

    def test_stats_and_clear_completed(self):
        now = timezone.now()
        today = now.date()

        # Overdue item
        yesterday = today - datetime.timedelta(days=1)
        TodoItem.objects.create(
            user=self.user1,
            title='Old task',
            due_date=yesterday,
            due_datetime=now - datetime.timedelta(days=1),
            is_completed=False,
        )

        # Today item
        TodoItem.objects.create(
            user=self.user1,
            title='Today task',
            due_date=today,
            due_datetime=now + datetime.timedelta(hours=2),
            is_completed=False,
        )

        # Upcoming item
        tomorrow = today + datetime.timedelta(days=2)
        TodoItem.objects.create(
            user=self.user1,
            title='Upcoming task',
            due_date=tomorrow,
            due_datetime=now + datetime.timedelta(days=2),
            is_completed=False,
        )

        # Completed item
        TodoItem.objects.create(
            user=self.user1,
            title='Done task',
            is_completed=True,
            completed_at=now,
        )

        # Fetch stats
        resp = self.client1.get('/api/v1/todos/stats/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.json()
        self.assertEqual(data['total'], 4)
        self.assertEqual(data['completed'], 1)
        self.assertEqual(data['overdue'], 1)
        self.assertEqual(data['upcoming'], 1)
        # Today includes today's item + overdue item + item completed today
        self.assertEqual(data['today'], 3)

        # Clear completed
        clear_resp = self.client1.post('/api/v1/todos/clear-completed/')
        self.assertEqual(clear_resp.status_code, status.HTTP_200_OK)
        self.assertEqual(clear_resp.json()['deleted_count'], 1)
        self.assertEqual(TodoItem.objects.filter(user=self.user1).count(), 3)

    def test_celery_reminder_dispatch(self):
        now = timezone.now()
        past_time = now - datetime.timedelta(minutes=5)

        todo = TodoItem.objects.create(
            user=self.user1,
            title='Submit expense receipt',
            reminder_at=past_time,
            reminder_sent=False,
            is_completed=False,
        )

        # Run the celery periodic task
        result = check_due_todo_reminders()
        self.assertEqual(result['processed'], 1)
        self.assertEqual(result['notifications_created'], 1)

        todo.refresh_from_db()
        self.assertTrue(todo.reminder_sent)
        self.assertIsNotNone(todo.reminder_sent_at)

        # Verify in-app notification was created
        notif = Notification.objects.filter(recipient=self.user1, notification_type=Notification.TYPE_TODO_REMINDER).first()
        self.assertIsNotNone(notif)
        self.assertIn('Submit expense receipt', notif.title)
        self.assertEqual(notif.link_url, '/todos')

    def test_multiple_reminder_offsets(self):
        now = timezone.now()
        due_time = now + datetime.timedelta(minutes=20)

        # Creates todo with 30m and 15m offsets
        # Since due is in 20m:
        # - 30m before was 10m ago (due_time - 30m = now - 10m) -> should trigger first!
        # - 15m before will be in 5m (due_time - 15m = now + 5m) -> should trigger next!
        todo = TodoItem.objects.create(
            user=self.user1,
            title='Multi reminder task',
            due_date=due_time.date(),
            due_time=due_time.time(),
            reminder_offsets=['30m', '15m'],
        )
        todo.refresh_from_db()
        self.assertEqual(todo.reminder_offsets, ['30m', '15m'])
        # The earliest unsent reminder is 30m before
        self.assertLess(todo.reminder_at, now)
        self.assertFalse(todo.reminder_sent)

        # First run: dispatches the 30m reminder
        res1 = check_due_todo_reminders()
        self.assertEqual(res1['processed'], 1)
        self.assertEqual(res1['notifications_created'], 1)

        todo.refresh_from_db()
        self.assertEqual(todo.reminders_sent, ['30m'])
        # Next reminder is 15m before (in the future: now + 5m)
        self.assertFalse(todo.reminder_sent)
        self.assertGreater(todo.reminder_at, now)

        # Second run right now: should NOT dispatch yet because 15m reminder is in future
        res2 = check_due_todo_reminders()
        self.assertEqual(res2['processed'], 0)

    def test_todo_pagination(self):
        # Create 30 todos
        for i in range(30):
            TodoItem.objects.create(
                user=self.user1,
                title=f"Todo {i}",
                priority="medium",
            )

        # Unpaginated request (no page param) -> flat list
        unpaginated = self.client1.get('/api/v1/todos/')
        self.assertEqual(unpaginated.status_code, status.HTTP_200_OK)
        self.assertIsInstance(unpaginated.json(), list)
        self.assertEqual(len(unpaginated.json()), 30)

        # Paginated request (page=1) -> DRF paginated response
        paginated_p1 = self.client1.get('/api/v1/todos/?page=1')
        self.assertEqual(paginated_p1.status_code, status.HTTP_200_OK)
        data = paginated_p1.json()
        self.assertIn('results', data)
        self.assertIn('count', data)
        self.assertEqual(data['count'], 30)
        self.assertEqual(len(data['results']), 25)
        self.assertIsNotNone(data['next'])

        # Page 2
        paginated_p2 = self.client1.get('/api/v1/todos/?page=2')
        self.assertEqual(paginated_p2.status_code, status.HTTP_200_OK)
        data2 = paginated_p2.json()
        self.assertEqual(len(data2['results']), 5)
        self.assertIsNone(data2['next'])

    @patch('emails.services.task_emails.TodoReminderEmailService.send')
    def test_todo_reminder_email_dispatch(self, mock_email_send):
        mock_email_send.return_value = True
        now = timezone.now()
        due_time = now + datetime.timedelta(minutes=15)

        todo = TodoItem.objects.create(
            user=self.user1,
            title='Call client',
            description='Discuss renewal contract',
            due_date=due_time.date(),
            due_time=due_time.time(),
            reminder_offsets=['15m'],
            send_email_reminder=True,
            priority='high',
        )

        result = check_due_todo_reminders()
        self.assertEqual(result['processed'], 1)
        self.assertEqual(result['notifications_created'], 1)

        # Check mock_email_send was called
        mock_email_send.assert_called_once()
        recipients, context = mock_email_send.call_args[0]
        self.assertEqual(recipients, [self.user1.email])
        self.assertEqual(context['title'], 'Call client')
        self.assertEqual(context['priority_display'], 'High')
        self.assertEqual(context['reminder_time_label'], '15-minute')
        self.assertIn('/todos', context['todo_url'])

        # Check in-app notification format
        notif = Notification.objects.filter(recipient=self.user1, notification_type=Notification.TYPE_TODO_REMINDER).first()
        self.assertIsNotNone(notif)
        self.assertIn('This is a 15-minute reminder', notif.body)

