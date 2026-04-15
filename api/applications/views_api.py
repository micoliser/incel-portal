from django.contrib.auth.models import User
from django.utils.dateparse import parse_datetime
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from applications.audit import log_audit
from applications.models import ApplicationAccessOverride, AuditLog, InternalApplication
from applications.serializers import (
    AccessOverrideCreateSerializer,
    AccessOverrideSerializer,
    AuditLogSerializer,
    InternalApplicationSerializer,
    InternalApplicationWriteSerializer,
    SetApplicationDepartmentsSerializer,
)
from common.access import can_user_access_application
from common.permissions import IsGlobalAccessUser
from organization.models import Department


class ApplicationListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        applications = InternalApplication.objects.all().order_by('name')
        data = []
        for app in applications:
            item = InternalApplicationSerializer(app).data
            can_access, reason = can_user_access_application(request.user, app)
            item['can_access'] = can_access
            item['access_reason'] = reason
            data.append(item)
        return Response(data)


class ApplicationDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, application_id):
        app = InternalApplication.objects.filter(id=application_id).first()
        if not app:
            return Response({'detail': 'Application not found.'}, status=status.HTTP_404_NOT_FOUND)

        payload = InternalApplicationSerializer(app).data
        can_access, reason = can_user_access_application(request.user, app)
        payload['can_access'] = can_access
        payload['access_reason'] = reason
        return Response(payload)


class ApplicationCanAccessView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, application_id):
        app = InternalApplication.objects.filter(id=application_id).first()
        if not app:
            return Response({'detail': 'Application not found.'}, status=status.HTTP_404_NOT_FOUND)

        can_access, reason = can_user_access_application(request.user, app)
        return Response({'application_id': app.id, 'can_access': can_access, 'reason': reason})


class ApplicationOpenView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, application_id):
        app = InternalApplication.objects.filter(id=application_id).first()
        if not app:
            return Response({'detail': 'Application not found.'}, status=status.HTTP_404_NOT_FOUND)

        can_access, reason = can_user_access_application(request.user, app)
        action = 'APPLICATION_OPEN_GRANTED' if can_access else 'APPLICATION_OPEN_DENIED'
        log_audit(
            action=action,
            request=request,
            actor_user=request.user,
            target_type='InternalApplication',
            target_id=app.id,
            metadata={'reason': reason},
        )

        if not can_access:
            return Response({'detail': reason}, status=status.HTTP_403_FORBIDDEN)

        return Response({'application_id': app.id, 'url': app.app_url})


class AdminApplicationCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def post(self, request):
        serializer = InternalApplicationWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        department_ids = serializer.validated_data.pop('department_ids', [])
        app = InternalApplication.objects.create(**serializer.validated_data)

        if department_ids:
            departments = list(Department.objects.filter(id__in=department_ids))
            if len(departments) != len(set(department_ids)):
                app.delete()
                return Response({'detail': 'One or more department IDs are invalid.'}, status=status.HTTP_400_BAD_REQUEST)
            app.departments.set(departments)

        log_audit(
            action='ADMIN_APPLICATION_CREATED',
            request=request,
            actor_user=request.user,
            target_type='InternalApplication',
            target_id=app.id,
            metadata={'department_ids': department_ids},
        )

        return Response(InternalApplicationSerializer(app).data, status=status.HTTP_201_CREATED)


class AdminApplicationUpdateDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def patch(self, request, application_id):
        app = InternalApplication.objects.filter(id=application_id).first()
        if not app:
            return Response({'detail': 'Application not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = InternalApplicationWriteSerializer(app, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        department_ids = serializer.validated_data.pop('department_ids', None)
        for key, value in serializer.validated_data.items():
            setattr(app, key, value)
        app.save()

        if department_ids is not None:
            departments = list(Department.objects.filter(id__in=department_ids))
            if len(departments) != len(set(department_ids)):
                return Response({'detail': 'One or more department IDs are invalid.'}, status=status.HTTP_400_BAD_REQUEST)
            app.departments.set(departments)

        log_audit(
            action='ADMIN_APPLICATION_UPDATED',
            request=request,
            actor_user=request.user,
            target_type='InternalApplication',
            target_id=app.id,
            metadata={'department_ids': department_ids},
        )

        return Response(InternalApplicationSerializer(app).data)

    def delete(self, request, application_id):
        app = InternalApplication.objects.filter(id=application_id).first()
        if not app:
            return Response({'detail': 'Application not found.'}, status=status.HTTP_404_NOT_FOUND)

        app.status = InternalApplication.Status.INACTIVE
        app.visibility_scope = InternalApplication.VisibilityScope.HIDDEN
        app.save(update_fields=['status', 'visibility_scope', 'updated_at'])

        log_audit(
            action='ADMIN_APPLICATION_SOFT_DELETED',
            request=request,
            actor_user=request.user,
            target_type='InternalApplication',
            target_id=app.id,
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminApplicationDepartmentsView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def put(self, request, application_id):
        app = InternalApplication.objects.filter(id=application_id).first()
        if not app:
            return Response({'detail': 'Application not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = SetApplicationDepartmentsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        department_ids = serializer.validated_data['department_ids']
        departments = list(Department.objects.filter(id__in=department_ids))
        if len(departments) != len(set(department_ids)):
            return Response({'detail': 'One or more department IDs are invalid.'}, status=status.HTTP_400_BAD_REQUEST)

        app.departments.set(departments)
        app.save(update_fields=['updated_at'])

        log_audit(
            action='ADMIN_APPLICATION_DEPARTMENTS_UPDATED',
            request=request,
            actor_user=request.user,
            target_type='InternalApplication',
            target_id=app.id,
            metadata={'department_ids': department_ids},
        )

        return Response(InternalApplicationSerializer(app).data)


class AdminApplicationOverridesCreateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def post(self, request, application_id):
        app = InternalApplication.objects.filter(id=application_id).first()
        if not app:
            return Response({'detail': 'Application not found.'}, status=status.HTTP_404_NOT_FOUND)

        serializer = AccessOverrideCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = User.objects.filter(id=serializer.validated_data['user_id']).first()
        if not user:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        override, _created = ApplicationAccessOverride.objects.update_or_create(
            application=app,
            user=user,
            defaults={
                'effect': serializer.validated_data['effect'],
                'reason': serializer.validated_data.get('reason', ''),
                'expires_at': serializer.validated_data.get('expires_at'),
            },
        )

        log_audit(
            action='ADMIN_APPLICATION_OVERRIDE_UPSERTED',
            request=request,
            actor_user=request.user,
            target_type='ApplicationAccessOverride',
            target_id=override.id,
            metadata={'application_id': app.id, 'user_id': user.id, 'effect': override.effect},
        )

        return Response(AccessOverrideSerializer(override).data, status=status.HTTP_201_CREATED)


class AdminApplicationOverrideDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def delete(self, request, application_id, override_id):
        app = InternalApplication.objects.filter(id=application_id).first()
        if not app:
            return Response({'detail': 'Application not found.'}, status=status.HTTP_404_NOT_FOUND)

        override = ApplicationAccessOverride.objects.filter(id=override_id, application=app).first()
        if not override:
            return Response({'detail': 'Override not found.'}, status=status.HTTP_404_NOT_FOUND)

        deleted_override_id = override.id
        override.delete()

        log_audit(
            action='ADMIN_APPLICATION_OVERRIDE_DELETED',
            request=request,
            actor_user=request.user,
            target_type='ApplicationAccessOverride',
            target_id=deleted_override_id,
            metadata={'application_id': app.id},
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


class AdminAuditLogListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def get(self, request):
        logs = AuditLog.objects.select_related('actor_user').all().order_by('-created_at')

        action = request.query_params.get('action')
        target_type = request.query_params.get('target_type')
        actor_user_id = request.query_params.get('actor_user_id')
        created_from = request.query_params.get('created_from')
        created_to = request.query_params.get('created_to')

        if action:
            logs = logs.filter(action=action)
        if target_type:
            logs = logs.filter(target_type=target_type)
        if actor_user_id:
            logs = logs.filter(actor_user_id=actor_user_id)
        if created_from:
            dt = parse_datetime(created_from)
            if dt:
                logs = logs.filter(created_at__gte=dt)
        if created_to:
            dt = parse_datetime(created_to)
            if dt:
                logs = logs.filter(created_at__lte=dt)

        return Response(AuditLogSerializer(logs, many=True).data)


class AdminAuditLogDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def get(self, _request, log_id):
        log = AuditLog.objects.select_related('actor_user').filter(id=log_id).first()
        if not log:
            return Response({'detail': 'Audit log not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(AuditLogSerializer(log).data)
