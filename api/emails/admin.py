from django.contrib import admin
from emails.models import EmailLog


@admin.register(EmailLog)
class EmailLogAdmin(admin.ModelAdmin):
    list_display = ('email_type', 'subject', 'status', 'created_at')
    list_filter = ('status', 'email_type', 'created_at')
    search_fields = ('subject', 'recipients')
    readonly_fields = (
        'email_type',
        'subject',
        'recipients',
        'status',
        'error_message',
        'created_at',
        'sent_at',
    )
    ordering = ['-created_at']

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return request.user.is_superuser
