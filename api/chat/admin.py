"""Chat in Django admin: read-only and for superusers only.

Message text, file contents and file names are encrypted in the browser, so
they appear here only as scrambled base64 (and their size). Who talks to whom
and when is not encrypted, which is why nothing here can be edited or deleted,
only superusers can see it, and every page opened is written to the audit log.
"""

from django.contrib import admin
from django.db.models import Count, OuterRef, Subquery, Sum
from django.template.defaultfilters import filesizeformat
from django.utils.html import format_html

from audit.actions import AuditAction
from audit.log import log_audit
from chat.models import ChatAccount, Conversation, Message, MessageAttachment, MessageReaction, Participant
from common.users import display_name

PREVIEW_CHARS = 48


def _scrambled(value):
    if not value:
        return '—'
    preview = value[:PREVIEW_CHARS] + ('…' if len(value) > PREVIEW_CHARS else '')
    return format_html(
        '<code style="word-break: break-all;">{}</code><br><small>{} encrypted</small>',
        preview,
        filesizeformat(len(value) * 3 // 4),
    )


class ReadOnlyChatAdmin(admin.ModelAdmin):
    actions = None

    @staticmethod
    def _allowed(request):
        return bool(request.user.is_active and request.user.is_superuser)

    def has_module_permission(self, request):
        return self._allowed(request)

    def has_view_permission(self, request, obj=None):
        return self._allowed(request)

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def _log_view(self, request, object_id=None):
        if request.method == 'GET':
            log_audit(
                action=AuditAction.CHAT_ADMIN_VIEWED,
                request=request,
                target_type=self.model.__name__,
                target_id=object_id or '',
                metadata={'page': 'detail' if object_id else 'list', 'query': request.GET.urlencode()},
            )

    def changelist_view(self, request, extra_context=None):
        response = super().changelist_view(request, extra_context)
        if self._allowed(request):
            self._log_view(request)
        return response

    def change_view(self, request, object_id, form_url='', extra_context=None):
        response = super().change_view(request, object_id, form_url, extra_context)
        if self._allowed(request):
            self._log_view(request, object_id)
        return response


@admin.register(ChatAccount)
class ChatAccountAdmin(ReadOnlyChatAdmin):
    list_display = ['user', 'key_id', 'last_seen_at', 'created_at', 'updated_at']
    search_fields = ['user__email', 'user__first_name', 'user__last_name']
    list_select_related = ['user']
    ordering = ['-updated_at']
    fields = ['user', 'key_id', 'public_key', 'pin_copy', 'recovery_copy', 'last_seen_at', 'created_at', 'updated_at']
    readonly_fields = fields

    @admin.display(description='Private key, PIN and password copy')
    def pin_copy(self, obj):
        return _scrambled(obj.pin_box)

    @admin.display(description='Private key, recovery code copy')
    def recovery_copy(self, obj):
        return _scrambled(obj.recovery_box)


class ParticipantInline(admin.TabularInline):
    model = Participant
    extra = 0
    can_delete = False
    fields = ['user', 'role', 'joined_at', 'left_at', 'last_read_seq']
    readonly_fields = fields
    show_change_link = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


@admin.register(Conversation)
class ConversationAdmin(ReadOnlyChatAdmin):
    list_display = ['id', 'kind', 'people', 'message_count', 'file_total', 'last_message_at', 'created_at']
    list_filter = ['kind']
    search_fields = ['participants__user__email', 'participants__user__first_name', 'participants__user__last_name']
    ordering = ['-last_message_at']
    fields = ['id', 'kind', 'created_by', 'message_count', 'file_total', 'last_message_at', 'created_at']
    readonly_fields = fields
    inlines = [ParticipantInline]

    def get_queryset(self, request):
        return (
            super()
            .get_queryset(request)
            .annotate(
                _messages=Count('messages', distinct=True),
                # A subquery, so joining messages does not multiply the sum.
                _file_bytes=Subquery(
                    MessageAttachment.objects.filter(conversation=OuterRef('pk'))
                    .order_by()
                    .values('conversation')
                    .annotate(total=Sum('encrypted_size'))
                    .values('total')[:1]
                ),
            )
            .prefetch_related('participants__user')
        )

    def get_search_results(self, request, queryset, search_term):
        queryset, _ = super().get_search_results(request, queryset, search_term)
        return queryset, True

    @admin.display(description='People')
    def people(self, obj):
        return ', '.join(display_name(p.user) for p in obj.participants.all())

    @admin.display(description='Messages', ordering='_messages')
    def message_count(self, obj):
        return obj._messages

    @admin.display(description='Files (encrypted)', ordering='_file_bytes')
    def file_total(self, obj):
        return filesizeformat(obj._file_bytes or 0)


@admin.register(Message)
class MessageAdmin(ReadOnlyChatAdmin):
    list_display = ['created_at', 'conversation_id', 'sender', 'seq', 'kind', 'system_event', 'edited_at', 'deleted_at', 'size']
    list_filter = ['kind', 'system_event']
    search_fields = ['=conversation__id', 'sender__email']
    list_select_related = ['sender']
    ordering = ['-created_at']
    show_full_result_count = False
    fields = [
        'id', 'conversation', 'sender', 'seq', 'kind', 'system_event', 'system_data',
        'key_version', 'revision', 'encrypted_text', 'created_at', 'edited_at', 'deleted_at',
    ]
    readonly_fields = fields

    @admin.display(description='Encrypted size')
    def size(self, obj):
        return filesizeformat(len(obj.ciphertext) * 3 // 4) if obj.ciphertext else '—'

    @admin.display(description='Text (encrypted)')
    def encrypted_text(self, obj):
        return _scrambled(obj.ciphertext)


@admin.register(MessageAttachment)
class MessageAttachmentAdmin(ReadOnlyChatAdmin):
    list_display = ['created_at', 'conversation_id', 'uploaded_by', 'sent', 'size']
    search_fields = ['=conversation__id', 'uploaded_by__email']
    list_select_related = ['uploaded_by']
    ordering = ['-created_at']
    fields = ['id', 'conversation', 'message', 'uploaded_by', 'size', 'thumb_size', 'created_at']
    readonly_fields = fields

    @admin.display(description='Sent', boolean=True)
    def sent(self, obj):
        return obj.message_id is not None

    @admin.display(description='Encrypted size', ordering='encrypted_size')
    def size(self, obj):
        return filesizeformat(obj.encrypted_size or 0)


@admin.register(MessageReaction)
class MessageReactionAdmin(ReadOnlyChatAdmin):
    list_display = ['updated_at', 'user', 'message_id', 'key_version']
    search_fields = ['=message__id', 'user__email']
    list_select_related = ['user']
    ordering = ['-updated_at']
    fields = ['message', 'user', 'key_version', 'emoji', 'updated_at']
    readonly_fields = fields

    @admin.display(description='Emoji (encrypted)')
    def emoji(self, obj):
        return _scrambled(obj.ciphertext)
