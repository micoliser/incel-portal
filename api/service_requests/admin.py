from django.contrib import admin

from .models import ApprovalDecision, Audience, ReferenceCounter, RequestEvent, ServiceRequest, TicketDetails


@admin.register(Audience)
class AudienceAdmin(admin.ModelAdmin):
    """Who submits, views, is notified of and approves each service's requests."""

    list_display = ('service', 'purpose', 'kind', 'unit', 'department', 'role', 'is_active')
    list_filter = ('service', 'purpose', 'kind', 'is_active')
    autocomplete_fields = ()


class TicketDetailsInline(admin.StackedInline):
    model = TicketDetails
    can_delete = False
    extra = 0
    readonly_fields = [field.name for field in TicketDetails._meta.fields]


class DecisionInline(admin.TabularInline):
    model = ApprovalDecision
    extra = 0
    can_delete = False
    readonly_fields = [field.name for field in ApprovalDecision._meta.fields]


@admin.register(ServiceRequest)
class ServiceRequestAdmin(admin.ModelAdmin):
    """Read-only: requests change only through the portal, so every change is recorded."""

    list_display = ('reference', 'title', 'status', 'payment_type', 'submitted_by', 'created_at')
    list_filter = ('service', 'status', 'payment_type', 'party_type')
    search_fields = ('reference', 'title', 'client_name', 'ticket__pnr')
    inlines = [TicketDetailsInline, DecisionInline]

    def get_readonly_fields(self, request, obj=None):
        return [field.name for field in ServiceRequest._meta.fields]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(RequestEvent)
class RequestEventAdmin(admin.ModelAdmin):
    list_display = ('request', 'action', 'actor', 'created_at')
    list_filter = ('action',)
    readonly_fields = [field.name for field in RequestEvent._meta.fields]


admin.site.register(ReferenceCounter)
