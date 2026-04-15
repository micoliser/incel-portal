from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from common.permissions import IsGlobalAccessUser
from organization.models import Department, Role
from organization.serializers import DepartmentSerializer, RoleSerializer


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
