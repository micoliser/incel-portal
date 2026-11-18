from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction
from django.db.models import Count, Prefetch, ProtectedError, Q
from rest_framework import permissions
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import StaffProfile
from audit import log_audit
from audit.actions import AuditAction
from common.exceptions import Conflict
from common.permissions import IsAdminOrGlobalReadOnly, IsAdminUser, has_admin_access
from common.viewsets import (
    CreateModelMixin,
    DestroyModelMixin,
    GenericViewSet,
    ListModelMixin,
    PartialUpdateModelMixin,
    RetrieveModelMixin,
)
from organization.models import Department, Role, Team, Unit
from organization.serializers import (
    DepartmentHierarchySerializer,
    DepartmentSerializer,
    MembershipChangeSerializer,
    RoleSerializer,
    TeamSerializer,
    UnitSerializer,
)
from organization.services import place_profile

ACTIVE_MEMBERS = Count('members', filter=Q(members__user__is_active=True), distinct=True)


class RoleListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminOrGlobalReadOnly]

    def get(self, _request):
        roles = Role.objects.filter(is_active=True).order_by('name')
        return Response(RoleSerializer(roles, many=True).data)


class HierarchyView(APIView):
    """The whole organization tree: departments, their units, their teams."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, _request):
        teams = Team.objects.select_related('team_lead').annotate(members_count=ACTIVE_MEMBERS).order_by('name')
        units = (
            Unit.objects.select_related('supervisor')
            .annotate(members_count=ACTIVE_MEMBERS)
            .prefetch_related(Prefetch('teams', queryset=teams))
            .order_by('name')
        )
        departments = (
            Department.objects.filter(is_active=True)
            .select_related('line_manager')
            .annotate(members_count=ACTIVE_MEMBERS)
            .prefetch_related(Prefetch('units', queryset=units))
            .order_by('name')
        )
        return Response(DepartmentHierarchySerializer(departments, many=True).data)


class OrganizationGroupViewSet(
    ListModelMixin,
    RetrieveModelMixin,
    CreateModelMixin,
    PartialUpdateModelMixin,
    DestroyModelMixin,
    GenericViewSet,
):
    """Shared behaviour for departments, units and teams.

    Everyone signed in may read (the lists feed pickers across the portal);
    only administrators may change anything. These lists are short and are
    always shown whole, so they are deliberately not paginated.
    """

    lookup_value_converter = 'uuid'
    pagination_class = None

    group_label = ''
    leader_field = ''
    search_fields = ('name', 'code')

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [permissions.IsAuthenticated()]
        return [permissions.IsAuthenticated(), IsAdminUser()]

    def get_queryset(self):
        queryset = self.queryset.all()
        # Inactive groups are an administrative detail.
        if not has_admin_access(self.request.user):
            queryset = queryset.filter(is_active=True)

        search = (self.request.query_params.get('search') or '').strip()
        if search:
            condition = Q()
            for field in self.search_fields:
                condition |= Q(**{f'{field}__icontains': search})
            queryset = queryset.filter(condition)
        return queryset

    # --- audit -------------------------------------------------------------

    def _audit(self, action_name, instance, **metadata):
        log_audit(
            action=action_name,
            request=self.request,
            actor_user=self.request.user,
            target_type=self.group_label,
            target_id=instance.id,
            metadata={'name': instance.name, 'code': instance.code, **metadata},
        )

    def perform_create(self, serializer):
        instance = serializer.save()
        self._audit(AuditAction.ORG_GROUP_CREATED, instance)

    def perform_update(self, serializer):
        previous_leader_id = getattr(serializer.instance, f'{self.leader_field}_id')
        instance = serializer.save()
        self._audit(AuditAction.ORG_GROUP_UPDATED, instance, changed=sorted(serializer.validated_data.keys()))

        leader_id = getattr(instance, f'{self.leader_field}_id')
        if leader_id != previous_leader_id:
            self._audit(
                AuditAction.ORG_LEADER_CHANGED,
                instance,
                role=self.leader_field,
                previous_user_id=previous_leader_id,
                user_id=leader_id,
            )

    def perform_destroy(self, instance):
        instance_id = instance.id
        try:
            with transaction.atomic():
                instance.delete()
        except ProtectedError:
            raise Conflict(
                f'This {self.group_label} still has members. Move them elsewhere before deleting it.'
            )
        instance.id = instance_id  # Django clears it on delete; the audit row needs it
        self._audit(AuditAction.ORG_GROUP_DELETED, instance)

    # --- membership --------------------------------------------------------

    def _placement_for_add(self, group):
        raise NotImplementedError

    def _placement_for_remove(self, group):
        raise NotImplementedError

    def _current_members(self, group, user_ids):
        raise NotImplementedError

    @action(detail=True, methods=['post'])
    def members(self, request, pk=None):
        """POST {action: add|remove, user_ids: [...]} - move people into or out of this group.

        Removing only affects people who are actually in the group. Anyone who
        led a group they have now left stops being its leader.
        """
        group = self.get_object()
        serializer = MembershipChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user_ids = serializer.validated_data.get('user_ids', [])
        action_type = serializer.validated_data.get('action', 'add')

        profiles = StaffProfile.objects.select_related('user').filter(user_id__in=user_ids)
        if action_type == 'remove':
            placement = self._placement_for_remove(group)
            if placement is None:
                raise ValidationError(
                    {'action': f'People cannot be removed from a {self.group_label}; move them to another one.'}
                )
            profiles = self._current_members(profiles, group)
        else:
            placement = self._placement_for_add(group)

        moved = []
        with transaction.atomic():
            for profile in profiles.select_for_update():
                try:
                    place_profile(profile, **placement)
                except DjangoValidationError as exc:
                    raise ValidationError(exc.message_dict)
                moved.append(profile.user_id)

        if moved:
            self._audit(
                AuditAction.ORG_MEMBERS_ADDED if action_type == 'add' else AuditAction.ORG_MEMBERS_REMOVED,
                group,
                user_ids=moved,
            )

        group.refresh_from_db()
        return Response(self.get_serializer(group).data)


class DepartmentViewSet(OrganizationGroupViewSet):
    queryset = Department.objects.select_related('line_manager').order_by('name')
    serializer_class = DepartmentSerializer
    group_label = 'department'
    leader_field = 'line_manager'

    def _placement_for_add(self, group):
        # Moving to another department leaves the old unit and team behind.
        return {'department': group, 'unit': None, 'team': None}

    def _placement_for_remove(self, group):
        return None


class UnitViewSet(OrganizationGroupViewSet):
    queryset = Unit.objects.select_related('supervisor', 'department').order_by('name')
    serializer_class = UnitSerializer
    group_label = 'unit'
    leader_field = 'supervisor'

    def get_queryset(self):
        queryset = super().get_queryset()
        department_id = self.request.query_params.get('department_id')
        if department_id:
            queryset = queryset.filter(department_id=department_id)
        return queryset

    def _placement_for_add(self, group):
        return {'department': group.department, 'unit': group, 'team': None}

    def _placement_for_remove(self, group):
        return {'unit': None, 'team': None}

    def _current_members(self, profiles, group):
        return profiles.filter(unit=group)


class TeamViewSet(OrganizationGroupViewSet):
    queryset = Team.objects.select_related('team_lead', 'unit__department').order_by('name')
    serializer_class = TeamSerializer
    group_label = 'team'
    leader_field = 'team_lead'

    def get_queryset(self):
        queryset = super().get_queryset()
        unit_id = self.request.query_params.get('unit_id')
        if unit_id:
            queryset = queryset.filter(unit_id=unit_id)
        return queryset

    def _placement_for_add(self, group):
        return {'department': group.unit.department, 'unit': group.unit, 'team': group}

    def _placement_for_remove(self, group):
        return {'team': None}

    def _current_members(self, profiles, group):
        return profiles.filter(team=group)
