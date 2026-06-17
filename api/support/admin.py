from django.contrib import admin

from .models import SupportAttachment, SupportComment, SupportRequest


class SupportCommentInline(admin.TabularInline):
    model = SupportComment
    extra = 0
    readonly_fields = ['author', 'body', 'is_system', 'created_at']


class SupportAttachmentInline(admin.TabularInline):
    model = SupportAttachment
    extra = 0
    readonly_fields = ['file_name', 'content_type', 'size', 'object_key', 'created_at']


@admin.register(SupportRequest)
class SupportRequestAdmin(admin.ModelAdmin):
    list_display = ['title', 'category', 'priority', 'status', 'department', 'requester', 'assigned_to', 'created_at']
    list_filter = ['status', 'category', 'priority', 'department']
    search_fields = ['title', 'description', 'requester__username']
    readonly_fields = ['created_at', 'updated_at', 'resolved_at', 'closed_at']
    inlines = [SupportCommentInline, SupportAttachmentInline]


@admin.register(SupportComment)
class SupportCommentAdmin(admin.ModelAdmin):
    list_display = ['request', 'author', 'is_system', 'created_at']
    list_filter = ['is_system']
    readonly_fields = ['created_at']


@admin.register(SupportAttachment)
class SupportAttachmentAdmin(admin.ModelAdmin):
    list_display = ['file_name', 'content_type', 'size', 'created_at']
    readonly_fields = ['created_at']
