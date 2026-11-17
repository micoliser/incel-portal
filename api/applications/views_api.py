from django.contrib.auth.models import User
from django.db import transaction
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from applications.audit import log_audit
from applications.audit_actions import AuditAction
from applications.models import (
    ApplicationAccessOverride,
    AuditLog,
    InternalApplication,
    RecentApplication,
)
from applications.s3 import (
    ApplicationLogoUploadError,
    delete_application_logo_by_public_url,
    generate_application_logo_upload_url,
)
from applications.serializers import (
    AccessOverrideCreateSerializer,
    AccessOverrideSerializer,
    ApplicationLogoUploadUrlSerializer,
    AuditLogSerializer,
    InternalApplicationSerializer,
    InternalApplicationWriteSerializer,
    RecentApplicationSerializer,
)
from common.access import access_for_applications, can_user_access_application, visible_applications
from common.pagination import page_size, paginate
from common.params import bool_param, datetime_param, int_param, list_param, uuid_value
from common.permissions import (
    IsAdminOrGlobalAccessUser,
    IsAdminUser,
    has_admin_access,
    has_global_access,
)
from emails.services.application_emails import ApplicationEmailManager
from emails.utils import EmailNotificationHelper
from organization.models import Department


def _dedupe_emails(emails):
    return list(dict.fromkeys(email for email in emails if email))


def _department_user_emails(department_ids):
    emails = []
    for department_id in department_ids:
        emails.extend(EmailNotificationHelper.get_department_users(department_id))
    return _dedupe_emails(emails)


def _users_who_lost_application_access(application, user_emails):
    users_to_notify = []
    for user_email in user_emails:
        user = EmailNotificationHelper.get_user_by_email(user_email)
        if not user:
            continue

        can_access, _reason = can_user_access_application(user, application)
        if not can_access:
            users_to_notify.append(user_email)

    return _dedupe_emails(users_to_notify)


def _notify_department_access_changes(application, previous_department_ids, department_ids):
    """Email the departments that gained access, and the people who lost it."""
    added_department_ids = [
        department_id for department_id in department_ids if department_id not in previous_department_ids
    ]
    if added_department_ids:
        recipient_emails = _department_user_emails(added_department_ids)
        if recipient_emails:
            ApplicationEmailManager.send_departmental_access_emails(application, recipient_emails)

    removed_department_ids = [
        department_id for department_id in previous_department_ids if department_id not in department_ids
    ]
    if removed_department_ids:
        recipient_emails = _department_user_emails(removed_department_ids)
        recipient_emails = _users_who_lost_application_access(application, recipient_emails)
        if recipient_emails:
            ApplicationEmailManager.send_departmental_access_revoked_emails(application, recipient_emails)


ApplicationPagination = page_size(15)
AuditLogPagination = page_size(30)


def _application_or_404(request, application_id):
    """An application the caller is allowed to know about."""
    app = visible_applications(request.user).filter(id=application_id).first()
    if not app:
        raise NotFound('Application not found.')
    return app


def _serialize_applications(request, applications, many=True):
    applications = list(applications) if many else [applications]
    context = {
        'request': request,
        'access': access_for_applications(request.user, applications),
        # Administrators manage applications they may not themselves use.
        'show_all_urls': has_admin_access(request.user),
    }
    data = InternalApplicationSerializer(applications, many=True, context=context).data
    return data if many else data[0]


def _set_departments(app, department_ids):
    departments = list(Department.objects.filter(id__in=department_ids))
    if len(departments) != len(set(department_ids)):
        raise ValidationError({'department_ids': 'One or more department IDs are invalid.'})
    app.departments.set(departments)


class ApplicationListView(APIView):
    """GET: the applications the caller may see. POST: create one (administrators)."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        applications = visible_applications(request.user).prefetch_related('departments').order_by('name')

        search = (request.query_params.get('search') or '').strip()
        if search:
            applications = applications.filter(name__icontains=search)

        # Executives and administrators can narrow the list to some departments.
        department_ids = list_param(request.query_params, 'department_id', uuid_value)
        if department_ids and (has_global_access(request.user) or has_admin_access(request.user)):
            applications = applications.filter(departments__id__in=department_ids).distinct()

        applications = list(applications)
        access = access_for_applications(request.user, applications)
        if bool_param(request.query_params, 'accessible'):
            applications = [app for app in applications if access[app.id][0]]

        paginator = ApplicationPagination()
        page = paginator.paginate_queryset(applications, request, view=self)
        context = {'request': request, 'access': access, 'show_all_urls': has_admin_access(request.user)}
        return paginator.get_paginated_response(InternalApplicationSerializer(page, many=True, context=context).data)

    def post(self, request):
        if not has_admin_access(request.user):
            raise PermissionDenied()

        serializer = InternalApplicationWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        department_ids = serializer.validated_data.pop('department_ids', [])

        with transaction.atomic():
            app = InternalApplication.objects.create(**serializer.validated_data)
            if department_ids:
                _set_departments(app, department_ids)

        ApplicationEmailManager.send_application_created_to_users(app)

        log_audit(
            action=AuditAction.ADMIN_APPLICATION_CREATED,
            request=request,
            actor_user=request.user,
            target_type='InternalApplication',
            target_id=app.id,
            metadata={
                'application_id': app.id,
                'application_name': app.name,
                'department_ids': department_ids,
            },
        )

        return Response(_serialize_applications(request, app, many=False), status=status.HTTP_201_CREATED)


class ApplicationDetailView(APIView):
    """GET: anyone who may see the application. PATCH and DELETE: administrators."""

    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, application_id):
        app = _application_or_404(request, application_id)
        return Response(_serialize_applications(request, app, many=False))

    @transaction.atomic
    def patch(self, request, application_id):
        if not has_admin_access(request.user):
            raise PermissionDenied()
        app = _application_or_404(request, application_id)

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
                raise ValidationError({'logo_url': str(exc)})

        if department_ids is not None:
            previous_department_ids = list(app.departments.values_list('id', flat=True))
            _set_departments(app, department_ids)
            _notify_department_access_changes(app, previous_department_ids, department_ids)

        log_audit(
            action=AuditAction.ADMIN_APPLICATION_UPDATED,
            request=request,
            actor_user=request.user,
            target_type='InternalApplication',
            target_id=app.id,
            metadata={
                'application_id': app.id,
                'application_name': app.name,
                'department_ids': department_ids,
            },
        )

        return Response(_serialize_applications(request, app, many=False))

    def delete(self, request, application_id):
        """Deleting hides the application and switches it off; its history is kept."""
        if not has_admin_access(request.user):
            raise PermissionDenied()
        app = _application_or_404(request, application_id)

        app.status = InternalApplication.Status.INACTIVE
        app.visibility_scope = InternalApplication.VisibilityScope.HIDDEN
        app.save(update_fields=['status', 'visibility_scope', 'updated_at'])

        log_audit(
            action=AuditAction.ADMIN_APPLICATION_SOFT_DELETED,
            request=request,
            actor_user=request.user,
            target_type='InternalApplication',
            target_id=app.id,
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


class ApplicationCanAccessView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, application_id):
        app = _application_or_404(request, application_id)
        can_access, reason = can_user_access_application(request.user, app)
        return Response({'application_id': app.id, 'can_access': can_access, 'reason': reason})


class ApplicationOpenView(APIView):
    """Records that the caller opened an application and returns its address."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, application_id):
        app = _application_or_404(request, application_id)

        can_access, reason = can_user_access_application(request.user, app)
        if can_access and app.status == InternalApplication.Status.INACTIVE:
            can_access, reason = False, 'This application is inactive.'

        log_audit(
            action=AuditAction.APPLICATION_OPEN_GRANTED if can_access else AuditAction.APPLICATION_OPEN_DENIED,
            request=request,
            actor_user=request.user,
            target_type='InternalApplication',
            target_id=app.id,
            metadata={'reason': reason},
        )

        if not can_access:
            raise PermissionDenied(reason)

        RecentApplication.objects.update_or_create(
            user=request.user,
            application=app,
            defaults={'opened_at': timezone.now()},
        )

        # Keep only the four most recent per user.
        ids_to_keep = list(
            RecentApplication.objects.filter(user=request.user)
            .order_by('-opened_at')
            .values_list('id', flat=True)[:4]
        )
        if ids_to_keep:
            RecentApplication.objects.filter(user=request.user).exclude(id__in=ids_to_keep).delete()

        return Response({'application_id': app.id, 'url': app.app_url})


class RecentApplicationsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        recent = list(
            RecentApplication.objects.filter(
                user=request.user,
                application__in=visible_applications(request.user),
            )
            .select_related('application')
            .prefetch_related('application__departments')
            .order_by('-opened_at')[:4]
        )
        context = {
            'request': request,
            'access': access_for_applications(request.user, [item.application for item in recent]),
            'show_all_urls': has_admin_access(request.user),
        }
        return Response(RecentApplicationSerializer(recent, many=True, context=context).data)


class ApplicationLogoUploadUrlView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminUser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'uploads'

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
            raise ValidationError(str(exc))

        return Response(payload)


class ApplicationOverrideListView(APIView):
    """Per-person exceptions to an application's access rule. Administrators only."""

    permission_classes = [permissions.IsAuthenticated, IsAdminUser]

    def get(self, request, application_id):
        app = _application_or_404(request, application_id)
        overrides = (
            ApplicationAccessOverride.objects.filter(application=app).select_related('user').order_by('-created_at')
        )
        return Response(AccessOverrideSerializer(overrides, many=True).data)

    def post(self, request, application_id):
        """Set the exception for one person (replacing any they already have)."""
        app = _application_or_404(request, application_id)

        serializer = AccessOverrideCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = User.objects.filter(id=serializer.validated_data['user_id']).first()
        if not user:
            raise NotFound('User not found.')

        override, created = ApplicationAccessOverride.objects.update_or_create(
            application=app,
            user=user,
            defaults={
                'effect': serializer.validated_data['effect'],
                'reason': serializer.validated_data.get('reason', ''),
                'expires_at': serializer.validated_data.get('expires_at'),
            },
        )

        log_audit(
            action=AuditAction.ADMIN_APPLICATION_OVERRIDE_UPSERTED,
            request=request,
            actor_user=request.user,
            target_type='ApplicationAccessOverride',
            target_id=override.id,
            metadata={
                'application_id': app.id,
                'application_name': app.name,
                'user_id': user.id,
                'user_email': user.email,
                'effect': override.effect,
            },
        )

        return Response(
            AccessOverrideSerializer(override).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class ApplicationOverrideDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminUser]

    def delete(self, request, application_id, override_id):
        app = _application_or_404(request, application_id)

        override = ApplicationAccessOverride.objects.filter(id=override_id, application=app).first()
        if not override:
            raise NotFound('Override not found.')

        deleted_override_id = override.id
        override.delete()

        log_audit(
            action=AuditAction.ADMIN_APPLICATION_OVERRIDE_DELETED,
            request=request,
            actor_user=request.user,
            target_type='ApplicationAccessOverride',
            target_id=deleted_override_id,
            metadata={'application_id': app.id, 'application_name': app.name},
        )

        return Response(status=status.HTTP_204_NO_CONTENT)


class AuditLogListView(APIView):
    # The audit trail holds sign-in failures, IP addresses and account changes,
    # so it is limited to administrators and executives.
    permission_classes = [permissions.IsAuthenticated, IsAdminOrGlobalAccessUser]

    def get(self, request):
        logs = AuditLog.objects.select_related('actor_user').order_by('-created_at')
        params = request.query_params

        action = params.get('action')
        if action:
            logs = logs.filter(action=action)
        target_type = params.get('target_type')
        if target_type:
            logs = logs.filter(target_type=target_type)
        actor_user_id = int_param(params, 'actor_user_id')
        if actor_user_id:
            logs = logs.filter(actor_user_id=actor_user_id)
        created_from = datetime_param(params, 'created_from')
        if created_from:
            logs = logs.filter(created_at__gte=created_from)
        created_to = datetime_param(params, 'created_to')
        if created_to:
            logs = logs.filter(created_at__lte=created_to)

        return paginate(logs, request, AuditLogSerializer, pagination_class=AuditLogPagination, view=self)


class AuditLogDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsAdminOrGlobalAccessUser]

    def get(self, _request, log_id):
        log = AuditLog.objects.select_related('actor_user').filter(id=log_id).first()
        if not log:
            raise NotFound('Audit log not found.')
        return Response(AuditLogSerializer(log).data)
