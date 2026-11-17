import hashlib
import secrets

from django import forms
from django.contrib import admin, messages
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin
from django.contrib.auth.models import User
from django.utils.html import format_html

from .models import SERVICE_API_SCOPES, ServiceApiKey, StaffProfile

# Generated keys are 43 random characters; a hand-chosen one must not be weaker
# than something guessable.
MIN_CUSTOM_KEY_LENGTH = 32


class UserAdmin(DjangoUserAdmin):
    """Users cannot be deleted from the admin site. Their tasks, reports and
    requests reference them, so leavers are deactivated instead (Users page in
    the portal, or the Active box here)."""

    def has_delete_permission(self, request, obj=None):
        return False


admin.site.unregister(User)
admin.site.register(User, UserAdmin)


@admin.register(StaffProfile)
class StaffProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'role', 'department', 'is_active', 'updated_at')
    list_filter = ('is_active', 'role', 'department')
    search_fields = ('user__username', 'user__email', 'role__name', 'role__code', 'department__name', 'department__code')


class ServiceApiKeyAdminForm(forms.ModelForm):
    custom_key = forms.CharField(
        label="Set Custom Token (Optional)",
        required=False,
        widget=forms.TextInput(attrs={
            'placeholder': 'Leave blank to auto-generate a secure token (e.g. incel_live_...)',
            'style': 'width: 100%; max-width: 480px;',
        }),
        help_text="Leave blank to automatically generate a random token, or provide your own custom token string.",
    )

    scopes = forms.MultipleChoiceField(
        choices=SERVICE_API_SCOPES,
        required=False,
        widget=forms.CheckboxSelectMultiple,
        help_text='What this key may do. A key with no scope is accepted nowhere.',
    )

    class Meta:
        model = ServiceApiKey
        fields = ('name', 'scopes', 'is_active', 'expires_at', 'created_by')

    def clean_custom_key(self):
        value = (self.cleaned_data.get('custom_key') or '').strip()
        if value and len(value) < MIN_CUSTOM_KEY_LENGTH:
            raise forms.ValidationError(
                f'A custom token must be at least {MIN_CUSTOM_KEY_LENGTH} characters, or leave it blank '
                'to generate a strong one.'
            )
        return value


@admin.register(ServiceApiKey)
class ServiceApiKeyAdmin(admin.ModelAdmin):
    form = ServiceApiKeyAdminForm
    list_display = ('name', 'prefix', 'is_active', 'last_used_at', 'expires_at', 'created_at')
    list_filter = ('is_active', 'created_at')
    search_fields = ('name', 'prefix')
    readonly_fields = ('prefix', 'hashed_key', 'last_used_at', 'created_at', 'updated_at')
    fields = (
        'name',
        'custom_key',
        'scopes',
        'is_active',
        'expires_at',
        'created_by',
        'prefix',
        'hashed_key',
        'last_used_at',
        'created_at',
        'updated_at',
    )
    actions = ['regenerate_api_keys']

    def save_model(self, request, obj, form, change):
        raw_key = None
        custom_key = form.cleaned_data.get('custom_key', '').strip() if form else ''

        if not change or custom_key or not obj.hashed_key:
            if custom_key:
                raw_key = custom_key
            else:
                random_part = secrets.token_urlsafe(32)
                raw_key = f"incel_live_{random_part}"

            obj.prefix = raw_key[:12]
            obj.hashed_key = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()

        if not obj.created_by:
            obj.created_by = request.user

        super().save_model(request, obj, form, change)

        if raw_key:
            request._generated_raw_api_key = raw_key

    def response_add(self, request, obj, post_url_continue=None):
        self._append_key_banner(request, obj, is_new=True)
        return super().response_add(request, obj, post_url_continue)

    def response_change(self, request, obj):
        self._append_key_banner(request, obj, is_new=False)
        return super().response_change(request, obj)

    def _append_key_banner(self, request, obj, is_new=True):
        raw_key = getattr(request, '_generated_raw_api_key', None)
        if not raw_key:
            return

        title = "Service API Key Created" if is_new else "Service API Key Updated / Regenerated"
        bg_color = "#f0fdf4" if is_new else "#fefce8"
        border_color = "#22c55e" if is_new else "#eab308"
        text_color = "#15803d" if is_new else "#854d0e"
        subtext_color = "#166534" if is_new else "#713f12"

        msg = format_html(
            '<div style="background: {}; border: 2px solid {}; border-radius: 8px; padding: 16px; margin: 12px 0;">'
            '<div style="font-weight: 700; color: {}; font-size: 15px; margin-bottom: 6px;">'
            '🔑 {}: <code>{}</code></div>'
            '<div style="color: {}; font-size: 13px; margin-bottom: 10px;">'
            '<strong>Copy your raw Bearer token now:</strong> For security reasons, the database only stores '
            'the SHA-256 hash. <u>You will not be able to view this full token again</u>.</div>'
            '<input type="text" value="{}" readonly onclick="this.select();" '
            'style="width: 100%; max-width: 650px; font-family: monospace; font-size: 13px; font-weight: 600; '
            'padding: 8px 12px; border: 1px solid {}; border-radius: 6px; background: #ffffff; color: #111827;" />'
            '</div>',
            bg_color, border_color, text_color, title, obj.name, subtext_color, raw_key, border_color,
        )
        messages.success(request, msg)

    @admin.action(description="Regenerate selected API Key(s)")
    def regenerate_api_keys(self, request, queryset):
        for obj in queryset:
            random_part = secrets.token_urlsafe(32)
            raw_key = f"incel_live_{random_part}"
            obj.prefix = raw_key[:12]
            obj.hashed_key = hashlib.sha256(raw_key.encode('utf-8')).hexdigest()
            obj.save(update_fields=['prefix', 'hashed_key', 'updated_at'])

            msg = format_html(
                '<div style="background: #fefce8; border: 2px solid #eab308; border-radius: 8px; padding: 16px; '
                'margin: 12px 0;"><div style="font-weight: 700; color: #854d0e; font-size: 15px; margin-bottom: 6px;">'
                '🔄 Key Regenerated for: <code>{}</code></div>'
                '<div style="color: #713f12; font-size: 13px; margin-bottom: 10px;">'
                '<strong>Copy your new Bearer token now:</strong> The previous key is now revoked.</div>'
                '<input type="text" value="{}" readonly onclick="this.select();" '
                'style="width: 100%; max-width: 650px; font-family: monospace; font-size: 13px; font-weight: 600; '
                'padding: 8px 12px; border: 1px solid #eab308; border-radius: 6px; background: #ffffff; '
                'color: #111827;" /></div>',
                obj.name, raw_key,
            )
            messages.warning(request, msg)
