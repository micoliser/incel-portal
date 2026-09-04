"""
Comprehensive tests for Phase 2 features
"""
import json
from datetime import datetime, timedelta, date
from unittest.mock import MagicMock, patch
from django.conf import settings
from django.test import TestCase
from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status

from tasks.models import (
    Task, TaskActivity, TaskAttachment, WeeklySummary, WeeklySummaryShare,
    WeeklySummaryUserShare, SummaryExport, UserGoal,
    OrganizationSummaryCache
)
from tasks.services import (
    calculate_weekly_comparison, calculate_organization_summary, check_user_goals
)
from tasks.tasks import cache_organization_summaries


class BaseAPITestCase(TestCase):
    """Base test case with common setup"""
    
    def setUp(self):
        """Set up test users and client"""
        self.client = APIClient()
        self.user1 = User.objects.create_user(
            username='user1',
            email='user1@test.com',
            password='testpass123',
            first_name='John',
            last_name='Doe'
        )
        self.user2 = User.objects.create_user(
            username='user2',
            email='user2@test.com',
            password='testpass123'
        )
        self.admin_user = User.objects.create_user(
            username='admin',
            email='admin@test.com',
            password='testpass123',
            is_superuser=True
        )
        
        # Create tasks for testing
        self.task1 = Task.objects.create(
            title='Test Task 1',
            assigned_by=self.user1,
            assigned_to=self.user2,
            status='completed',
            priority='high',
            completed_at=timezone.now()
        )
    
    def build_summary_data(self, **overrides):
        """Helper to create test summary data"""
        week_start = date(2024, 5, 13)  # Monday
        week_end = date(2024, 5, 19)    # Sunday
        
        summary_data = {
            'week_start_date': str(week_start),
            'week_end_date': str(week_end),
            'user_id': str(self.user1.id),
            'user_name': self.user1.get_full_name(),
            'tasks_created': 5,
            'tasks_assigned': 10,
            'tasks_completed': 8,
            'completion_rate_percent': 80.0,
            'on_time_completion_rate_percent': 75.0,
            'high_priority_tasks': 3,
            'high_priority_completed': 2,
            'comments_added': 12,
            'files_attached': 5,
            'recurring_schedules_created': 1,
            'active_recurring_schedules': 2,
            'priority_distribution': {'low': 3, 'medium': 4, 'high': 3},
            'status_distribution': {'pending': 2, 'in_progress': 0, 'completed': 8},
            'summary_message': 'Test summary message',
        }
        
        summary_data.update(overrides)
        return summary_data


class Phase2ComparisonTests(BaseAPITestCase):
    """Tests for week-over-week comparison functionality"""
    
    def test_calculate_weekly_comparison_with_previous_week(self):
        """Test that comparison deltas are calculated correctly"""
        previous_summary = {
            'tasks_completed': 6,
            'completion_rate_percent': 60.0,
            'on_time_completion_rate_percent': 50.0,
            'high_priority_completed': 1,
            'comments_added': 10,
            'files_attached': 3,
        }
        
        current_summary = {
            'tasks_completed': 8,
            'completion_rate_percent': 80.0,
            'on_time_completion_rate_percent': 75.0,
            'high_priority_completed': 2,
            'comments_added': 12,
            'files_attached': 5,
        }
        
        comparison = calculate_weekly_comparison(current_summary, previous_summary)
        
        self.assertEqual(comparison['delta_tasks_completed'], 2)
        self.assertEqual(comparison['delta_completion_rate'], 20.0)
        self.assertEqual(comparison['delta_on_time_completion_rate'], 25.0)
        self.assertEqual(comparison['delta_high_priority_completed'], 1)
        self.assertEqual(comparison['delta_comments'], 2)
        self.assertEqual(comparison['delta_files'], 2)
        self.assertEqual(comparison['trend'], 'up')
    
    def test_calculate_weekly_comparison_without_previous_week(self):
        """Test that comparison returns empty when no previous week"""
        current_summary = {'tasks_completed': 8}
        comparison = calculate_weekly_comparison(current_summary, None)
        self.assertEqual(comparison, {})
    
    def test_comparison_trend_calculation(self):
        """Test trend indicator is correctly set"""
        previous = {'completion_rate_percent': 70.0}
        
        # Up trend
        current_up = {'completion_rate_percent': 75.0}
        comparison_up = calculate_weekly_comparison(current_up, previous)
        self.assertEqual(comparison_up['trend'], 'up')
        
        # Down trend
        current_down = {'completion_rate_percent': 65.0}
        comparison_down = calculate_weekly_comparison(current_down, previous)
        self.assertEqual(comparison_down['trend'], 'down')
        
        # Flat trend
        current_flat = {'completion_rate_percent': 71.0}
        comparison_flat = calculate_weekly_comparison(current_flat, previous)
        self.assertEqual(comparison_flat['trend'], 'flat')


class Phase2UserSharingTests(BaseAPITestCase):
    """Tests for user-to-user summary sharing"""
    
    def test_share_summary_with_user(self):
        """Test sharing a summary with another user"""
        week_start = date(2024, 5, 13)
        summary_data = self.build_summary_data()
        
        summary = WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=summary_data
        )
        
        self.client.force_authenticate(user=self.user1)
        response = self.client.post(
            '/api/v1/summaries/share-with-user/',
            {
                'week_start_date': str(week_start),
                'user_id': self.user2.id
            }
        )
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        share = WeeklySummaryUserShare.objects.get(
            summary=summary,
            shared_with=self.user2
        )
        self.assertEqual(share.shared_by, self.user1)
    
    def test_cannot_share_nonexistent_summary(self):
        """Test sharing non-existent summary returns error"""
        self.client.force_authenticate(user=self.user1)
        response = self.client.post(
            '/api/v1/summaries/share-with-user/',
            {
                'week_start_date': '2020-01-01',
                'user_id': self.user2.id
            }
        )
        
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
    
    def test_cannot_share_with_nonexistent_user(self):
        """Test sharing with non-existent user returns error"""
        week_start = date(2024, 5, 13)
        summary_data = self.build_summary_data()
        
        WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=summary_data
        )
        
        self.client.force_authenticate(user=self.user1)
        response = self.client.post(
            '/api/v1/summaries/share-with-user/',
            {
                'week_start_date': str(week_start),
                'user_id': 99999
            }
        )
        
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class Phase2ExportTests(BaseAPITestCase):
    """Tests for summary export (PDF)"""
    
    def test_export_summary_as_pdf(self):
        """Test exporting summary as PDF"""
        week_start = date(2024, 5, 13)
        summary_data = self.build_summary_data()
        
        summary = WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=summary_data
        )
        
        self.client.force_authenticate(user=self.user1)
        fake_s3_client = MagicMock()
        fake_s3_client.put_object.return_value = {}
        fake_s3_client.generate_presigned_url.return_value = 'https://example.com/export.pdf'

        with patch('tasks.export_storage._s3_client', return_value=fake_s3_client):
            response = self.client.post(
                '/api/v1/summaries/export/',
                {
                    'week_start_date': str(week_start),
                    'format': 'pdf'
                }
            )
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['format'], 'pdf')
        self.assertIn('file_url', response.data)
        fake_s3_client.put_object.assert_called_once()
        expected_prefix = (
            f"{getattr(settings, 'SUMMARY_PDF_EXPORT_S3_PREFIX', 'pdf-exports').strip() or 'pdf-exports'}/summaries/"
        )
        self.assertIn(
            expected_prefix,
            fake_s3_client.put_object.call_args.kwargs['Key'],
        )
        
        export = SummaryExport.objects.get(summary=summary)
        self.assertEqual(export.exported_by, self.user1)


class Phase2GoalTests(BaseAPITestCase):
    """Tests for goal tracking and progress"""
    
    def test_create_user_goal(self):
        """Test creating a user goal for the current week"""
        self.client.force_authenticate(user=self.user1)
        week_start = date(2024, 5, 13)
        
        response = self.client.post(
            '/api/v1/goals/',
            {
                'metric': 'files_attached',
                'target_value': 85.0,
                'week_start_date': str(week_start),
            }
        )
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        goal = UserGoal.objects.get(user=self.user1)
        self.assertEqual(goal.metric, 'files_attached')
        self.assertEqual(goal.target_value, 85.0)
        self.assertEqual(goal.period_start, week_start)
        self.assertEqual(goal.period_end, week_start + timedelta(days=6))
    
    def test_list_user_goals(self):
        """Test listing goals for a specific week"""
        week_start = date(2024, 5, 13)
        WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=self.build_summary_data(),
        )
        goal = UserGoal.objects.create(
            user=self.user1,
            metric='files_attached',
            target_value=85.0,
            period_start=week_start,
            period_end=week_start + timedelta(days=6),
        )
        
        self.client.force_authenticate(user=self.user1)
        response = self.client.get(
            '/api/v1/goals/',
            {'week_start_date': str(week_start)}
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['week_start_date'], str(week_start))
        self.assertEqual(len(response.data['goals']), 1)
        self.assertEqual(response.data['goals'][0]['metric'], 'files_attached')
        self.assertIn('progress', response.data['goals'][0])
    
    def test_check_goal_progress(self):
        """Test checking progress against goals"""
        week_start = date(2024, 5, 13)
        goal = UserGoal.objects.create(
            user=self.user1,
            metric='tasks_completed',
            target_value=10.0,
            period_start=week_start,
            period_end=week_start + timedelta(days=6),
        )
        
        summary_data = self.build_summary_data(tasks_completed=8)
        
        summary = WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=summary_data
        )
        
        goal_results = check_user_goals(
            self.user1,
            week_start,
            summary.week_end_date,
            summary_data
        )
        
        # Should not achieve goal (8 < 10)
        self.assertFalse(goal_results['tasks_completed']['achieved'])
        self.assertEqual(goal_results['tasks_completed']['current'], 8)
        self.assertEqual(goal_results['tasks_completed']['target'], 10.0)

    def test_delete_user_goal_not_allowed(self):
        """Test goals cannot be deleted once created"""
        week_start = date(2024, 5, 13)
        goal = UserGoal.objects.create(
            user=self.user1,
            metric='comments_added',
            target_value=5.0,
            period_start=week_start,
            period_end=week_start + timedelta(days=6),
        )

        self.client.force_authenticate(user=self.user1)
        response = self.client.delete(f'/api/v1/goals/{goal.id}/')

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        goal.refresh_from_db()
        self.assertTrue(goal.is_active)


class Phase2OrganizationTests(BaseAPITestCase):
    """Tests for organization-wide summaries"""
    
    def test_organization_summary_requires_admin(self):
        """Test organization summary endpoint requires admin access"""
        self.client.force_authenticate(user=self.user1)
        response = self.client.get(
            reverse('weekly-summary-organization-summary'),
            {'week_start_date': '2024-05-13'}
        )
        
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
    
    def test_admin_can_view_organization_summary(self):
        """Test admin can view organization summary"""
        week_start = date(2024, 5, 13)
        summary_data = self.build_summary_data()
        
        WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=summary_data
        )
        
        WeeklySummary.objects.create(
            user=self.user2,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=self.build_summary_data(
                tasks_completed=6,
                completion_rate_percent=60.0
            )
        )
        
        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get(
            reverse('weekly-summary-organization-summary'),
            {'week_start_date': str(week_start)}
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total_active_users'], 2)
        self.assertEqual(response.data['total_tasks_completed'], 14)

    def test_cache_organization_summaries_caches_all_available_weeks(self):
        """Test cache task stores one org summary per available week."""
        week_start = date(2024, 5, 13)
        previous_week_start = week_start - timedelta(days=7)

        WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=self.build_summary_data(tasks_completed=8)
        )
        WeeklySummary.objects.create(
            user=self.user2,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=self.build_summary_data(tasks_completed=6)
        )
        WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=previous_week_start,
            week_end_date=previous_week_start + timedelta(days=6),
            summary_data=self.build_summary_data(tasks_completed=4)
        )

        result = cache_organization_summaries()

        self.assertEqual(result['cached'], 2)
        self.assertEqual(result['errors'], 0)
        self.assertEqual(OrganizationSummaryCache.objects.count(), 2)

        current_cache = OrganizationSummaryCache.objects.get(
            week_start_date=week_start
        )
        previous_cache = OrganizationSummaryCache.objects.get(
            week_start_date=previous_week_start
        )

        self.assertEqual(current_cache.week_end_date, week_start + timedelta(days=6))
        self.assertEqual(current_cache.summary_data['total_active_users'], 2)
        self.assertEqual(current_cache.summary_data['total_tasks_completed'], 14)
        self.assertEqual(previous_cache.summary_data['total_active_users'], 1)
        self.assertEqual(previous_cache.summary_data['total_tasks_completed'], 4)

    def test_cache_organization_summaries_updates_existing_cache_row(self):
        """Test cache task updates stale cache data instead of creating duplicates."""
        week_start = date(2024, 5, 13)

        WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=self.build_summary_data(tasks_completed=8)
        )
        OrganizationSummaryCache.objects.create(
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data={'total_tasks_completed': 999}
        )

        result = cache_organization_summaries()

        self.assertEqual(result['cached'], 1)
        self.assertEqual(result['errors'], 0)
        self.assertEqual(OrganizationSummaryCache.objects.count(), 1)

        cache_row = OrganizationSummaryCache.objects.get(week_start_date=week_start)
        self.assertEqual(cache_row.summary_data['total_tasks_completed'], 8)
        self.assertEqual(cache_row.summary_data['total_active_users'], 1)

    def test_organization_summary_uses_cached_data_when_available(self):
        """Test endpoint returns cached data before live aggregation."""
        week_start = date(2024, 5, 13)
        cached_data = {
            'week_start_date': str(week_start),
            'week_end_date': str(week_start + timedelta(days=6)),
            'total_active_users': 7,
            'total_tasks_completed': 77,
            'total_tasks_assigned': 88,
            'avg_completion_rate_percent': 90.0,
            'avg_on_time_completion_rate_percent': 85.0,
            'summaries_count': 7,
            'total_comments_added': 21,
            'total_files_attached': 14,
            'total_files_received': 7,
            'total_recurring_schedules_created': 3,
            'total_active_recurring_schedules': 2,
            'total_daily_reports_created': 5,
            'total_daily_reports_subreports_created': 10,
            'priority_distribution': {'high': 21},
            'status_distribution': {'completed': 77},
            'comparison': None,
        }

        OrganizationSummaryCache.objects.create(
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=cached_data
        )

        self.client.force_authenticate(user=self.admin_user)
        with patch('tasks.services.calculate_organization_summary') as mock_calculate:
            mock_calculate.side_effect = AssertionError('live calculation should not run')
            response = self.client.get(
                reverse('weekly-summary-organization-summary'),
                {'week_start_date': str(week_start)}
            )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        mock_calculate.assert_not_called()
        self.assertEqual(response.data['total_active_users'], 7)
        self.assertEqual(response.data['total_tasks_completed'], 77)
        self.assertEqual(response.data['priority_distribution'], {'high': 21})

    def test_organization_summary_falls_back_to_live_calculation_when_cache_missing(self):
        """Test endpoint calculates live data when no cache row exists."""
        week_start = date(2024, 5, 13)

        WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=self.build_summary_data(tasks_completed=8)
        )
        WeeklySummary.objects.create(
            user=self.user2,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=self.build_summary_data(tasks_completed=6)
        )

        self.client.force_authenticate(user=self.admin_user)
        response = self.client.get(
            reverse('weekly-summary-organization-summary'),
            {'week_start_date': str(week_start)}
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total_active_users'], 2)
        self.assertEqual(response.data['total_tasks_completed'], 14)
        self.assertEqual(OrganizationSummaryCache.objects.count(), 0)

    def test_cache_organization_summaries_returns_error_count(self):
        """Test cache task reports successes and errors separately."""
        week_start = date(2024, 5, 13)
        previous_week_start = week_start - timedelta(days=7)

        WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=self.build_summary_data(tasks_completed=8)
        )
        WeeklySummary.objects.create(
            user=self.user2,
            week_start_date=previous_week_start,
            week_end_date=previous_week_start + timedelta(days=6),
            summary_data=self.build_summary_data(tasks_completed=6)
        )

        with patch(
            'tasks.services.calculate_organization_summary',
            side_effect=Exception('boom')
        ):
            result = cache_organization_summaries()

        self.assertEqual(result['cached'], 0)
        self.assertEqual(result['errors'], 2)
        self.assertEqual(OrganizationSummaryCache.objects.count(), 0)


class Phase2ComparisonMetricsTest(BaseAPITestCase):
    """Tests for comparison metrics in summaries"""
    
    def test_summary_with_comparison_data(self):
        """Test that summary includes comparison metrics"""
        week_start = date(2024, 5, 13)
        previous_week_start = week_start - timedelta(days=7)
        
        previous_summary = WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=previous_week_start,
            week_end_date=previous_week_start + timedelta(days=6),
            summary_data=self.build_summary_data(
                tasks_completed=6,
                completion_rate_percent=60.0
            )
        )
        
        current_summary_data = self.build_summary_data(
            tasks_completed=8,
            completion_rate_percent=80.0
        )
        
        comparison = {
            'delta_tasks_completed': 2,
            'delta_completion_rate': 20.0,
            'delta_on_time_completion_rate': 25.0,
            'delta_high_priority_completed': 1,
            'delta_comments': 2,
            'delta_files': 2,
            'trend': 'up',
            'velocity_change_percent': 33.3,
        }
        
        current_summary = WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=current_summary_data,
            previous_week_summary=previous_summary,
            comparison_metrics=comparison
        )
        
        self.assertEqual(current_summary.comparison_metrics['trend'], 'up')
        self.assertEqual(current_summary.previous_week_summary, previous_summary)


class Phase2PublicShareTests(BaseAPITestCase):
    """Tests for public sharing (create/revoke/status/shared view)"""

    def test_create_public_share_and_shared_view_and_status(self):
        week_start = date(2024, 5, 13)
        summary_data = self.build_summary_data()

        summary = WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=summary_data
        )

        self.client.force_authenticate(user=self.user1)
        response = self.client.post(
            '/api/v1/summaries/share/',
            {'week_start_date': str(week_start)}
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        share_token = response.data.get('share_token')
        self.assertTrue(share_token)

        # share_status should report shared
        status_resp = self.client.get(f'/api/v1/summaries/share-status/?week_start_date={week_start}')
        self.assertEqual(status_resp.status_code, status.HTTP_200_OK)
        self.assertTrue(status_resp.data.get('shared'))

        # Shared view requires authentication in this app
        self.client.force_authenticate(user=self.user1)
        shared_resp = self.client.get(f'/api/v1/summaries/shared/?token={share_token}')
        self.assertEqual(shared_resp.status_code, status.HTTP_200_OK)
        self.assertIn('summary', shared_resp.data)
        self.assertIn('historical', shared_resp.data)

        # Revoke the public share
        self.client.force_authenticate(user=self.user1)
        revoke_resp = self.client.post('/api/v1/summaries/revoke_share/', {'week_start_date': str(week_start)})
        self.assertEqual(revoke_resp.status_code, status.HTTP_200_OK)
        self.assertTrue(revoke_resp.data.get('revoked'))

        # Now share_status should report not shared
        status_resp2 = self.client.get(f'/api/v1/summaries/share-status/?week_start_date={week_start}')
        self.assertEqual(status_resp2.status_code, status.HTTP_200_OK)
        self.assertFalse(status_resp2.data.get('shared'))


class Phase2UserScopedShareTests(BaseAPITestCase):
    """Tests for user-scoped share tokens and access control"""

    def test_user_scoped_shared_access_control(self):
        week_start = date(2024, 5, 13)
        summary = WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=self.build_summary_data()
        )

        share_token = 'user-token-abc'
        WeeklySummaryUserShare.objects.create(
            summary=summary,
            shared_by=self.user1,
            shared_with=self.user2,
            share_token=share_token
        )

        # Unauthenticated should be rejected by auth middleware
        self.client.force_authenticate(user=None)
        resp = self.client.get(f'/api/v1/summaries/shared/?token={share_token}')
        self.assertEqual(resp.status_code, status.HTTP_401_UNAUTHORIZED)

        # Wrong authenticated user should be forbidden
        self.client.force_authenticate(user=self.admin_user)
        resp2 = self.client.get(f'/api/v1/summaries/shared/?token={share_token}')
        self.assertEqual(resp2.status_code, status.HTTP_403_FORBIDDEN)

        # Intended recipient can view
        self.client.force_authenticate(user=self.user2)
        resp3 = self.client.get(f'/api/v1/summaries/shared/?token={share_token}')
        self.assertEqual(resp3.status_code, status.HTTP_200_OK)
        self.assertIn('summary', resp3.data)


class Phase2FilesTests(BaseAPITestCase):
    """Tests for files listing within a summary and token-based access"""

    def test_files_list_permissions_and_token(self):
        week_start = date(2024, 5, 13)
        summary = WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=self.build_summary_data()
        )

        # Create a task, activity and attachment within the week
        task = Task.objects.create(
            title='File Task',
            assigned_by=self.user1,
            assigned_to=self.user2,
            status='pending',
            priority='medium'
        )

        activity = TaskActivity.objects.create(
            task=task,
            user=self.user1,
            activity_type='comment',
            comment='Adding a file'
        )
        TaskActivity.objects.filter(id=activity.id).update(
            created_at=timezone.make_aware(datetime(2024, 5, 13, 10, 0, 0))
        )

        TaskAttachment.objects.create(
            activity=activity,
            object_key='obj-key-1',
            file_name='notes.txt',
            content_type='text/plain',
            size=123
        )

        # Add an attachment from another user so "received" (for summary owner)
        # has data when accessed via token by a shared recipient.
        activity_other = TaskActivity.objects.create(
            task=task,
            user=self.user2,
            activity_type='comment',
            comment='Adding a received file'
        )
        TaskActivity.objects.filter(id=activity_other.id).update(
            created_at=timezone.make_aware(datetime(2024, 5, 14, 11, 0, 0))
        )

        TaskAttachment.objects.create(
            activity=activity_other,
            object_key='obj-key-2',
            file_name='received.txt',
            content_type='text/plain',
            size=456
        )

        # Owner can list files
        self.client.force_authenticate(user=self.user1)
        owner_resp = self.client.get(f'/api/v1/summaries/{summary.id}/files/?view=sent')
        self.assertEqual(owner_resp.status_code, status.HTTP_200_OK)
        self.assertIn('tasks', owner_resp.data)

        # Other user without token is forbidden
        self.client.force_authenticate(user=self.user2)
        other_resp = self.client.get(f'/api/v1/summaries/{summary.id}/files/?view=sent')
        self.assertEqual(other_resp.status_code, status.HTTP_403_FORBIDDEN)

        # Give user2 a user-scoped share token and access with token param
        token = 'files-access-token'
        WeeklySummaryUserShare.objects.create(
            summary=summary,
            shared_by=self.user1,
            shared_with=self.user2,
            share_token=token
        )

        token_resp = self.client.get(f'/api/v1/summaries/{summary.id}/files/?view=received&token={token}')
        self.assertEqual(token_resp.status_code, status.HTTP_200_OK)
        self.assertTrue(len(token_resp.data.get('tasks', [])) >= 1)


class Phase2RevokeUserShareTests(BaseAPITestCase):
    """Tests for revoking user-scoped shares"""

    def test_revoke_user_share(self):
        week_start = date(2024, 5, 13)
        summary = WeeklySummary.objects.create(
            user=self.user1,
            week_start_date=week_start,
            week_end_date=week_start + timedelta(days=6),
            summary_data=self.build_summary_data()
        )

        WeeklySummaryUserShare.objects.create(
            summary=summary,
            shared_by=self.user1,
            shared_with=self.user2,
            share_token='revoke-token'
        )

        self.client.force_authenticate(user=self.user1)
        resp = self.client.post('/api/v1/summaries/revoke-user-share/', {'week_start_date': str(week_start), 'user_id': self.user2.id})
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(resp.data.get('revoked'))
