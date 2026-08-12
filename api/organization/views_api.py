from rest_framework import permissions, viewsets
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.decorators import action
from rest_framework import status
from django.db import transaction

from accounts.models import StaffProfile

from common.permissions import IsGlobalAccessUser
from organization.models import Department, Role, Unit, Team
from organization.serializers import (
    DepartmentSerializer, 
    RoleSerializer,
    UnitSerializer,
    TeamSerializer,
    DepartmentHierarchySerializer
)


class DepartmentListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, _request):
        departments = Department.objects.filter(is_active=True).order_by('name')
        return Response(DepartmentSerializer(departments, many=True).data)


class RoleListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def get(self, _request):
        roles = Role.objects.filter(is_active=True).order_by('name')
        return Response(RoleSerializer(roles, many=True).data)


class HierarchyView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, _request):
        departments = Department.objects.filter(is_active=True).prefetch_related(
            'units__teams', 'units__supervisor', 'units__teams__team_lead', 'line_manager'
        ).order_by('name')
        return Response(DepartmentHierarchySerializer(departments, many=True).data)


class DepartmentViewSet(viewsets.ModelViewSet):
    queryset = Department.objects.all().order_by('name')
    serializer_class = DepartmentSerializer
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def bulk_members(self, request, pk=None):
        department = self.get_object()
        user_ids = request.data.get('user_ids', [])
        
        # Departments only support "add" (which acts as a move if they are already in a department)
        profiles = StaffProfile.objects.filter(user_id__in=user_ids)
        # Clear unit and team since they are moving to a new department hierarchy
        profiles.update(department=department, unit=None, team=None)
        
        return Response({'status': 'ok'})


class UnitViewSet(viewsets.ModelViewSet):
    queryset = Unit.objects.all().order_by('name')
    serializer_class = UnitSerializer
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def bulk_members(self, request, pk=None):
        unit = self.get_object()
        user_ids = request.data.get('user_ids', [])
        action_type = request.data.get('action', 'add')
        
        profiles = StaffProfile.objects.filter(user_id__in=user_ids)
        if action_type == 'add':
            # Optionally validate they belong to the correct department
            profiles.update(unit=unit, department=unit.department)
        elif action_type == 'remove':
            profiles.update(unit=None, team=None)
            
        return Response({'status': 'ok'})


class TeamViewSet(viewsets.ModelViewSet):
    queryset = Team.objects.all().order_by('name')
    serializer_class = TeamSerializer
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def bulk_members(self, request, pk=None):
        team = self.get_object()
        user_ids = request.data.get('user_ids', [])
        action_type = request.data.get('action', 'add')
        
        profiles = StaffProfile.objects.filter(user_id__in=user_ids)
        if action_type == 'add':
            profiles.update(team=team, unit=team.unit, department=team.unit.department)
        elif action_type == 'remove':
            profiles.update(team=None)
            
        return Response({'status': 'ok'})
