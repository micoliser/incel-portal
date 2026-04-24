from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.db import transaction
from django.db.models import Q
from django.db.models.functions import Lower
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import StaffProfile
from accounts.serializers import (
    AdminCreateUserSerializer,
    ChangePasswordSerializer,
    LoginSerializer,
    LogoutSerializer,
    UpdateUserDepartmentSerializer,
    UpdateUserRoleSerializer,
    UpdateUserStatusSerializer,
    UserWithProfileSerializer,
)
from applications.audit import log_audit
from applications.models import InternalApplication
from common.access import can_user_access_application
from common.permissions import IsGlobalAccessUser, has_admin_access, has_global_access
from organization.models import Department, Role


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
        return Response(serializer.validated_data)


class ChangePasswordView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data, context={'user': request.user})
        serializer.is_valid(raise_exception=True)

        old_password = serializer.validated_data['old_password']
        new_password = serializer.validated_data['new_password']

        if not request.user.check_password(old_password):
            return Response({'detail': 'Old password is incorrect.'}, status=status.HTTP_400_BAD_REQUEST)

        request.user.set_password(new_password)
        request.user.save(update_fields=['password'])

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

        search = (request.query_params.get('search') or '').strip()
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
        return Response(UserWithProfileSerializer(users, many=True).data)


class AdminUserListView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def get(self, _request):
        users = User.objects.all().order_by(Lower('username'))
        return Response(UserWithProfileSerializer(users, many=True).data)

    @transaction.atomic
    def post(self, request):
        if not has_admin_access(request.user):
            return Response({'detail': 'You do not have permission to perform this action.'}, status=status.HTTP_403_FORBIDDEN)

        serializer = AdminCreateUserSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data['email']
        department = Department.objects.filter(id=serializer.validated_data['department_id']).first()

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
            is_active=True,
        )

        log_audit(
            action='ADMIN_USER_CREATED',
            request=request,
            actor_user=request.user,
            target_type='User',
            target_id=user.id,
            metadata={'email': email, 'role_code': role.code, 'department_id': department.id},
        )

        return Response(UserWithProfileSerializer(user).data, status=status.HTTP_201_CREATED)


class AdminUserDetailView(APIView):
    permission_classes = [permissions.IsAuthenticated, IsGlobalAccessUser]

    def get(self, _request, user_id):
        user = User.objects.filter(id=user_id).first()
        if not user:
            return Response({'detail': 'User not found.'}, status=status.HTTP_404_NOT_FOUND)
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
            metadata={'role_id': role.id, 'role_code': role.code},
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
            metadata={'department_id': department_id},
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
            metadata={'is_active': is_active},
        )

        return Response(UserWithProfileSerializer(user).data)
