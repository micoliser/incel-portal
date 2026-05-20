"""
Comprehensive tests for Phase 2 features
"""
import json
from datetime import datetime, timedelta, date
from django.test import TestCase
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework import status

from tasks.models import (
    Task, WeeklySummary, WeeklySummaryUserShare, SummaryExport, UserGoal,
    OrganizationSummaryCache
)
from tasks.services import (
    calculate_weekly_comparison, calculate_organization_summary, check_user_goals
)


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
            is_staff=True
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
            '/api/tasks/summaries/share-with-user/',
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
            '/api/tasks/summaries/share-with-user/',
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
            '/api/tasks/summaries/share-with-user/',
            {
                'week_start_date': str(week_start),
                'user_id': 99999
            }
        )
        
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)


class Phase2ExportTests(BaseAPITestCase):
    """Tests for summary export (PDF and CSV)"""
    
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
        response = self.client.post(
            '/api/tasks/summaries/export/',
            {
                'week_start_date': str(week_start),
                'format': 'pdf'
            }
        )
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['format'], 'pdf')
        self.assertIn('file_url', response.data)
        
        export = SummaryExport.objects.get(summary=summary)
        self.assertEqual(export.exported_by, self.user1)
    
    def test_export_summary_as_csv(self):
        """Test exporting summary as CSV"""
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
            '/api/tasks/summaries/export/',
            {
                'week_start_date': str(week_start),
                'format': 'csv'
            }
        )
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data['format'], 'csv')


class Phase2GoalTests(BaseAPITestCase):
    """Tests for goal tracking and progress"""
    
    def test_create_user_goal(self):
        """Test creating a user goal"""
        self.client.force_authenticate(user=self.user1)
        
        response = self.client.post(
            '/api/tasks/summaries/goals/',
            {
                'metric': 'completion_rate',
                'target_value': 85.0,
                'period_start': '2024-05-01',
                'period_end': '2024-05-31',
            }
        )
        
        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        goal = UserGoal.objects.get(user=self.user1)
        self.assertEqual(goal.metric, 'completion_rate')
        self.assertEqual(goal.target_value, 85.0)
    
    def test_list_user_goals(self):
        """Test listing user's active goals"""
        goal = UserGoal.objects.create(
            user=self.user1,
            metric='completion_rate',
            target_value=85.0,
            period_start=date(2024, 5, 1),
            period_end=date(2024, 5, 31),
        )
        
        self.client.force_authenticate(user=self.user1)
        response = self.client.get('/api/tasks/summaries/goals/')
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['metric'], 'completion_rate')
    
    def test_check_goal_progress(self):
        """Test checking progress against goals"""
        goal = UserGoal.objects.create(
            user=self.user1,
            metric='tasks_completed',
            target_value=10.0,
            period_start=date(2024, 5, 13),
            period_end=date(2024, 5, 19),
        )
        
        week_start = date(2024, 5, 13)
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


class Phase2OrganizationTests(BaseAPITestCase):
    """Tests for organization-wide summaries"""
    
    def test_organization_summary_requires_admin(self):
        """Test organization summary endpoint requires admin access"""
        self.client.force_authenticate(user=self.user1)
        response = self.client.get(
            '/api/tasks/summaries/organization-summary/',
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
            '/api/tasks/summaries/organization-summary/',
            {'week_start_date': str(week_start)}
        )
        
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['total_active_users'], 2)
        self.assertEqual(response.data['total_tasks_completed'], 14)


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
