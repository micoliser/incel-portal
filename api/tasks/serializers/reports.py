"""Daily reports, entries and comments."""

from django.utils import timezone
from rest_framework import serializers

from common.serializers import UserSummarySerializer

from ..models import (
    DailyReport,
    DailyReportComment,
    DailyReportSubreport,
)


class DailyReportCommentSerializer(serializers.ModelSerializer):
    author = UserSummarySerializer(read_only=True)

    class Meta:
        model = DailyReportComment
        fields = ['id', 'author', 'body', 'created_at']
        read_only_fields = fields


class DailyReportSubreportSummarySerializer(serializers.ModelSerializer):
    created_by = UserSummarySerializer(read_only=True)
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
    creator = UserSummarySerializer(source='user', read_only=True)
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
