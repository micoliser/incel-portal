import logging
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.db.models.functions import Lower
from django.utils import timezone
from rest_framework import permissions, status
from rest_framework.exceptions import AuthenticationFailed, NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import StaffProfile
from accounts.serializers import (
    AdminCreateUserSerializer,
    ChangePasswordSerializer,
    LoginSerializer,
    PasswordLinkSerializer,
    PasswordResetConfirmSerializer,
    PasswordResetRequestSerializer,
    PasswordResetValidateSerializer,
    RefreshTokenBodySerializer,
    UpdateAdminUserSerializer,
    UserWithProfileSerializer,
    with_profile,
)
from accounts.services import (
    LoginGuard,
    burn_password_check,
    revoke_user_sessions,
    send_account_setup_link,
    send_admin_password_reset_link,
    send_self_service_reset_link,
    should_log_unknown_login,
    user_for_password_link,
)
from audit import log_audit
from audit.actions import AuditAction
from common.authentication import (
    HasValidServiceApiKey,
    PublicEndpointAuthentication,
    ServiceApiKeyAuthentication,
)
from common.exceptions import AccountLocked, Conflict
from common.network import client_ip
from common.pagination import paginate
from common.params import bool_param, uuid_param
from common.permissions import (
    IsAdminOrGlobalReadOnly,
    can_manage_user,
    has_admin_access,
    has_global_access,
)
from common.viewsets import GenericViewSet
from emails.services.user_emails import UserEmailManager
from organization.models import Department, Role, Team, Unit
from organization.services import clear_leadership_left_behind

User = get_user_model()

logger = logging.getLogger(__name__)


def _profile_or_none(user):
    return getattr(user, 'staff_profile', None)


def _user_search_query(search):
    """Match a user by first name, last name, username or email.

    With several words, also match "first last" and "last first", so typing a
    full name finds the person whichever way round it is entered.
    """
    search_terms = [term for term in search.split() if term]
    search_query = (
        Q(first_name__icontains=search)
        | Q(last_name__icontains=search)
        | Q(username__icontains=search)
        | Q(email__icontains=search)
    )
    if len(search_terms) > 1:
        first = search_terms[0]
        last = ' '.join(search_terms[1:])
        search_query |= Q(first_name__icontains=first, last_name__icontains=last)
        search_query |= Q(first_name__icontains=last, last_name__icontains=first)
    return search_query


def _jwt_payload_for_user(user):
    refresh = RefreshToken.for_user(user)
    return {
        'access': str(refresh.access_token),
        'refresh': str(refresh),
    }


def _set_jwt_cookies(response, tokens):
    """Tokens travel only in HttpOnly cookies, never in a response body, so
    script running in the page cannot read them."""
    secure = not settings.DEBUG
    response.set_cookie(
        'access_token',
        tokens['access'],
        max_age=settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'].total_seconds(),
        httponly=True,
        secure=secure,
        samesite='Lax',
    )
    if 'refresh' in tokens:
        response.set_cookie(
            'refresh_token',
            tokens['refresh'],
            max_age=settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds(),
            httponly=True,
            secure=secure,
            samesite='Lax',
        )
    return response


def _clear_jwt_cookies(response):
    response.delete_cookie('access_token')
    response.delete_cookie('refresh_token')
    return response


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = [PublicEndpointAuthentication]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data['email'].strip().lower()
        password = serializer.validated_data['password']
        ip = client_ip(request)

        guard = LoginGuard(email, ip)
        if guard.is_locked():
            raise AccountLocked(wait=settings.LOGIN_LOCKOUT_SECONDS)

        user = User.objects.filter(email__iexact=email).first()
        if user is None:
            burn_password_check(password)
            if should_log_unknown_login(email, ip):
                log_audit(
                    action=AuditAction.AUTH_LOGIN_FAILED,
                    request=request,
                    target_type='User',
                    metadata={'email': email},
                )
            raise AuthenticationFailed(
                {'detail': 'Invalid credentials.', 'attempts_remaining': guard.record_failure()}
            )

        # The password is checked before the account status, so only someone
        # who knows the password learns that an account is disabled.
        if not user.check_password(password):
            log_audit(
                action=AuditAction.AUTH_LOGIN_FAILED,
                request=request,
                target_type='User',
                target_id=user.id,
                metadata={'email': email},
            )
            raise AuthenticationFailed(
                {'detail': 'Invalid credentials.', 'attempts_remaining': guard.record_failure()}
            )

        if not user.is_active:
            log_audit(
                action=AuditAction.AUTH_LOGIN_FAILED,
                request=request,
                target_type='User',
                target_id=user.id,
                metadata={'email': email, 'reason': 'disabled_account'},
            )
            raise PermissionDenied('This account has been disabled, contact HR or Admin.')

        guard.record_success()

        tokens = _jwt_payload_for_user(user)
        log_audit(
            action=AuditAction.AUTH_LOGIN_SUCCESS,
            request=request,
            actor_user=user,
            target_type='User',
            target_id=user.id,
        )
        response = Response({'user': UserWithProfileSerializer(user).data})
        return _set_jwt_cookies(response, tokens)


def _refresh_token_from(request) -> str:
    """The refresh token from the body if one is sent, else the cookie.

    A malformed body is ignored, as before, so signing out always works and
    the portal (which sends no body) is unaffected.
    """
    body = RefreshTokenBodySerializer(data=request.data)
    from_body = body.validated_data.get('refresh', '') if body.is_valid() else ''
    return from_body or request.COOKIES.get('refresh_token') or ''


class LogoutView(APIView):
    """Signing out must work even when the access token has already expired,
    so this endpoint identifies the session by its refresh token alone."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = [PublicEndpointAuthentication]

    def post(self, request):
        refresh_token = _refresh_token_from(request)

        if refresh_token:
            try:
                token = RefreshToken(refresh_token)
                user = User.objects.filter(pk=token.get('user_id')).first()
                token.blacklist()
            except TokenError:
                # Already expired or revoked: there is nothing left to end.
                user = None

            if user is not None:
                log_audit(
                    action=AuditAction.AUTH_LOGOUT,
                    request=request,
                    actor_user=user,
                    target_type='User',
                    target_id=user.id,
                )

        return _clear_jwt_cookies(Response(status=status.HTTP_204_NO_CONTENT))


class RefreshTokenView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = [PublicEndpointAuthentication]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'refresh'

    def post(self, request):
        refresh_token = _refresh_token_from(request)
        if not refresh_token:
            raise AuthenticationFailed('Refresh token required.')

        try:
            token = RefreshToken(refresh_token)
        except TokenError:
            return self._rejected('Invalid or blacklisted refresh token.')

        user = User.objects.filter(pk=token.get('user_id')).select_related('staff_profile').first()
        if user is None or not user.is_active:
            self._blacklist(token)
            return self._rejected('Invalid or blacklisted refresh token.')

        # Server-side inactivity timeout: after an hour without activity the
        # session ends and a full sign-in is required.
        profile = _profile_or_none(user)
        if profile is not None:
            last = profile.last_activity_at
            if last is None:
                profile.last_activity_at = timezone.now()
                profile.save(update_fields=['last_activity_at'])
            elif timezone.now() - last > timedelta(hours=1):
                self._blacklist(token)
                return self._rejected('Session expired due to inactivity.')

        serializer = TokenRefreshSerializer(data={'refresh': refresh_token})
        try:
            serializer.is_valid(raise_exception=True)
        except (TokenError, AuthenticationFailed):
            return self._rejected('Invalid or blacklisted refresh token.')

        response = Response({'detail': 'Session refreshed.'})
        return _set_jwt_cookies(response, serializer.validated_data)

    @staticmethod
    def _blacklist(token):
        try:
            token.blacklist()
        except TokenError:
            pass

    @staticmethod
    def _rejected(message):
        response = Response(
            {'error': {'type': 'authentication_error', 'message': message}},
            status=status.HTTP_401_UNAUTHORIZED,
        )
        return _clear_jwt_cookies(response)


class HeartbeatView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        profile = _profile_or_none(request.user)
        if profile is not None:
            profile.last_activity_at = timezone.now()
            profile.save(update_fields=['last_activity_at'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={'user': request.user})
        serializer.is_valid(raise_exception=True)

        old_password = serializer.validated_data['old_password']
        new_password = serializer.validated_data['new_password']

        if not request.user.check_password(old_password):
            log_audit(
                action=AuditAction.AUTH_PASSWORD_CHANGE_FAILED,
                request=request,
                actor_user=request.user,
                target_type='User',
                target_id=request.user.id,
                metadata={'reason': 'incorrect_old_password'},
            )
            raise ValidationError('Old password is incorrect.')

        request.user.set_password(new_password)
        request.user.save(update_fields=['password'])

        # Every other session ends; this browser gets a fresh one below.
        revoke_user_sessions(request.user)

        try:
            UserEmailManager.send_password_changed_email(request.user, action='changed')
        except Exception:
            logger.exception('Failed to send password changed email')

        tokens = _jwt_payload_for_user(request.user)
        log_audit(
            action=AuditAction.AUTH_PASSWORD_CHANGED,
            request=request,
            actor_user=request.user,
            target_type='User',
            target_id=request.user.id,
        )
        response = Response({'detail': 'Password changed.'})
        return _set_jwt_cookies(response, tokens)


class PasswordResetRequestView(APIView):
    """The response is the same whether or not the email has an account, so the
    endpoint cannot be used to find out which staff emails exist."""

    permission_classes = [permissions.AllowAny]
    authentication_classes = [PublicEndpointAuthentication]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    RESPONSE = {'detail': 'If an account exists for this email, a password reset link has been sent.'}

    def post(self, request):
        serializer = PasswordResetRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data['email']
        ip = client_ip(request)

        user = User.objects.filter(email__iexact=email).first()
        if user is None or not user.is_active:
            if should_log_unknown_login(f'reset:{email}', ip):
                log_audit(
                    action=AuditAction.AUTH_PASSWORD_RESET_FAILED,
                    request=request,
                    target_type='User',
                    target_id=user.id if user else '',
                    metadata={'reason': 'user_inactive' if user else 'user_not_found', 'email': email},
                )
            return Response(self.RESPONSE)

        try:
            sent = send_self_service_reset_link(user)
        except Exception:
            logger.exception('Failed to send password reset email')
            sent = True

        if not sent:
            log_audit(
                action=AuditAction.AUTH_PASSWORD_RESET_FAILED,
                request=request,
                target_type='User',
                target_id=user.id,
                metadata={'reason': 'too_many_requests', 'email': user.email},
            )
            return Response(self.RESPONSE)

        log_audit(
            action=AuditAction.AUTH_PASSWORD_RESET_REQUESTED,
            request=request,
            target_type='User',
            target_id=user.id,
            metadata={'email': user.email},
        )
        return Response(self.RESPONSE)


class PasswordResetValidateView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = [PublicEndpointAuthentication]

    def get(self, request):
        serializer = PasswordResetValidateSerializer(data=request.query_params)
        user = None
        if serializer.is_valid():
            user = user_for_password_link(serializer.validated_data['uid'], serializer.validated_data['token'])

        if user is None:
            return Response(
                {'valid': False, 'detail': 'This password reset link is invalid or has expired.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user_email = user.email or ''
        if '@' in user_email:
            name_part, domain_part = user_email.split('@', 1)
            masked_name = name_part[:2] + '***' if len(name_part) > 2 else name_part + '***'
            masked_email = f"{masked_name}@{domain_part}"
        else:
            masked_email = '***'

        return Response({'valid': True, 'email': masked_email})


class PasswordResetConfirmView(APIView):
    permission_classes = [permissions.AllowAny]
    authentication_classes = [PublicEndpointAuthentication]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'login'

    def post(self, request):
        link = PasswordLinkSerializer(data=request.data)
        user = (
            user_for_password_link(link.validated_data['uid'], link.validated_data['token'])
            if link.is_valid() else None
        )

        if user is None:
            log_audit(
                action=AuditAction.AUTH_PASSWORD_RESET_FAILED,
                request=request,
                target_type='User',
                metadata={'reason': 'invalid_or_expired_token'},
            )
            raise ValidationError('This password reset link is invalid or has expired.')

        serializer = PasswordResetConfirmSerializer(data=request.data, context={'user': user})
        serializer.is_valid(raise_exception=True)

        user.set_password(serializer.validated_data['new_password'])
        user.save(update_fields=['password'])
        revoke_user_sessions(user)

        log_audit(
            action=AuditAction.AUTH_PASSWORD_RESET_COMPLETED,
            request=request,
            target_type='User',
            target_id=user.id,
            metadata={'email': user.email},
        )

        try:
            UserEmailManager.send_password_changed_email(user, action='reset')
        except Exception:
            logger.exception('Failed to send password changed email')

        return Response(
            {'detail': 'Your password has been successfully reset. You can now log in with your new password.'}
        )


class MeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(UserWithProfileSerializer(request.user).data)


class MePermissionsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        profile = _profile_or_none(request.user)
        role_code = profile.role.code if profile and profile.role else None
        department_id = profile.department_id if profile else None

        return Response(
            {
                'is_superuser': request.user.is_superuser,
                'has_global_access': has_global_access(request.user),
                'role_code': role_code,
                'department_id': department_id,
            }
        )


def _save_unique_email(user, **kwargs):
    """Save, turning a clash on the unique email index (two requests at once
    for the same address) into the same message the serializer gives."""
    try:
        with transaction.atomic():
            user.save(**kwargs)
    except IntegrityError:
        raise ValidationError({'email': ['A user with this email already exists.']})


def _can_see_all_users(user):
    return has_admin_access(user) or has_global_access(user)


def _default_staff_role():
    role, _created = Role.objects.get_or_create(
        code='STAFF',
        defaults={'name': 'Staff', 'has_global_access': False, 'is_active': True},
    )
    return role


def _require_can_manage(request, target):
    if can_manage_user(request.user, target):
        return
    log_audit(
        action=AuditAction.ADMIN_USER_ACTION_DENIED,
        request=request,
        actor_user=request.user,
        target_type='User',
        target_id=target.id,
        metadata={'email': target.email, 'reason': 'target_outranks_actor'},
    )
    raise PermissionDenied('Only a superuser can manage this account.')


class UserViewSet(GenericViewSet):
    """The staff directory and user management.

    list: every signed-in user sees active users. Administrators and
    executives may add `include_inactive=true` to see deactivated accounts too.
    create: administrators only.
    retrieve: administrators and executives. partial_update: administrators only.
    PATCH changes only the fields sent: the profile, role, organization
    placement, activation (`is_active`) and sending a password reset link
    (`send_reset_link`).
    """

    lookup_url_kwarg = 'user_id'
    lookup_value_regex = '[0-9]+'

    def get_permissions(self):
        if self.action in ('retrieve', 'partial_update'):
            return [permissions.IsAuthenticated(), IsAdminOrGlobalReadOnly()]
        return [permissions.IsAuthenticated()]

    def get_throttles(self):
        if self.action in ('create', 'retrieve', 'partial_update'):
            self.throttle_scope = 'admin'
            return [ScopedRateThrottle()]
        return super().get_throttles()

    def _get_user(self, user_id):
        user = with_profile(User.objects.filter(id=user_id)).first()
        if not user:
            raise NotFound('User not found.')
        return user

    def list(self, request):
        users = with_profile(User.objects.all())

        include_inactive = bool_param(request.query_params, 'include_inactive')
        if not (include_inactive and _can_see_all_users(request.user)):
            users = users.filter(is_active=True)

        department_id = uuid_param(request.query_params, 'department_id')
        if department_id:
            users = users.filter(staff_profile__department_id=department_id)

        unit_id = uuid_param(request.query_params, 'unit_id')
        if unit_id:
            users = users.filter(staff_profile__unit_id=unit_id)

        team_id = uuid_param(request.query_params, 'team_id')
        if team_id:
            users = users.filter(staff_profile__team_id=team_id)

        unassigned = request.query_params.get('unassigned')
        if unassigned == 'department':
            users = users.filter(staff_profile__department__isnull=True)
        elif unassigned == 'unit':
            users = users.filter(staff_profile__unit__isnull=True)
        elif unassigned == 'team':
            users = users.filter(staff_profile__team__isnull=True)
        elif unassigned:
            raise ValidationError({'unassigned': 'Use department, unit or team.'})

        search = (request.query_params.get('search') or '').strip()
        if search:
            users = users.filter(_user_search_query(search))

        users = users.order_by(Lower('username'))

        return paginate(users, request, UserWithProfileSerializer, view=self)

    @transaction.atomic
    def create(self, request):
        if not has_admin_access(request.user):
            raise PermissionDenied()

        serializer = AdminCreateUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        email = data['email']
        department = Department.objects.filter(id=data['department_id']).first() if data.get('department_id') else None
        unit = Unit.objects.filter(id=data['unit_id']).first() if data.get('unit_id') else None
        team = Team.objects.filter(id=data['team_id']).first() if data.get('team_id') else None
        role = Role.objects.filter(id=data['role_id']).first() if data.get('role_id') else None
        if not role:
            role = _default_staff_role()

        # No password is set here. The new user chooses their own through the
        # link emailed below, so no one else ever knows it.
        user = User(
            username=email,
            email=email,
            first_name=data['first_name'],
            last_name=data['last_name'],
            is_active=True,
        )
        user.set_unusable_password()
        _save_unique_email(user)

        StaffProfile.objects.create(
            user=user,
            role=role,
            department=department,
            unit=unit,
            team=team,
            is_active=True,
        )

        try:
            send_account_setup_link(user)
        except Exception:
            # User creation should not fail if email delivery fails; an
            # administrator can send the link again from the edit dialog.
            logger.exception('Failed to send account setup email')

        log_audit(
            action=AuditAction.ADMIN_USER_CREATED,
            request=request,
            actor_user=request.user,
            target_type='User',
            target_id=user.id,
            metadata={
                'email': email,
                'role_id': role.id,
                'role_code': role.code,
                'role_name': role.name,
                'department_id': department.id if department else None,
                'department_name': department.name if department else None,
                'unit_id': unit.id if unit else None,
                'team_id': team.id if team else None,
            },
        )

        return Response(UserWithProfileSerializer(user).data, status=status.HTTP_201_CREATED)

    def retrieve(self, _request, user_id):
        return Response(UserWithProfileSerializer(self._get_user(int(user_id))).data)

    def partial_update(self, request, user_id):
        user_id = int(user_id)
        user = self._get_user(user_id)
        # Checked outside the transaction below, so the record of a refused
        # attempt is kept.
        _require_can_manage(request, user)
        return self._update(request, user, user_id)

    @transaction.atomic
    def _update(self, request, user, user_id):
        serializer = UpdateAdminUserSerializer(data=request.data, context={'user_id': user_id})
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        is_self = user.pk == request.user.pk

        if 'role_id' in data and is_self:
            current_role_id = getattr(_profile_or_none(user), 'role_id', None)
            if data['role_id'] != current_role_id:
                raise PermissionDenied('You cannot change your own role.')

        if 'is_active' in data and data['is_active'] != user.is_active:
            if is_self:
                raise PermissionDenied('You cannot change the status of your own account.')
            if not data['is_active'] and user.is_superuser:
                others = User.objects.filter(is_superuser=True, is_active=True).exclude(pk=user.pk)
                if not others.exists():
                    raise Conflict('The last active superuser cannot be deactivated.')

        # --- account fields ---
        user_fields = []
        if 'email' in data and data['email'] != user.email:
            user.email = data['email']
            user.username = data['email']
            user_fields += ['email', 'username']
        for field in ('first_name', 'last_name'):
            if field in data and data[field] != getattr(user, field):
                setattr(user, field, data[field])
                user_fields.append(field)
        if user_fields:
            _save_unique_email(user, update_fields=user_fields)

        # --- profile fields: only the keys that were sent are touched ---
        profile_changes = {}
        if 'department_id' in data:
            profile_changes['department'] = (
                Department.objects.filter(id=data['department_id']).first() if data['department_id'] else None
            )
        if 'unit_id' in data:
            profile_changes['unit'] = Unit.objects.filter(id=data['unit_id']).first() if data['unit_id'] else None
        if 'team_id' in data:
            profile_changes['team'] = Team.objects.filter(id=data['team_id']).first() if data['team_id'] else None
        if data.get('role_id'):
            profile_changes['role'] = Role.objects.filter(id=data['role_id']).first()

        profile = _profile_or_none(user)
        if profile is None:
            profile = StaffProfile.objects.create(
                user=user,
                role=profile_changes.get('role') or _default_staff_role(),
                department=profile_changes.get('department'),
                unit=profile_changes.get('unit'),
                team=profile_changes.get('team'),
                is_active=user.is_active,
            )
        elif profile_changes:
            previous = {
                'old_department_id': profile.department_id,
                'old_unit_id': profile.unit_id,
                'old_team_id': profile.team_id,
            }
            for field, value in profile_changes.items():
                setattr(profile, field, value)
            # The team must sit in the unit, and the unit in the department.
            # (Raises Django's ValidationError, which the API reports as a 400.)
            profile.clean()
            profile.save(update_fields=['department', 'unit', 'team', 'role', 'updated_at'])
            clear_leadership_left_behind(user, profile=profile, **previous)

        if user_fields or profile_changes:
            role = profile.role
            department = profile.department
            log_audit(
                action=AuditAction.ADMIN_USER_UPDATED,
                request=request,
                actor_user=request.user,
                target_type='User',
                target_id=user.id,
                metadata={
                    'email': user.email,
                    'department_id': department.id if department else None,
                    'department_name': department.name if department else None,
                    'role_id': role.id if role else None,
                    'role_code': role.code if role else None,
                    'role_name': role.name if role else None,
                },
            )

        # --- activation ---
        if 'is_active' in data and data['is_active'] != user.is_active:
            user.is_active = data['is_active']
            user.save(update_fields=['is_active'])
            profile.is_active = data['is_active']
            profile.save(update_fields=['is_active', 'updated_at'])
            if not user.is_active:
                revoke_user_sessions(user)
            log_audit(
                action=AuditAction.ADMIN_USER_STATUS_UPDATED,
                request=request,
                actor_user=request.user,
                target_type='User',
                target_id=user.id,
                metadata={'is_active': user.is_active, 'email': user.email},
            )

        # --- password reset link ---
        if data.get('send_reset_link'):
            if not user.is_active:
                raise ValidationError({'send_reset_link': 'Activate the account before sending a reset link.'})
            log_audit(
                action=AuditAction.ADMIN_USER_PASSWORD_RESET,
                request=request,
                actor_user=request.user,
                target_type='User',
                target_id=user.id,
                metadata={'email': user.email, 'method': 'reset_link'},
            )
            try:
                send_admin_password_reset_link(user)
            except Exception:
                logger.exception('Failed to send password reset email')

        return Response(UserWithProfileSerializer(user).data)


class ExternalUserListView(APIView):
    """
    Endpoint for authorized external applications to query users in the workspace.
    Authentication: Standard Bearer Token (Authorization: Bearer <service_api_key>)
    Returns an unpaginated array of user objects.
    Defaults to active users in the workspace.
    Supports ?is_active=true|false|all to filter or retrieve all users.
    """
    authentication_classes = [ServiceApiKeyAuthentication]
    permission_classes = [HasValidServiceApiKey]
    required_scope = 'users:read'
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'service'

    def get(self, request):
        users = with_profile(User.objects.all())

        is_active_param = request.query_params.get('is_active')
        if is_active_param is not None:
            val = is_active_param.strip().lower()
            if val in ('true', '1'):
                users = users.filter(is_active=True)
            elif val in ('false', '0'):
                users = users.filter(is_active=False)
            elif val == 'all':
                pass
        else:
            users = users.filter(is_active=True)

        users = users.order_by(Lower('username'))

        serializer = UserWithProfileSerializer(users, many=True)
        return Response(serializer.data)
