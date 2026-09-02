from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Q
from django.db.models.functions import Lower
import logging
from rest_framework import permissions, status
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken
from django.utils import timezone
from datetime import timedelta

from accounts.models import StaffProfile
from accounts.serializers import (
    AdminCreateUserSerializer,
    ChangePasswordSerializer,
    LoginSerializer,
    LogoutSerializer,
    UpdateUserDepartmentSerializer,
    UpdateUserRoleSerializer,
    UpdateUserStatusSerializer,
    UpdateAdminUserSerializer,
    UserWithProfileSerializer,
)
from applications.audit import log_audit
from applications.models import InternalApplication
from common.access import can_user_access_application
from common.permissions import IsGlobalAccessUser, has_admin_access, has_global_access
from emails.services.user_emails import UserEmailManager
from organization.models import Department, Role, Unit, Team


logger = logging.getLogger(__name__)


def _profile_or_none(user):
    return getattr(user, 'staff_profile', None)


def _jwt_payload_for_user(user):
    refresh = RefreshToken.for_user(user)
    return {
        'access': str(refresh.access_token),
        'refresh': str(refresh),
    }


class LoginView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data['email'].strip().lower()
        password = serializer.validated_data['password']

        user = User.objects.filter(email__iexact=email).first()
        if not user:
            log_audit(
                action='AUTH_LOGIN_FAILED',
                request=request,
                target_type='User',
                metadata={'email': email},
            )
            return Response({'detail': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

        if not user.is_active:
            log_audit(
                action='AUTH_LOGIN_FAILED',
                request=request,
                target_type='User',
                target_id=user.id,
                metadata={'email': email, 'reason': 'disabled_account'},
            )
            return Response(
                {'detail': 'This account has been disabled, contact HR or Admin.'},
                status=status.HTTP_403_FORBIDDEN,
            )

        authenticated = authenticate(request=request, username=user.username, password=password)
        if authenticated is None:
            log_audit(
                action='AUTH_LOGIN_FAILED',
                request=request,
                target_type='User',
                target_id=user.id,
                metadata={'email': email},
            )
            return Response({'detail': 'Invalid credentials.'}, status=status.HTTP_401_UNAUTHORIZED)

        tokens = _jwt_payload_for_user(authenticated)
        log_audit(
            action='AUTH_LOGIN_SUCCESS',
            request=request,
            actor_user=authenticated,
            target_type='User',
            target_id=authenticated.id,
        )
        return Response({'tokens': tokens, 'user': UserWithProfileSerializer(authenticated).data})


class LogoutView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        refresh_token = serializer.validated_data['refresh']

        try:
            token = RefreshToken(refresh_token)
            token.blacklist()
        except Exception:
            return Response({'detail': 'Invalid refresh token.'}, status=status.HTTP_400_BAD_REQUEST)

        log_audit(
            action='AUTH_LOGOUT',
            request=request,
            actor_user=request.user,
            target_type='User',
            target_id=request.user.id,
        )
        return Response(status=status.HTTP_204_NO_CONTENT)


class RefreshTokenView(APIView):
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        serializer = TokenRefreshSerializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except TokenError:
            return Response({'detail': 'Invalid or blacklisted refresh token.'}, status=status.HTTP_401_UNAUTHORIZED)

        # Enforce server-side inactivity timeout: if the user has not been
        # active for more than 1 hour, reject the refresh and blacklist the
        # presented refresh token to force a full re-login.
        refresh_token = request.data.get('refresh')
        try:
            if refresh_token:
                token = RefreshToken(refresh_token)
                user_id = token.get('user_id') or token.get('user') or None
                if user_id:
                    try:
                        user = User.objects.get(pk=user_id)
                        profile = getattr(user, 'staff_profile', None)
                        if profile is not None:
                            last = profile.last_activity_at
                            # If we've never recorded activity, treat this as a fresh session
                            # and initialize last_activity_at rather than rejecting immediately.
                            if last is None:
                                profile.last_activity_at = timezone.now()
                                profile.save(update_fields=['last_activity_at'])
                            elif (timezone.now() - last > timedelta(hours=1)):
                                # Blacklist the refresh token and deny
                                try:
                                    token.blacklist()
                                except Exception:
                                    pass
                                return Response({'detail': 'Session expired due to inactivity.'}, status=status.HTTP_401_UNAUTHORIZED)
                    except User.DoesNotExist:
                        pass
        except Exception:
            # If token decode fails, fall back to normal behavior already covered above
            pass

        return Response(serializer.validated_data)


class HeartbeatView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        try:
            profile = getattr(request.user, 'staff_profile', None)
            if profile is not None:
                profile.last_activity_at = timezone.now()
                profile.save(update_fields=['last_activity_at'])
        except Exception:
            pass
        return Response(status=status.HTTP_204_NO_CONTENT)


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={'user': request.user})
        serializer.is_valid(raise_exception=True)

        old_password = serializer.validated_data['old_password']
        new_password = serializer.validated_data['new_password']

        if not request.user.check_password(old_password):
            log_audit(
                action='AUTH_PASSWORD_CHANGE_FAILED',
                request=request,
                actor_user=request.user,
                target_type='User',
                target_id=request.user.id,
                metadata={'reason': 'incorrect_old_password'},
            )
            return Response({'detail': 'Old password is incorrect.'}, status=status.HTTP_400_BAD_REQUEST)

        request.user.set_password(new_password)
        request.user.save(update_fields=['password'])

        try:
            UserEmailManager.send_password_changed_email(
                request.user,
                action='changed',
            )
        except Exception as exc:
            logger.error("Failed to send password changed email: %s", str(exc))

        tokens = _jwt_payload_for_user(request.user)
        log_audit(
            action='AUTH_PASSWORD_CHANGED',
            request=request,
            actor_user=request.user,
            target_type='User',
            target_id=request.user.id,
        )
        return Response({'detail': 'Password changed.', 'tokens': tokens})


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


class MeApplicationsView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        applications = InternalApplication.objects.all().order_by('name')
        payload = []
        for app in applications:
            can_access, reason = can_user_access_application(request.user, app)
            payload.append(
                {
                    'id': app.id,
                    'name': app.name,
                    'slug': app.slug,
                    'status': app.status,
                    'access_scope': app.access_scope,
                    'visibility_scope': app.visibility_scope,
                    'can_access': can_access,
                    'reason': reason,
                }
            )
        return Response(payload)


class AuthenticatedUserListView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        users = User.objects.select_related(
            'staff_profile__role',
            'staff_profile__department',
        ).filter(is_active=True)

        department_id = request.query_params.get('department_id')
        if department_id:
            users = users.filter(staff_profile__department_id=department_id)

        search = (request.query_params.get('search') or request.query_params.get('q') or '').strip()
        if search:
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

            users = users.filter(search_query)

        users = users.order_by(Lower('username'))
        
        paginator = AdminUserPagination()
        page = paginator.paginate_queryset(users, request, view=self)
        if page is not None:
            serializer = UserWithProfileSerializer(page, many=True)
            return paginator.get_paginated_response(serializer.data)
            
        return Response(UserWithProfileSerializer(users, many=True).data)


class AdminUserListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def get(self, request):
        users = User.objects.all()

        department_id = request.query_params.get('department_id')
        if department_id:
            users = users.filter(staff_profile__department_id=department_id)

        unit_id = request.query_params.get('unit_id')
        if unit_id:
            users = users.filter(staff_profile__unit_id=unit_id)

        team_id = request.query_params.get('team_id')
        if team_id:
            users = users.filter(staff_profile__team_id=team_id)

        unassigned = request.query_params.get('unassigned')
        if unassigned == 'department':
            users = users.filter(staff_profile__department__isnull=True)
        elif unassigned == 'unit':
            users = users.filter(staff_profile__unit__isnull=True)
        elif unassigned == 'team':
            users = users.filter(staff_profile__team__isnull=True)

        # Support 'q' param for admin search to mirror other list endpoints
        search = (request.query_params.get('q') or '').strip()
        if search:
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

            users = users.filter(search_query)

        users = users.order_by(Lower('username'))

        paginator = AdminUserPagination()
        page = paginator.paginate_queryset(users, request, view=self)
        if page is not None:
            serializer = UserWithProfileSerializer(page, many=True)
            return paginator.get_paginated_response(serializer.data)

        return Response(UserWithProfileSerializer(users, many=True).data)

    @transaction.atomic
    def post(self, request):
        if not has_admin_access(request.user):
            return Response({'detail': 'You do not have permission to perform this action.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = AdminCreateUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data['email']
        
        department_id = serializer.validated_data.get('department_id')
        department = Department.objects.filter(id=department_id).first() if department_id else None
        
        unit_id = serializer.validated_data.get('unit_id')
        unit = Unit.objects.filter(id=unit_id).first() if unit_id else None
        
        team_id = serializer.validated_data.get('team_id')
        team = Team.objects.filter(id=team_id).first() if team_id else None

        role = None
        role_id = serializer.validated_data.get('role_id')
        if role_id:
            role = Role.objects.filter(id=role_id).first()
        if not role:
            role, _created = Role.objects.get_or_create(
                code='STAFF',
                defaults={
                    'name': 'Staff',
                    'has_global_access': False,
                    'is_active': True,
                },
            )

        user = User.objects.create_user(
            username=email,
            email=email,
            password=serializer.validated_data['password'],
            first_name=serializer.validated_data['first_name'].strip(),
            last_name=serializer.validated_data['last_name'].strip(),
            is_active=True,
        )

        StaffProfile.objects.create(
            user=user,
            role=role,
            department=department,
            unit=unit,
            team=team,
            is_active=True,
        )

        try:
            UserEmailManager.send_user_created_email(
                user,
                serializer.validated_data['password'],
            )
        except Exception:
            # User creation should not fail if email delivery fails.
            pass

        log_audit(
            action='ADMIN_USER_CREATED',
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


class AdminUserPagination(PageNumberPagination):
    page_size = 20


    def get_paginated_response(self, data):
        response = super().get_paginated_response(data)
        response.data['page'] = self.page.number
        response.data['page_size'] = self.page.paginator.per_page
        response.data['total_pages'] = self.page.paginator.num_pages
        response.data['next_page'] = self.page.next_page_number() if self.page.has_next() else None
        response.data['previous_page'] = self.page.previous_page_number() if self.page.has_previous() else None
        return response


class AdminUserDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def get(self, _request, user_id):
        user = User.objects.filter(id=user_id).first()
        if not user:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
        return Response(UserWithProfileSerializer(user).data)

    @transaction.atomic
    def patch(self, request, user_id):
        if not has_admin_access(request.user):
            return Response({'detail': 'You do not have permission to perform this action.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = UpdateAdminUserSerializer(data=request.data, context={'user_id': user_id})
        serializer.is_valid(raise_exception=True)

        user = User.objects.filter(id=user_id).first()
        if not user:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        user.email = serializer.validated_data['email']
        user.username = serializer.validated_data['email']
        user.first_name = serializer.validated_data['first_name']
        user.last_name = serializer.validated_data.get('last_name', '')
        user.save(update_fields=['email', 'username', 'first_name', 'last_name'])

        if serializer.validated_data.get('reset_password'):
            temporary_password = serializer.validated_data['new_password']
            user.set_password(temporary_password)
            user.save(update_fields=['password'])
            log_audit(
                action='ADMIN_USER_PASSWORD_RESET',
                request=request,
                actor_user=request.user,
                target_type='User',
                target_id=user.id,
                metadata={
                    'email': user.email,
                    'temporary_password_provided': True,
                },
            )
            try:
                UserEmailManager.send_password_changed_email(
                    user,
                    action='reset',
                    temporary_password=temporary_password,
                )
            except Exception as exc:
                logger.error("Failed to send password reset email: %s", str(exc))

        department_id = serializer.validated_data.get('department_id')
        department = Department.objects.filter(id=department_id).first() if department_id else None

        unit_id = serializer.validated_data.get('unit_id')
        unit = Unit.objects.filter(id=unit_id).first() if unit_id else None

        team_id = serializer.validated_data.get('team_id')
        team = Team.objects.filter(id=team_id).first() if team_id else None

        role_id = serializer.validated_data.get('role_id')
        role = Role.objects.filter(id=role_id).first() if role_id else None

        profile = _profile_or_none(user)
        if profile is None:
            # Create a basic profile if it doesn't exist
            if not role:
                role, _ = Role.objects.get_or_create(
                    code='STAFF',
                    defaults={'name': 'Staff', 'has_global_access': False, 'is_active': True},
                )
            profile = StaffProfile.objects.create(
                user=user, 
                role=role, 
                department=department, 
                unit=unit,
                team=team,
                is_active=user.is_active
            )
        else:
            profile.department = department
            profile.unit = unit
            profile.team = team
            if role:
                profile.role = role
            profile.save(update_fields=['department', 'unit', 'team', 'role', 'updated_at'])

        log_audit(
            action='ADMIN_USER_UPDATED',
            request=request,
            actor_user=request.user,
            target_type='User',
            target_id=user.id,
            metadata={
                'email': user.email,
                'department_id': department_id,
                'department_name': department.name if department else None,
                'role_id': role.id if role else None,
                'role_code': role.code if role else None,
                'role_name': role.name if role else None,
                'reset_password': bool(serializer.validated_data.get('reset_password')),
            },
        )

        return Response(UserWithProfileSerializer(user).data)


class AdminUserRoleUpdateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def patch(self, request, user_id):
        if not has_admin_access(request.user):
            return Response({'detail': 'You do not have permission to perform this action.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = UpdateUserRoleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = User.objects.filter(id=user_id).first()
        if not user:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        role = Role.objects.filter(id=serializer.validated_data['role_id']).first()
        if not role:
            return Response({'detail': 'Role not found.'}, status=status.HTTP_404_NOT_FOUND)

        profile = _profile_or_none(user)
        if profile is None:
            profile = StaffProfile.objects.create(user=user, role=role)
        else:
            profile.role = role
            profile.save(update_fields=['role', 'updated_at'])

        log_audit(
            action='ADMIN_USER_ROLE_UPDATED',
            request=request,
            actor_user=request.user,
            target_type='User',
            target_id=user.id,
            metadata={'role_id': role.id, 'role_code': role.code, 'role_name': role.name},
        )

        return Response(UserWithProfileSerializer(user).data)


class AdminUserDepartmentUpdateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def put(self, request, user_id):
        if not has_admin_access(request.user):
            return Response({'detail': 'You do not have permission to perform this action.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = UpdateUserDepartmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = User.objects.filter(id=user_id).first()
        if not user:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        profile = _profile_or_none(user)
        if profile is None:
            return Response({'detail': 'Staff profile does not exist for this user.'}, status=status.HTTP_400_BAD_REQUEST)

        department_id = serializer.validated_data['department_id']
        department = Department.objects.filter(id=department_id).first()
        if not department:
            return Response({'detail': 'Department not found.'}, status=status.HTTP_404_NOT_FOUND)

        profile.department = department
        profile.save(update_fields=['department', 'updated_at'])

        log_audit(
            action='ADMIN_USER_DEPARTMENT_UPDATED',
            request=request,
            actor_user=request.user,
            target_type='User',
            target_id=user.id,
            metadata={'department_id': department_id, 'department_name': department.name},
        )

        return Response(UserWithProfileSerializer(user).data)


class AdminUserStatusUpdateView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def patch(self, request, user_id):
        if not has_admin_access(request.user):
            return Response({'detail': 'You do not have permission to perform this action.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = UpdateUserStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = User.objects.filter(id=user_id).first()
        if not user:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)

        is_active = serializer.validated_data['is_active']
        user.is_active = is_active
        user.save(update_fields=['is_active'])

        profile = _profile_or_none(user)
        if profile:
            profile.is_active = is_active
            profile.save(update_fields=['is_active', 'updated_at'])

        log_audit(
            action='ADMIN_USER_STATUS_UPDATED',
            request=request,
            actor_user=request.user,
            target_type='User',
            target_id=user.id,
            metadata={'is_active': is_active, 'email': user.email},
        )

        return Response(UserWithProfileSerializer(user).data)
