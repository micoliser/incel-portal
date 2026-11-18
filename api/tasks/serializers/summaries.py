"""Weekly summaries, sharing, exports and the organization view."""

from datetime import datetime

from django.utils import timezone as django_timezone
from rest_framework import serializers

from ..models import (
    DailyReport,
    SummaryExport,
)
from ..services import calculate_user_files_received


class WeeklySummarySerializer(serializers.Serializer):
    """Serializer for weekly summary data - flattens summary_data fields"""
    id = serializers.UUIDField()
    week_start_date = serializers.DateField()
    week_end_date = serializers.DateField()
    # Include user information for shared views
    user_id = serializers.SerializerMethodField()
    user_name = serializers.SerializerMethodField()
    
    # Task metrics
    tasks_created = serializers.SerializerMethodField()
    tasks_assigned = serializers.SerializerMethodField()
    tasks_completed = serializers.SerializerMethodField()
    completion_rate_percent = serializers.SerializerMethodField()
    on_time_completion_rate_percent = serializers.SerializerMethodField()
    
    # High priority metrics
    high_priority_tasks = serializers.SerializerMethodField()
    high_priority_completed = serializers.SerializerMethodField()
    
    # Engagement metrics
    comments_added = serializers.SerializerMethodField()
    files_attached = serializers.SerializerMethodField()
    files_received = serializers.SerializerMethodField()
    daily_reports_created = serializers.SerializerMethodField()
    daily_reports_subreports_created = serializers.SerializerMethodField()
    daily_reports = serializers.SerializerMethodField()
    recurring_schedules_created = serializers.SerializerMethodField()
    active_recurring_schedules = serializers.SerializerMethodField()
    
    # Breakdowns
    priority_distribution = serializers.SerializerMethodField()
    status_distribution = serializers.SerializerMethodField()
    
    # Summary message
    summary_message = serializers.SerializerMethodField()
    
    def get_field_from_summary_data(self, obj, field_name):
        """Extract field from summary_data JSON"""
        summary_data = obj.summary_data or {}
        return summary_data.get(field_name)

    def get_user_id(self, obj):
        try:
            return obj.user.id
        except Exception:
            return None

    def get_user_name(self, obj):
        try:
            full = obj.user.get_full_name()
            if full:
                return full
            return obj.user.username
        except Exception:
            return None
    
    def get_tasks_created(self, obj):
        return self.get_field_from_summary_data(obj, 'tasks_created')
    
    def get_tasks_assigned(self, obj):
        return self.get_field_from_summary_data(obj, 'tasks_assigned')
    
    def get_tasks_completed(self, obj):
        return self.get_field_from_summary_data(obj, 'tasks_completed')
    
    def get_completion_rate_percent(self, obj):
        return self.get_field_from_summary_data(obj, 'completion_rate_percent')
    
    def get_on_time_completion_rate_percent(self, obj):
        return self.get_field_from_summary_data(obj, 'on_time_completion_rate_percent')
    
    def get_high_priority_tasks(self, obj):
        return self.get_field_from_summary_data(obj, 'high_priority_tasks')
    
    def get_high_priority_completed(self, obj):
        return self.get_field_from_summary_data(obj, 'high_priority_completed')
    
    def get_comments_added(self, obj):
        return self.get_field_from_summary_data(obj, 'comments_added')
    
    def get_files_attached(self, obj):
        return self.get_field_from_summary_data(obj, 'files_attached')

    def get_files_received(self, obj):
        stored_value = self.get_field_from_summary_data(obj, 'files_received')
        if stored_value is not None:
            return stored_value

        try:

            week_start_dt = django_timezone.make_aware(
                datetime.combine(obj.week_start_date, datetime.min.time())
            )
            week_end_dt = django_timezone.make_aware(
                datetime.combine(obj.week_end_date, datetime.max.time())
            )
            return calculate_user_files_received(obj.user, week_start_dt, week_end_dt)
        except Exception:
            return 0

    def get_daily_reports_created(self, obj):
        stored_value = self.get_field_from_summary_data(obj, 'daily_reports_created')
        if stored_value is not None:
            return stored_value

        daily_reports = self.get_daily_reports(obj)
        return len(daily_reports)

    def get_daily_reports_subreports_created(self, obj):
        stored_value = self.get_field_from_summary_data(obj, 'daily_reports_subreports_created')
        if stored_value is not None:
            return stored_value

        return sum(item.get('subreport_count', 0) for item in self.get_daily_reports(obj))

    def get_daily_reports(self, obj):
        stored_value = self.get_field_from_summary_data(obj, 'daily_reports')
        if stored_value:
            return stored_value

        try:

            daily_reports = (
                DailyReport.objects.filter(
                    user=obj.user,
                    report_date__gte=obj.week_start_date,
                    report_date__lte=obj.week_end_date,
                )
                .prefetch_related('subreports')
                .order_by('report_date')
            )

            return [
                {
                    'report_date': report.report_date,
                    'title': report.display_title,
                    'subreport_count': report.subreports.count(),
                    'view_url': f'/reports/daily/{report.id}',
                }
                for report in daily_reports
            ]
        except Exception:
            return []
    
    def get_recurring_schedules_created(self, obj):
        return self.get_field_from_summary_data(obj, 'recurring_schedules_created')
    
    def get_active_recurring_schedules(self, obj):
        return self.get_field_from_summary_data(obj, 'active_recurring_schedules')
    
    def get_priority_distribution(self, obj):
        return self.get_field_from_summary_data(obj, 'priority_distribution') or {}
    
    def get_status_distribution(self, obj):
        return self.get_field_from_summary_data(obj, 'status_distribution') or {}
    
    def get_summary_message(self, obj):
        return self.get_field_from_summary_data(obj, 'summary_message')


# Comparison, sharing, export and goal serializers


class WeeklySummaryComparisonSerializer(serializers.Serializer):
    """Serializer for week-over-week comparison data"""
    delta_tasks_completed = serializers.IntegerField()
    delta_completion_rate = serializers.FloatField()
    delta_on_time_completion_rate = serializers.FloatField()
    delta_high_priority_completed = serializers.IntegerField()
    delta_comments = serializers.IntegerField()
    delta_files = serializers.IntegerField()
    trend = serializers.CharField()
    velocity_change_percent = serializers.FloatField(required=False)
    previous_week_start = serializers.DateField(required=False)


class SummaryWithComparisonSerializer(WeeklySummarySerializer):
    """Extended serializer including comparison metrics"""
    comparison_metrics = serializers.SerializerMethodField()
    
    def get_comparison_metrics(self, obj):
        comparison = obj.comparison_metrics or {}
        if comparison:
            return {
                'delta_tasks_completed': comparison.get('delta_tasks_completed', 0),
                'delta_completion_rate': comparison.get('delta_completion_rate', 0),
                'delta_on_time_completion_rate': comparison.get('delta_on_time_completion_rate', 0),
                'delta_high_priority_completed': comparison.get('delta_high_priority_completed', 0),
                'delta_comments': comparison.get('delta_comments', 0),
                'delta_files': comparison.get('delta_files', 0),
                'trend': comparison.get('trend', 'flat'),
                'velocity_change_percent': comparison.get('velocity_change_percent'),
            }
        return None


class WeeklySummaryUserShareSerializer(serializers.Serializer):
    """A summary shared with one colleague. The link itself is never listed: it
    is sent to the colleague, and returned once when the share is created."""

    id = serializers.CharField(read_only=True)
    shared_with = serializers.IntegerField(source='shared_with.id', read_only=True)
    shared_with_username = serializers.CharField(source='shared_with.username', read_only=True)
    created_at = serializers.DateTimeField(read_only=True)


class SummaryUserShareCreateSerializer(serializers.Serializer):
    user_id = serializers.IntegerField(min_value=1)


class SummaryExportSerializer(serializers.ModelSerializer):
    """Serializer for summary exports"""
    class Meta:
        model = SummaryExport
        fields = ['id', 'format', 'file_url', 'created_at']
        read_only_fields = ['id', 'file_url', 'created_at']


class OrganizationSummarySerializer(serializers.Serializer):
    """Serializer for organization-wide summary"""
    week_start_date = serializers.DateField()
    week_end_date = serializers.DateField()
    total_active_users = serializers.IntegerField()
    total_tasks_completed = serializers.IntegerField()
    total_tasks_assigned = serializers.IntegerField()
    avg_completion_rate_percent = serializers.FloatField()
    avg_on_time_completion_rate_percent = serializers.FloatField()
    summaries_count = serializers.IntegerField()
    total_comments_added = serializers.IntegerField(required=False, default=0)
    total_files_attached = serializers.IntegerField(required=False, default=0)
    total_files_received = serializers.IntegerField(required=False, default=0)
    total_recurring_schedules_created = serializers.IntegerField(required=False, default=0)
    total_active_recurring_schedules = serializers.IntegerField(required=False, default=0)
    total_daily_reports_created = serializers.IntegerField(required=False, default=0)
    total_daily_reports_subreports_created = serializers.IntegerField(required=False, default=0)
    priority_distribution = serializers.DictField(required=False, default=dict)
    status_distribution = serializers.DictField(required=False, default=dict)
    comparison = serializers.DictField(required=False, allow_null=True, default=None)
