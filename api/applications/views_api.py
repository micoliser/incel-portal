from django.contrib.auth.models import User
from django.core.paginator import EmptyPage, Paginator
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
    ApplicationLogoUploadUrlSerializer,
    InternalApplicationSerializer,
    InternalApplicationWriteSerializer,
    SetApplicationDepartmentsSerializer,
)
from applications.s3 import (
    ApplicationLogoUploadError,
    delete_application_logo_by_public_url,
    generate_application_logo_upload_url,
)
from common.access import can_user_access_application
from common.permissions import IsAdminUser, IsGlobalAccessUser, has_global_access
from organization.models import Department


class ApplicationListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        applications = InternalApplication.objects.all().order_by('name')
        page_value = request.query_params.get('page')

        search_query = request.query_params.get('q', '').strip()
        if search_query:
            applications = applications.filter(name__icontains=search_query)

        department_id = request.query_params.get('department_id', '').strip()
        if department_id and department_id.lower() != 'all' and has_global_access(request.user):
            if department_id.isdigit():
                applications = applications.filter(departments__id=int(department_id)).distinct()

        department_ids_raw = request.query_params.get('department_ids', '').strip()
        if department_ids_raw and has_global_access(request.user):
            parsed_ids = []
            for value in department_ids_raw.split(','):
                cleaned = value.strip()
                if cleaned.isdigit():
                    parsed_ids.append(int(cleaned))
            if parsed_ids:
                applications = applications.filter(departments__id__in=parsed_ids).distinct()

        accessible_raw = request.query_params.get('accessible', '').strip().lower()
        accessible_only = accessible_raw in {'1', 'true', 'yes'}

        if page_value is not None:
            if accessible_only:
                filtered_data = []
                for app in applications:
                    can_access, reason = can_user_access_application(request.user, app)
                    if not can_access:
                        continue
                    item = InternalApplicationSerializer(app).data
                    item['can_access'] = can_access
                    item['access_reason'] = reason
                    filtered_data.append(item)

                paginator = Paginator(filtered_data, 15)
            else:
                paginator = Paginator(applications, 15)

            try:
                page_number = int(page_value)
            except (TypeError, ValueError):
                page_number = 1

            if page_number < 1:
                page_number = 1

            try:
                page_obj = paginator.page(page_number)
            except EmptyPage:
                if paginator.count == 0:
                    page_number = 1
                    page_obj = paginator.page(1)
                else:
                    page_number = paginator.num_pages
                    page_obj = paginator.page(page_number)

            data = []
            if accessible_only:
                data = list(page_obj.object_list)
            else:
                for app in page_obj.object_list:
                    item = InternalApplicationSerializer(app).data
                    can_access, reason = can_user_access_application(request.user, app)
                    item['can_access'] = can_access
                    item['access_reason'] = reason
                    data.append(item)

            return Response(
                {
                    'count': paginator.count,
                    'page': page_number,
                    'page_size': 15,
                    'total_pages': paginator.num_pages,
                    'next_page': page_number + 1 if page_obj.has_next() else None,
                    'previous_page': page_number - 1 if page_obj.has_previous() else None,
                    'results': data,
                }
            )

        data = []
        for app in applications:
            item = InternalApplicationSerializer(app).data
            can_access, reason = can_user_access_application(request.user, app)
            if accessible_only and not can_access:
                continue
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


class AdminApplicationLogoUploadUrlView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def post(self, request):
        serializer = ApplicationLogoUploadUrlSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            payload = generate_application_logo_upload_url(
                slug=serializer.validated_data['slug'],
                file_name=serializer.validated_data['file_name'],
                content_type=serializer.validated_data['content_type'],
            )
        except ApplicationLogoUploadError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(payload)


class AdminApplicationUpdateDeleteView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def patch(self, request, application_id):
        app = InternalApplication.objects.filter(id=application_id).first()
        if not app:
            return Response({'detail': 'Application not found.'}, status=status.HTTP_404_NOT_FOUND)

        previous_logo_url = app.logo_url
        serializer = InternalApplicationWriteSerializer(app, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)

        department_ids = serializer.validated_data.pop('department_ids', None)
        for key, value in serializer.validated_data.items():
            setattr(app, key, value)
        app.save()

        if previous_logo_url and app.logo_url != previous_logo_url:
            try:
                delete_application_logo_by_public_url(previous_logo_url)
            except ApplicationLogoUploadError as exc:
                app.logo_url = previous_logo_url
                app.save(update_fields=['logo_url', 'updated_at'])
                return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

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

    def get(self, _request, application_id):
        app = InternalApplication.objects.filter(id=application_id).first()
        if not app:
            return Response({'detail': 'Application not found.'}, status=status.HTTP_404_NOT_FOUND)

        overrides = ApplicationAccessOverride.objects.filter(application=app).order_by('-created_at')
        return Response(AccessOverrideSerializer(overrides, many=True).data)

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
    permission_classes = [permissions.IsAuthenticated, IsAdminUser]

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

        paginator = Paginator(logs, 30)
        page_value = request.query_params.get('page', '1')
        try:
            page_number = int(page_value)
        except (TypeError, ValueError):
            page_number = 1

        if page_number < 1:
            page_number = 1

        try:
            page_obj = paginator.page(page_number)
        except EmptyPage:
            if paginator.count == 0:
                page_number = 1
                page_obj = paginator.page(1)
            else:
                page_number = paginator.num_pages
                page_obj = paginator.page(page_number)

        return Response(
            {
                'count': paginator.count,
                'page': page_number,
                'page_size': 30,
                'total_pages': paginator.num_pages,
                'next_page': page_number + 1 if page_obj.has_next() else None,
                'previous_page': page_number - 1 if page_obj.has_previous() else None,
                'results': AuditLogSerializer(page_obj.object_list, many=True).data,
            }
        )


class AdminAuditLogDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminUser]

    def get(self, _request, log_id):
        log = AuditLog.objects.select_related('actor_user').filter(id=log_id).first()
        if not log:
            return Response({'detail': 'Audit log not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(AuditLogSerializer(log).data)
