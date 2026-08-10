from django.contrib import admin
from .models import (
    RecurrenceOccurrence, RecurringSchedule, Task, TaskActivity,
    TaskAttachment, WeeklySummary, WeeklySummaryShare, WeeklySummaryUserShare,
    DailyReport, DailyReportSubreport, DailyReportComment,
    SummaryExport, UserGoal, OrganizationSummaryCache
)


@admin.register(Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = ['title', 'assigned_by', 'assigned_to', 'status', 'priority', 'deadline', 'created_at']
    list_filter = ['status', 'priority', 'created_at']
    search_fields = ['title', 'description']
    readonly_fields = ['created_at', 'updated_at', 'completed_at']


@admin.register(TaskActivity)
class TaskActivityAdmin(admin.ModelAdmin):
    list_display = ['task', 'user', 'activity_type', 'created_at']
    list_filter = ['activity_type', 'created_at']
    search_fields = ['task__title', 'comment']
    readonly_fields = ['created_at']


@admin.register(RecurringSchedule)
class RecurringScheduleAdmin(admin.ModelAdmin):
    list_display = ['title', 'assigned_by', 'assigned_to', 'frequency', 'interval', 'is_active', 'next_run_at']
    list_filter = ['frequency', 'is_active', 'created_at']
    search_fields = ['title', 'description']
    readonly_fields = ['created_at', 'updated_at', 'next_run_at', 'ended_at']


@admin.register(RecurrenceOccurrence)
class RecurrenceOccurrenceAdmin(admin.ModelAdmin):
    list_display = ['schedule', 'scheduled_for', 'created_task', 'created_at']
    list_filter = ['created_at']
    search_fields = ['schedule__title']
    readonly_fields = ['created_at']


@admin.register(TaskAttachment)
class TaskAttachmentAdmin(admin.ModelAdmin):
    list_display = ['file_name', 'activity', 'size', 'created_at']
    search_fields = ['file_name']
    readonly_fields = ['created_at']


@admin.register(WeeklySummary)
class WeeklySummaryAdmin(admin.ModelAdmin):
    list_display = ['user', 'week_start_date', 'week_end_date', 'created_at']
    list_filter = ['week_start_date']
    search_fields = ['user__username']


@admin.register(WeeklySummaryShare)
class WeeklySummaryShareAdmin(admin.ModelAdmin):
    list_display = ['summary', 'shared_by', 'created_at', 'expires_at']
    search_fields = ['shared_by__username']


@admin.register(WeeklySummaryUserShare)
class WeeklySummaryUserShareAdmin(admin.ModelAdmin):
    list_display = ['summary', 'shared_by', 'shared_with', 'created_at']
    search_fields = ['shared_by__username', 'shared_with__username']


@admin.register(DailyReport)
class DailyReportAdmin(admin.ModelAdmin):
    list_display = ['user', 'department', 'report_date', 'created_at']
    list_filter = ['report_date', 'department']
    search_fields = ['user__username']


@admin.register(DailyReportSubreport)
class DailyReportSubreportAdmin(admin.ModelAdmin):
    list_display = ['title', 'daily_report', 'created_by', 'created_at']
    search_fields = ['title', 'created_by__username']


@admin.register(DailyReportComment)
class DailyReportCommentAdmin(admin.ModelAdmin):
    list_display = ['subreport', 'author', 'created_at']
    search_fields = ['author__username']


@admin.register(SummaryExport)
class SummaryExportAdmin(admin.ModelAdmin):
    list_display = ['summary', 'exported_by', 'format', 'created_at']
    list_filter = ['format']
    search_fields = ['exported_by__username']


@admin.register(UserGoal)
class UserGoalAdmin(admin.ModelAdmin):
    list_display = ['user', 'metric', 'target_value', 'is_active', 'period_start', 'period_end']
    list_filter = ['metric', 'is_active']
    search_fields = ['user__username']


@admin.register(OrganizationSummaryCache)
class OrganizationSummaryCacheAdmin(admin.ModelAdmin):
    list_display = ['week_start_date', 'week_end_date', 'created_at']
    list_filter = ['week_start_date']
