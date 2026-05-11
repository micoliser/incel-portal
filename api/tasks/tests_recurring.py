from datetime import datetime, timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone
from rest_framework import status

from applications.models import AuditLog
from common.test_utils import BaseAPITestCase
from tasks.models import RecurrenceOccurrence, RecurringSchedule, Task
from tasks.services import calculate_next_run_at
from tasks.tasks import generate_recurring_task_occurrences


class RecurringScheduleApiTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.other_user = User.objects.create_user(
            username='other@example.com',
            email='other@example.com',
            password='OtherStrongPass123!',
        )

    def create_schedule_record(self, **overrides):
        defaults = {
            'title': 'Recurring title',
            'description': 'Recurring description',
            'assigned_by': self.admin_user,
            'assigned_to': self.staff_user,
            'priority': 'medium',
            'frequency': 'daily',
            'interval': 1,
            'weekdays': [],
            'times': ['09:00'],
            'timezone': 'UTC',
            'deadline_offset_minutes': 15,
            'start_at': timezone.now() + timedelta(days=1),
            'end_at': None,
            'next_run_at': timezone.now() + timedelta(days=1),
            'is_active': True,
            'is_paused': False,
            'paused_at': None,
            'paused_by': None,
            'ended_at': None,
            'ended_by': None,
        }
        defaults.update(overrides)
        return RecurringSchedule.objects.create(**defaults)

    def create_schedule_payload(self, **overrides):
        defaults = {
            'title': 'Recurring title',
            'description': 'Recurring description',
            'assigned_to_id': self.staff_user.id,
            'priority': 'medium',
            'frequency': 'daily',
            'interval': 1,
            'weekdays': [],
            'times': ['09:00'],
            'timezone': 'UTC',
            'deadline_offset_minutes': 15,
            'start_at': (timezone.now() + timedelta(days=1)).isoformat(),
            'end_at': None,
        }
        defaults.update(overrides)
        return defaults

    def test_create_recurring_schedule_sets_creator_and_next_run_at(self):
        expected_next_run_at = timezone.now() + timedelta(days=1, hours=2)
        payload = self.create_schedule_payload(
            title='Quarterly operations review',
            description='Recurring check-in for the ops team',
            assigned_to_id=self.staff_user.id,
            frequency='weekly',
            interval=2,
            weekdays=[1, 3],
            times=['09:00', '17:00'],
            timezone='Asia/Dubai',
            deadline_offset_minutes=30,
        )

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        with patch('tasks.views_api.calculate_next_run_at', return_value=expected_next_run_at) as mock_next_run:
            response = self.client.post(
                reverse('recurring-schedule-list'),
                payload,
                format='json',
            )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['assigned_by']['id'], self.admin_user.id)
        self.assertEqual(response.data['assigned_to']['id'], self.staff_user.id)
        response_next_run_at = datetime.fromisoformat(
            response.data['next_run_at'].replace('Z', '+00:00')
        )
        self.assertEqual(response_next_run_at, expected_next_run_at)
        mock_next_run.assert_called_once()

        schedule = RecurringSchedule.objects.get(id=response.data['id'])
        self.assertEqual(schedule.assigned_by, self.admin_user)
        self.assertEqual(schedule.next_run_at, expected_next_run_at)

        audit = AuditLog.objects.filter(
            action='TASK_RECURRING_SCHEDULE_CREATED',
            target_type='recurring_schedule',
            target_id=str(schedule.id),
        ).first()
        self.assertIsNotNone(audit)
        self.assertEqual(audit.actor_user, self.admin_user)
        self.assertEqual(audit.metadata_json.get('assigned_by_id'), str(self.admin_user.id))
        self.assertEqual(audit.metadata_json.get('assigned_to_id'), str(self.staff_user.id))

    def test_create_recurring_schedule_rejects_self_assignment(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('recurring-schedule-list'),
            self.create_schedule_payload(assigned_to_id=self.admin_user.id),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('assigned_to_id', response.data['error']['details'])

    def test_create_recurring_schedule_rejects_invalid_timezone(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('recurring-schedule-list'),
            self.create_schedule_payload(timezone='Mars/Phobos'),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('timezone', response.data['error']['details'])

    def test_create_weekly_schedule_requires_weekdays(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('recurring-schedule-list'),
            self.create_schedule_payload(
                frequency='weekly',
                weekdays=[],
                times=['09:00'],
            ),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('weekdays', response.data['error']['details'])

    def test_create_recurring_schedule_rejects_invalid_time_format(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('recurring-schedule-list'),
            self.create_schedule_payload(times=['9 am']),
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('times', response.data['error']['details'])

    def test_detail_is_hidden_from_non_involved_user(self):
        schedule = self.create_schedule_record()

        self.client.credentials(**self.auth_headers_for(self.other_user))
        response = self.client.get(reverse('recurring-schedule-detail', kwargs={'pk': schedule.id}))

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_creator_can_not_change_assignee_on_update(self):
        schedule = self.create_schedule_record()

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.patch(
            reverse('recurring-schedule-detail', kwargs={'pk': schedule.id}),
            {'assigned_to_id': self.other_user.id},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('assigned_to_id', response.data['error']['details'])

    def test_creator_cannot_change_start_at_after_schedule_started(self):
        schedule = self.create_schedule_record(
            start_at=timezone.now() - timedelta(days=2),
            next_run_at=timezone.now() - timedelta(hours=1),
        )

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.patch(
            reverse('recurring-schedule-detail', kwargs={'pk': schedule.id}),
            {'start_at': (timezone.now() + timedelta(days=2)).isoformat()},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('error', response.data)
        self.assertIn('start_at', response.data['error']['details'])

    def test_non_creator_cannot_mutate_recurring_schedule(self):
        schedule = self.create_schedule_record()

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        patch_response = self.client.patch(
            reverse('recurring-schedule-detail', kwargs={'pk': schedule.id}),
            {'title': 'Blocked update'},
            format='json',
        )
        pause_response = self.client.post(
            reverse('recurring-schedule-pause', kwargs={'pk': schedule.id}),
            {},
            format='json',
        )
        resume_response = self.client.post(
            reverse('recurring-schedule-resume', kwargs={'pk': schedule.id}),
            {},
            format='json',
        )
        end_response = self.client.post(
            reverse('recurring-schedule-end', kwargs={'pk': schedule.id}),
            {},
            format='json',
        )

        self.assertEqual(patch_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(pause_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(resume_response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(end_response.status_code, status.HTTP_403_FORBIDDEN)

    def test_pause_schedule_marks_pause_metadata_and_is_idempotent(self):
        schedule = self.create_schedule_record()

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        pause_response = self.client.post(
            reverse('recurring-schedule-pause', kwargs={'pk': schedule.id}),
            {},
            format='json',
        )

        self.assertEqual(pause_response.status_code, status.HTTP_200_OK)
        schedule.refresh_from_db()
        self.assertTrue(schedule.is_paused)
        self.assertIsNotNone(schedule.paused_at)
        self.assertEqual(schedule.paused_by, self.admin_user)
        self.assertEqual(
            AuditLog.objects.filter(
                action='TASK_RECURRING_SCHEDULE_PAUSED',
                target_id=str(schedule.id),
            ).count(),
            1,
        )

        second_pause_response = self.client.post(
            reverse('recurring-schedule-pause', kwargs={'pk': schedule.id}),
            {},
            format='json',
        )

        self.assertEqual(second_pause_response.status_code, status.HTTP_200_OK)
        self.assertEqual(
            AuditLog.objects.filter(
                action='TASK_RECURRING_SCHEDULE_PAUSED',
                target_id=str(schedule.id),
            ).count(),
            1,
        )

    def test_resume_schedule_restores_next_run_and_clears_pause_state(self):
        schedule = self.create_schedule_record(
            is_paused=True,
            paused_at=timezone.now() - timedelta(hours=2),
            paused_by=self.admin_user,
            next_run_at=timezone.now() - timedelta(minutes=10),
        )
        expected_next_run_at = timezone.now() + timedelta(hours=3)

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        with patch('tasks.views_api.calculate_next_run_at', return_value=expected_next_run_at) as mock_next_run:
            response = self.client.post(
                reverse('recurring-schedule-resume', kwargs={'pk': schedule.id}),
                {},
                format='json',
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mock_next_run.assert_called_once()
        schedule.refresh_from_db()
        self.assertFalse(schedule.is_paused)
        self.assertIsNone(schedule.paused_at)
        self.assertIsNone(schedule.paused_by)
        self.assertEqual(schedule.next_run_at, expected_next_run_at)
        self.assertEqual(
            AuditLog.objects.filter(
                action='TASK_RECURRING_SCHEDULE_RESUMED',
                target_id=str(schedule.id),
            ).count(),
            1,
        )

    def test_resume_rejects_expired_schedule(self):
        schedule = self.create_schedule_record(
            is_paused=True,
            paused_at=timezone.now() - timedelta(days=1),
            paused_by=self.admin_user,
            end_at=timezone.now() - timedelta(minutes=1),
            next_run_at=timezone.now() - timedelta(hours=1),
        )

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('recurring-schedule-resume', kwargs={'pk': schedule.id}),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('detail', response.data)
        self.assertIn('expired', response.data['detail'])

    def test_end_schedule_clears_pause_state_and_blocks_future_runs(self):
        schedule = self.create_schedule_record(
            is_paused=True,
            paused_at=timezone.now() - timedelta(hours=2),
            paused_by=self.admin_user,
            next_run_at=timezone.now() - timedelta(minutes=10),
        )

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('recurring-schedule-end', kwargs={'pk': schedule.id}),
            {},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        schedule.refresh_from_db()
        self.assertFalse(schedule.is_active)
        self.assertFalse(schedule.is_paused)
        self.assertIsNone(schedule.paused_at)
        self.assertIsNone(schedule.paused_by)
        self.assertEqual(schedule.ended_by, self.admin_user)
        self.assertIsNone(schedule.next_run_at)
        self.assertEqual(
            AuditLog.objects.filter(
                action='TASK_RECURRING_SCHEDULE_ENDED',
                target_id=str(schedule.id),
            ).count(),
            1,
        )


class RecurringScheduleWorkerTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.other_user = User.objects.create_user(
            username='other@example.com',
            email='other@example.com',
            password='OtherStrongPass123!',
        )

    def create_schedule_record(self, **overrides):
        defaults = {
            'title': 'Recurring title',
            'description': 'Recurring description',
            'assigned_by': self.admin_user,
            'assigned_to': self.staff_user,
            'priority': 'medium',
            'frequency': 'daily',
            'interval': 1,
            'weekdays': [],
            'times': ['09:00'],
            'timezone': 'UTC',
            'deadline_offset_minutes': 15,
            'start_at': timezone.now() - timedelta(days=1),
            'end_at': None,
            'next_run_at': timezone.now() - timedelta(minutes=5),
            'is_active': True,
            'is_paused': False,
            'paused_at': None,
            'paused_by': None,
            'ended_at': None,
            'ended_by': None,
        }
        defaults.update(overrides)
        return RecurringSchedule.objects.create(**defaults)

    def test_calculate_next_run_at_returns_expected_next_occurrence(self):
        reference = timezone.now().replace(hour=9, minute=30, second=0, microsecond=0)
        schedule = RecurringSchedule(
            title='Service schedule',
            description='Next occurrence calculation',
            assigned_by=self.admin_user,
            assigned_to=self.staff_user,
            priority='medium',
            frequency='daily',
            interval=1,
            weekdays=[],
            times=['10:00'],
            timezone='UTC',
            deadline_offset_minutes=0,
            start_at=reference - timedelta(days=1),
        )

        next_run_at = calculate_next_run_at(schedule, reference=reference)

        self.assertIsNotNone(next_run_at)
        self.assertEqual(next_run_at, reference.replace(hour=10, minute=0))

    def test_build_deadline_for_occurrence_adds_offset(self):
        from tasks.services import build_deadline_for_occurrence

        schedule = RecurringSchedule(deadline_offset_minutes=45)
        scheduled_for = timezone.now().replace(second=0, microsecond=0)

        deadline = build_deadline_for_occurrence(schedule, scheduled_for)

        self.assertEqual(deadline, scheduled_for + timedelta(minutes=45))

    def test_generate_recurring_task_occurrences_skips_paused_schedules(self):
        schedule = self.create_schedule_record(is_paused=True)

        result = generate_recurring_task_occurrences()

        self.assertEqual(result['processed_schedules'], 0)
        self.assertEqual(result['created_tasks'], 0)
        self.assertFalse(Task.objects.filter(recurrence_schedule=schedule).exists())
        self.assertFalse(RecurrenceOccurrence.objects.filter(schedule=schedule).exists())

    def test_generate_recurring_task_occurrences_creates_task_and_advances_cursor(self):
        schedule = self.create_schedule_record()
        scheduled_for = timezone.now() - timedelta(minutes=1)
        expected_next_run_at = timezone.now() + timedelta(hours=2)

        with patch('tasks.tasks.iter_schedule_occurrences', return_value=[scheduled_for]) as mock_occurrences:
            with patch('tasks.tasks.calculate_next_run_at', return_value=expected_next_run_at) as mock_next_run:
                result = generate_recurring_task_occurrences()

        self.assertEqual(result['processed_schedules'], 1)
        self.assertEqual(result['created_tasks'], 1)
        mock_occurrences.assert_called_once()
        mock_next_run.assert_called_once()

        schedule.refresh_from_db()
        self.assertEqual(schedule.next_run_at, expected_next_run_at)
        self.assertTrue(Task.objects.filter(recurrence_schedule=schedule).exists())
        occurrence = RecurrenceOccurrence.objects.get(schedule=schedule)
        self.assertIsNotNone(occurrence.created_task_id)

    def test_generate_recurring_task_occurrences_marks_schedule_inactive_when_no_future_runs(self):
        schedule = self.create_schedule_record()
        scheduled_for = timezone.now() - timedelta(minutes=1)

        with patch('tasks.tasks.iter_schedule_occurrences', return_value=[scheduled_for]):
            with patch('tasks.tasks.calculate_next_run_at', return_value=None):
                result = generate_recurring_task_occurrences()

        self.assertEqual(result['processed_schedules'], 1)
        self.assertEqual(result['created_tasks'], 1)
        schedule.refresh_from_db()
        self.assertFalse(schedule.is_active)
        self.assertIsNone(schedule.next_run_at)
        self.assertIsNotNone(schedule.ended_at)

    def test_generate_recurring_task_occurrences_keeps_ended_schedule_unprocessed(self):
        schedule = self.create_schedule_record(is_active=False, next_run_at=None, ended_at=timezone.now())

        result = generate_recurring_task_occurrences()

        self.assertEqual(result['processed_schedules'], 0)
        self.assertEqual(result['created_tasks'], 0)
        self.assertFalse(Task.objects.filter(recurrence_schedule=schedule).exists())
