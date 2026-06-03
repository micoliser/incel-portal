import os
from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.conf import settings
from django.contrib.auth.models import User
from django.utils import timezone
from rest_framework import serializers

from .models import (
    DailyReport,
    DailyReportComment,
    DailyReportSubreport,
    RecurringSchedule,
    Task,
    TaskActivity,
    TaskAttachment,
    WeeklySummary,
    WeeklySummaryUserShare,
    SummaryExport,
    UserGoal,
)
from .s3 import TaskAttachmentStorageError, generate_task_attachment_download_url


def _allowed_attachment_content_types() -> set[str]:
    values = getattr(settings, 'TASK_ATTACHMENT_ALLOWED_CONTENT_TYPES', [])
    return {str(value).strip() for value in values if str(value).strip()}


def _max_attachment_size() -> int:
    return int(getattr(settings, 'TASK_ATTACHMENT_MAX_SIZE', 10 * 1024 * 1024))


def _normalize_file_name(file_name: str) -> str:
    normalized = os.path.basename(str(file_name).replace('\\', '/')).strip()
    if not normalized:
        raise serializers.ValidationError('file_name is required.')
    if len(normalized) > 255:
        raise serializers.ValidationError('file_name must be 255 characters or fewer.')
    return normalized


def _validate_attachment_content_type(content_type: str) -> str:
    normalized = str(content_type).strip()
    if not normalized:
        raise serializers.ValidationError('content_type is required.')

    allowed_types = _allowed_attachment_content_types()
    if allowed_types and normalized not in allowed_types:
        raise serializers.ValidationError('Unsupported attachment content type.')

    return normalized


def _validate_attachment_size(size: int) -> int:
    max_size = _max_attachment_size()
    if size <= 0:
        raise serializers.ValidationError('size must be greater than zero.')
    if size > max_size:
        raise serializers.ValidationError(f'Attachment size must be {max_size} bytes or smaller.')
    return size


class TaskAttachmentUploadRequestSerializer(serializers.Serializer):
    file_name = serializers.CharField(max_length=255)
    content_type = serializers.CharField(max_length=255)
    size = serializers.IntegerField(min_value=1)

    def validate_file_name(self, value):
        return _normalize_file_name(value)

    def validate_content_type(self, value):
        return _validate_attachment_content_type(value)

    def validate_size(self, value):
        return _validate_attachment_size(value)


class TaskCommentCreateSerializer(serializers.Serializer):
    comment = serializers.CharField(allow_blank=True, trim_whitespace=True)
    attachments = serializers.ListField(child=serializers.DictField(), required=False)

    def validate_comment(self, value):
        comment = value.strip()
        if not comment:
            raise serializers.ValidationError('Comment cannot be empty.')
        if len(comment) > 200:
            raise serializers.ValidationError('Comment cannot exceed 200 characters.')
        return comment

    def validate(self, attrs):
        # Backwards compatibility: accept single-file legacy fields and normalize
        # Note: legacy fields may appear in initial_data but not in attrs (since not defined fields),
        # so check self.initial_data as well.
        if 'attachments' not in attrs:
            init = getattr(self, 'initial_data', {}) or {}
            if 'attachments' not in init and any(k in init for k in ('attachment_object_key', 'attachment_file_name', 'attachment_content_type', 'attachment_size')):
                single = {
                    'object_key': init.get('attachment_object_key'),
                    'file_name': init.get('attachment_file_name'),
                    'content_type': init.get('attachment_content_type'),
                    'size': init.get('attachment_size'),
                }
                attrs['attachments'] = [single]

        # Validate attachments list (if provided)
        attachments = attrs.get('attachments')
        if attachments is None:
            return attrs

        if not isinstance(attachments, list):
            raise serializers.ValidationError({'attachments': 'Attachments must be a list.'})

        max_files = int(getattr(settings, 'TASK_ATTACHMENT_MAX_FILES', 10))
        if len(attachments) > max_files:
            raise serializers.ValidationError({'attachments': f'Maximum {max_files} attachments allowed.'})

        validated = []
        for idx, item in enumerate(attachments):
            if not isinstance(item, dict):
                raise serializers.ValidationError({'attachments': f'Attachment at index {idx} must be an object.'})

            required_keys = ('object_key', 'file_name', 'content_type', 'size')
            missing = [k for k in required_keys if item.get(k) in (None, '')]
            if missing:
                raise serializers.ValidationError({'attachments': f'Attachment at index {idx} missing fields: {", ".join(missing)}'})

            # validate file_name, content_type, size via upload serializer
            attachment_serializer = TaskAttachmentUploadRequestSerializer(
                data={
                    'file_name': item['file_name'],
                    'content_type': item['content_type'],
                    'size': item['size'],
                }
            )
            attachment_serializer.is_valid(raise_exception=True)

            validated.append({
                'object_key': item['object_key'],
                'file_name': attachment_serializer.validated_data['file_name'],
                'content_type': attachment_serializer.validated_data['content_type'],
                'size': attachment_serializer.validated_data['size'],
            })

        attrs['attachments'] = validated

        return attrs


class UserSimpleSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(read_only=True)
    full_name = serializers.CharField(source='get_full_name', read_only=True)

    class Meta:
        model = User
        fields = ['id', 'username', 'full_name', 'email']


class TaskActivitySerializer(serializers.ModelSerializer):
    user = UserSimpleSerializer(read_only=True)
    attachments = serializers.SerializerMethodField()

    class Meta:
        model = TaskActivity
        fields = [
            'id',
            'task',
            'user',
            'activity_type',
            'old_value',
            'new_value',
            'comment',
            'attachments',
            'created_at',
        ]
        read_only_fields = ['user', 'created_at', 'task', 'attachments']

    def get_attachments(self, obj):
        return TaskAttachmentSerializer(obj.attachments.all(), many=True).data


class TaskAttachmentSerializer(serializers.ModelSerializer):
    download_url = serializers.SerializerMethodField()

    class Meta:
        model = TaskAttachment
        fields = [
            'id',
            'file_name',
            'content_type',
            'size',
            'download_url',
            'created_at',
        ]
        read_only_fields = fields

    def get_download_url(self, obj):
        try:
            payload = generate_task_attachment_download_url(
                object_key=obj.object_key,
                file_name=obj.file_name,
                content_type=obj.content_type,
            )
        except TaskAttachmentStorageError:
            return None

        return payload['download_url']


class RecurringScheduleSerializer(serializers.ModelSerializer):
    assigned_by = UserSimpleSerializer(read_only=True)
    assigned_to = UserSimpleSerializer(read_only=True)
    assigned_to_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(),
        write_only=True,
        source='assigned_to',
    )
    paused_by = UserSimpleSerializer(read_only=True)
    ended_by = UserSimpleSerializer(read_only=True)
    weekdays = serializers.ListField(
        child=serializers.IntegerField(min_value=0, max_value=6),
        required=False,
        allow_empty=True,
    )
    times = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        allow_empty=False,
    )
    deadline_offset_minutes = serializers.IntegerField(required=False, min_value=0, default=0)

    class Meta:
        model = RecurringSchedule
        fields = [
            'id',
            'title',
            'description',
            'assigned_by',
            'assigned_to',
            'assigned_to_id',
            'priority',
            'frequency',
            'interval',
            'weekdays',
            'times',
            'timezone',
            'deadline_offset_minutes',
            'start_at',
            'end_at',
            'next_run_at',
            'is_active',
            'is_paused',
            'paused_at',
            'paused_by',
            'ended_at',
            'ended_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = [
            'id',
            'assigned_by',
            'assigned_to',
            'next_run_at',
            'is_active',
            'is_paused',
            'paused_at',
            'paused_by',
            'ended_at',
            'ended_by',
            'created_at',
            'updated_at',
        ]

    def validate_assigned_to_id(self, value):
        if self.instance and value != self.instance.assigned_to:
            raise serializers.ValidationError(
                'The assignee cannot be changed for an existing recurring schedule.'
            )
        return value

    def validate_timezone(self, value):
        timezone_name = str(value).strip() or 'UTC'
        try:
            ZoneInfo(timezone_name)
        except ZoneInfoNotFoundError as exc:
            raise serializers.ValidationError('Timezone is invalid.') from exc
        return timezone_name

    def validate_times(self, value):
        normalized: list[str] = []
        seen: set[str] = set()
        for raw_time in value:
            time_value = str(raw_time).strip()
            try:
                parsed = datetime.strptime(time_value, '%H:%M')
            except ValueError as exc:
                raise serializers.ValidationError('Times must use HH:MM format.') from exc

            normalized_time = parsed.strftime('%H:%M')
            if normalized_time in seen:
                continue
            seen.add(normalized_time)
            normalized.append(normalized_time)

        if not normalized:
            raise serializers.ValidationError('At least one time is required.')

        return normalized

    def validate_weekdays(self, value):
        normalized: list[int] = []
        seen: set[int] = set()
        for raw_day in value:
            weekday = int(raw_day)
            if weekday in seen:
                continue
            seen.add(weekday)
            normalized.append(weekday)
        return normalized

    def validate(self, attrs):
        request = self.context.get('request')
        current_user = getattr(request, 'user', None)
        assigned_to = attrs.get('assigned_to')

        if current_user and assigned_to == current_user:
            raise serializers.ValidationError(
                {'assigned_to_id': 'You cannot assign a recurring task to yourself.'}
            )

        if attrs.get('frequency') == 'weekly' and not attrs.get('weekdays'):
            raise serializers.ValidationError(
                {'weekdays': 'Weekly recurring tasks require at least one weekday.'}
            )

        if attrs.get('interval', 1) < 1:
            raise serializers.ValidationError({'interval': 'Interval must be at least 1.'})

        start_at = attrs.get('start_at')
        end_at = attrs.get('end_at')
        if start_at and end_at and end_at < start_at:
            raise serializers.ValidationError({'end_at': 'End date must be after the start date.'})

        if self.instance and start_at and start_at != self.instance.start_at:
            if self.instance.start_at <= timezone.now():
                raise serializers.ValidationError(
                    {'start_at': 'Start date cannot be changed after the schedule has started.'}
                )

        return attrs

    def create(self, validated_data):
        validated_data['assigned_by'] = self.context['request'].user
        return super().create(validated_data)


class TaskSerializer(serializers.ModelSerializer):
    assigned_by = UserSimpleSerializer(read_only=True)
    assigned_to = UserSimpleSerializer(read_only=True)
    recurrence_schedule = serializers.PrimaryKeyRelatedField(read_only=True)
    assigned_by_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), write_only=True, source='assigned_by', required=False
    )
    assigned_to_id = serializers.PrimaryKeyRelatedField(
        queryset=User.objects.all(), write_only=True, source='assigned_to'
    )

    class Meta:
        model = Task
        fields = [
            'id',
            'title',
            'description',
            'assigned_by',
            'assigned_by_id',
            'assigned_to',
            'assigned_to_id',
            'status',
            'priority',
            'deadline',
            'recurrence_schedule',
            'recurrence_scheduled_for',
            'created_at',
            'updated_at',
            'completed_at',
        ]
        read_only_fields = [
            'created_at',
            'updated_at',
            'completed_at',
            'assigned_by',
            'recurrence_schedule',
            'recurrence_scheduled_for',
        ]

    def validate(self, attrs):
        request = self.context.get('request')
        current_user = getattr(request, 'user', None)
        deadline = attrs.get('deadline')

        if not self.instance and deadline is None:
            raise serializers.ValidationError(
                {'deadline': 'Deadline is required.'}
            )

        if deadline is not None:
            now = timezone.now().replace(second=0, microsecond=0)
            if deadline < now:
                raise serializers.ValidationError(
                    {'deadline': 'Deadline cannot be in the past.'}
                )

        assigned_to = attrs.get('assigned_to')
        if assigned_to is not None and current_user and assigned_to == current_user:
            raise serializers.ValidationError(
                {'assigned_to_id': 'You cannot assign a task to yourself.'}
            )

        if not self.instance:
            return attrs

        new_status = attrs.get('status')
        if new_status is None:
            return attrs

        old_status = self.instance.status
        if new_status == old_status:
            return attrs

        if current_user and current_user != self.instance.assigned_to:
            raise serializers.ValidationError(
                {'status': 'Only the assignee can change task progress.'}
            )

        if new_status == 'pending' and old_status != 'pending':
            raise serializers.ValidationError(
                {'status': 'Task progress cannot move back to pending once started.'}
            )

        return attrs


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
            from django.utils import timezone as django_timezone
            from datetime import datetime
            from .services import calculate_user_files_received

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
            from .models import DailyReport

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


class WeeklySummaryListSerializer(serializers.Serializer):
    """Serializer for listing available weeks"""
    week_start_date = serializers.DateField()
    week_end_date = serializers.DateField()
    created_at = serializers.DateTimeField()


class WeeklySummaryShareSerializer(serializers.Serializer):
    """Serializer for creating a share link"""
    share_link = serializers.CharField(read_only=True)


# PHASE 2 SERIALIZERS

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
    """Serializer for user-to-user sharing"""
    id = serializers.CharField(read_only=True)
    shared_with = serializers.IntegerField(source='shared_with.id', read_only=True)
    shared_with_username = serializers.SerializerMethodField()
    share_token = serializers.CharField(read_only=True, allow_null=True)
    share_link = serializers.SerializerMethodField()
    created_at = serializers.DateTimeField(read_only=True)
    
    def get_shared_with_username(self, obj):
        try:
            return obj.shared_with.username
        except Exception:
            return None

    def get_share_link(self, obj):
        try:
            token = getattr(obj, 'share_token', None)
            if token:
                return f"/summaries?token={token}"
        except Exception:
            pass
        return None


class SummaryExportSerializer(serializers.ModelSerializer):
    """Serializer for summary exports"""
    class Meta:
        model = SummaryExport
        fields = ['id', 'format', 'file_url', 'created_at']
        read_only_fields = ['id', 'file_url', 'created_at']


class UserGoalCreateSerializer(serializers.Serializer):
    """Serializer for creating a current-week user goal"""
    metric = serializers.ChoiceField(choices=UserGoal.GOAL_METRICS)
    target_value = serializers.FloatField()
    week_start_date = serializers.DateField(required=False)


class UserGoalSerializer(serializers.ModelSerializer):
    """Serializer for user goals"""
    class Meta:
        model = UserGoal
        fields = ['id', 'metric', 'target_value', 'period_start', 'period_end', 'is_active', 'created_at']
        read_only_fields = ['id', 'created_at']


class GoalProgressSerializer(serializers.Serializer):
    """Serializer for goal progress tracking"""
    metric = serializers.CharField()
    target = serializers.FloatField()
    current = serializers.FloatField()
    achieved = serializers.BooleanField()
    difference = serializers.FloatField()


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


class DailyReportCommentSerializer(serializers.ModelSerializer):
    author = UserSimpleSerializer(read_only=True)

    class Meta:
        model = DailyReportComment
        fields = ['id', 'author', 'body', 'created_at']
        read_only_fields = fields


class DailyReportSubreportSummarySerializer(serializers.ModelSerializer):
    created_by = UserSimpleSerializer(read_only=True)
    daily_report_id = serializers.SerializerMethodField()
    report_date = serializers.SerializerMethodField()
    comments_count = serializers.SerializerMethodField()
    latest_comment_at = serializers.SerializerMethodField()
    view_url = serializers.SerializerMethodField()

    class Meta:
        model = DailyReportSubreport
        fields = [
            'id',
            'title',
            'created_by',
            'daily_report_id',
            'report_date',
            'created_at',
            'comments_count',
            'latest_comment_at',
            'view_url',
        ]
        read_only_fields = fields

    def get_comments_count(self, obj):
        if hasattr(obj, 'comments_count'):
            return obj.comments_count
        return obj.comments.count()

    def get_daily_report_id(self, obj):
        return str(obj.daily_report_id)

    def get_report_date(self, obj):
        return obj.daily_report.report_date

    def get_latest_comment_at(self, obj):
        if hasattr(obj, 'latest_comment_at'):
            return obj.latest_comment_at
        latest_comment = obj.comments.order_by('-created_at').first()
        return latest_comment.created_at if latest_comment else None

    def get_view_url(self, obj):
        return f"/reports/subreports/{obj.id}"


class DailyReportSubreportDetailSerializer(DailyReportSubreportSummarySerializer):
    comments = DailyReportCommentSerializer(many=True, read_only=True)

    class Meta(DailyReportSubreportSummarySerializer.Meta):
        fields = DailyReportSubreportSummarySerializer.Meta.fields + ['comments']


class DailyReportSummarySerializer(serializers.ModelSerializer):
    creator = UserSimpleSerializer(source='user', read_only=True)
    department = serializers.CharField(source='department.name', read_only=True)
    title = serializers.SerializerMethodField()
    subreport_count = serializers.SerializerMethodField()
    view_url = serializers.SerializerMethodField()

    class Meta:
        model = DailyReport
        fields = [
            'id',
            'report_date',
            'creator',
            'department',
            'title',
            'subreport_count',
            'view_url',
            'created_at',
        ]
        read_only_fields = fields

    def get_title(self, obj):
        return obj.display_title

    def get_subreport_count(self, obj):
        if hasattr(obj, 'subreport_count'):
            return obj.subreport_count
        return obj.subreports.count()

    def get_view_url(self, obj):
        return f"/reports/daily/{obj.id}"


class DailyReportDetailSerializer(DailyReportSummarySerializer):
    subreports = DailyReportSubreportSummarySerializer(many=True, read_only=True)

    class Meta(DailyReportSummarySerializer.Meta):
        fields = DailyReportSummarySerializer.Meta.fields + ['subreports']


class DailyReportCreateSerializer(serializers.Serializer):
    report_date = serializers.DateField()
    title = serializers.CharField(max_length=255)
    comment = serializers.CharField(allow_blank=False, trim_whitespace=True)

    def validate_report_date(self, value):
        if value != timezone.localdate():
            raise serializers.ValidationError('You can only create a report for the current day.')
        return value

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Title is required.')
        return value

    def validate_comment(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Comment is required.')
        return value


class DailyReportSubreportCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)
    comment = serializers.CharField(allow_blank=False, trim_whitespace=True)

    def validate_title(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Title is required.')
        return value

    def validate_comment(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Comment is required.')
        return value


class DailyReportCommentCreateSerializer(serializers.Serializer):
    body = serializers.CharField(allow_blank=False, trim_whitespace=True)

    def validate_body(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Comment is required.')
        return value


class DailyReportSendEmailSerializer(serializers.Serializer):
    recipients = serializers.ListField(
        child=serializers.EmailField(),
        min_length=1,
        max_length=5,
    )

    def validate_recipients(self, value):
        normalized = []
        seen = set()
        for email in value:
            stripped = email.strip()
            key = stripped.lower()
            if key in seen:
                raise serializers.ValidationError('Duplicate email addresses are not allowed.')
            seen.add(key)
            normalized.append(stripped)
        return normalized
