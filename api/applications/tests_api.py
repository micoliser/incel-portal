from django.contrib.auth.models import User
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken

from applications.models import ApplicationAccessOverride, AuditLog, InternalApplication
from common.test_utils import BaseAPITestCase


class ApplicationsApiTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.restricted_eng = InternalApplication.objects.create(
            name='Engineering Tool',
            slug='engineering-tool',
            app_url='https://example.com/eng',
            access_scope=InternalApplication.AccessScope.RESTRICTED,
        )
        self.restricted_eng.departments.add(self.dep_eng)

        self.restricted_hr = InternalApplication.objects.create(
            name='HR Tool',
            slug='hr-tool',
            app_url='https://example.com/hr',
            access_scope=InternalApplication.AccessScope.RESTRICTED,
        )
        self.restricted_hr.departments.add(self.dep_hr)

        self.open_app = InternalApplication.objects.create(
            name='Open Tool',
            slug='open-tool',
            app_url='https://example.com/open',
            access_scope=InternalApplication.AccessScope.ALL_AUTHENTICATED,
        )

    def test_applications_list_requires_authentication(self):
        response = self.client.get(reverse('applications-list'))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_applications_list_returns_access_flags(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('applications-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        by_slug = {item['slug']: item for item in response.data}
        self.assertTrue(by_slug['engineering-tool']['can_access'])
        self.assertFalse(by_slug['hr-tool']['can_access'])
        self.assertTrue(by_slug['open-tool']['can_access'])

    def test_application_detail_not_found(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('applications-detail', kwargs={'application_id': 999999}))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_application_can_access_endpoint(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('applications-can-access', kwargs={'application_id': self.restricted_hr.id}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['can_access'])

    def test_application_open_logs_granted(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(reverse('applications-open', kwargs={'application_id': self.restricted_eng.id}), {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(
            AuditLog.objects.filter(
                action='APPLICATION_OPEN_GRANTED',
                actor_user=self.staff_user,
                target_id=str(self.restricted_eng.id),
            ).exists()
        )

    def test_application_open_logs_denied(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(reverse('applications-open', kwargs={'application_id': self.restricted_hr.id}), {}, format='json')

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertTrue(
            AuditLog.objects.filter(
                action='APPLICATION_OPEN_DENIED',
                actor_user=self.staff_user,
                target_id=str(self.restricted_hr.id),
            ).exists()
        )

    def test_override_allow_grants_access(self):
        ApplicationAccessOverride.objects.create(
            application=self.restricted_hr,
            user=self.staff_user,
            effect=ApplicationAccessOverride.Effect.ALLOW,
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('applications-can-access', kwargs={'application_id': self.restricted_hr.id}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['can_access'])

    def test_expired_override_does_not_apply(self):
        ApplicationAccessOverride.objects.create(
            application=self.restricted_hr,
            user=self.staff_user,
            effect=ApplicationAccessOverride.Effect.ALLOW,
            expires_at=timezone.now() - timezone.timedelta(minutes=1),
        )

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('applications-can-access', kwargs={'application_id': self.restricted_hr.id}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertFalse(response.data['can_access'])

    def test_ed_has_global_access(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.get(reverse('applications-can-access', kwargs={'application_id': self.restricted_hr.id}))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['can_access'])

    def test_admin_create_application_success(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        payload = {
            'name': 'Finance Tool',
            'slug': 'finance-tool',
            'description': 'Finance operations',
            'app_url': 'https://example.com/finance',
            'status': InternalApplication.Status.ACTIVE,
            'access_scope': InternalApplication.AccessScope.RESTRICTED,
            'visibility_scope': InternalApplication.VisibilityScope.VISIBLE_TO_ALL,
            'department_ids': [self.dep_hr.id],
        }

        response = self.client.post(reverse('admin-applications-create'), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        created = InternalApplication.objects.get(slug='finance-tool')
        self.assertEqual(list(created.departments.values_list('id', flat=True)), [self.dep_hr.id])

    def test_admin_create_application_rejects_duplicate_department_ids(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        payload = {
            'name': 'Dup Dept Tool',
            'slug': 'dup-dept-tool',
            'description': 'x',
            'app_url': 'https://example.com/dup',
            'status': InternalApplication.Status.ACTIVE,
            'access_scope': InternalApplication.AccessScope.RESTRICTED,
            'visibility_scope': InternalApplication.VisibilityScope.VISIBLE_TO_ALL,
            'department_ids': [self.dep_eng.id, self.dep_eng.id],
        }

        response = self.client.post(reverse('admin-applications-create'), payload, format='json')
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_admin_update_application_success(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.patch(
            reverse('admin-applications-update-delete', kwargs={'application_id': self.restricted_eng.id}),
            {'name': 'Engineering Tool Updated', 'department_ids': [self.dep_hr.id]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.restricted_eng.refresh_from_db()
        self.assertEqual(self.restricted_eng.name, 'Engineering Tool Updated')
        self.assertEqual(list(self.restricted_eng.departments.values_list('id', flat=True)), [self.dep_hr.id])

    def test_admin_delete_application_soft_deletes(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.delete(
            reverse('admin-applications-update-delete', kwargs={'application_id': self.restricted_eng.id})
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.restricted_eng.refresh_from_db()
        self.assertEqual(self.restricted_eng.status, InternalApplication.Status.INACTIVE)
        self.assertEqual(self.restricted_eng.visibility_scope, InternalApplication.VisibilityScope.HIDDEN)

    def test_admin_set_application_departments(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.put(
            reverse('admin-applications-departments', kwargs={'application_id': self.restricted_eng.id}),
            {'department_ids': [self.dep_hr.id]},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.restricted_eng.refresh_from_db()
        self.assertEqual(list(self.restricted_eng.departments.values_list('id', flat=True)), [self.dep_hr.id])

    def test_admin_create_override_success(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('admin-applications-overrides-create', kwargs={'application_id': self.restricted_hr.id}),
            {'user_id': self.staff_user.id, 'effect': ApplicationAccessOverride.Effect.ALLOW, 'reason': 'Temporary access'},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(
            ApplicationAccessOverride.objects.filter(
                application=self.restricted_hr,
                user=self.staff_user,
                effect=ApplicationAccessOverride.Effect.ALLOW,
            ).exists()
        )

    def test_admin_create_override_rejects_unknown_user(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.post(
            reverse('admin-applications-overrides-create', kwargs={'application_id': self.restricted_hr.id}),
            {'user_id': 999999, 'effect': ApplicationAccessOverride.Effect.ALLOW},
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_admin_delete_override_success(self):
        override = ApplicationAccessOverride.objects.create(
            application=self.restricted_hr,
            user=self.staff_user,
            effect=ApplicationAccessOverride.Effect.ALLOW,
        )

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.delete(
            reverse(
                'admin-applications-overrides-delete',
                kwargs={'application_id': self.restricted_hr.id, 'override_id': override.id},
            )
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(ApplicationAccessOverride.objects.filter(id=override.id).exists())

    def test_admin_audit_logs_list_and_filters(self):
        AuditLog.objects.create(action='CUSTOM_A', target_type='X')
        AuditLog.objects.create(action='CUSTOM_B', target_type='Y')

        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.get(reverse('admin-audit-logs-list'), {'action': 'CUSTOM_A'})

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertGreaterEqual(len(response.data), 1)
        self.assertTrue(all(item['action'] == 'CUSTOM_A' for item in response.data))

    def test_admin_audit_log_detail_not_found(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.get(reverse('admin-audit-logs-detail', kwargs={'log_id': 999999}))
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_staff_cannot_access_admin_app_routes(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(
            reverse('admin-applications-create'),
            {
                'name': 'Blocked Tool',
                'slug': 'blocked-tool',
                'description': 'x',
                'app_url': 'https://example.com/blocked',
                'status': InternalApplication.Status.ACTIVE,
                'access_scope': InternalApplication.AccessScope.RESTRICTED,
                'visibility_scope': InternalApplication.VisibilityScope.VISIBLE_TO_ALL,
                'department_ids': [self.dep_eng.id],
            },
            format='json',
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_open_route_for_missing_application_returns_404(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.post(reverse('applications-open', kwargs={'application_id': 123456}), {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_invalid_bearer_token_rejected(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer invalidtoken')
        response = self.client.get(reverse('applications-list'))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_blacklisted_refresh_token_cannot_be_reused(self):
        refresh = str(RefreshToken.for_user(self.staff_user))
        self.client.credentials(**self.auth_headers_for(self.staff_user))

        logout = self.client.post(reverse('auth-logout'), {'refresh': refresh}, format='json')
        self.assertEqual(logout.status_code, status.HTTP_204_NO_CONTENT)

        refresh_again = self.client.post(reverse('auth-refresh'), {'refresh': refresh}, format='json')
        self.assertEqual(refresh_again.status_code, status.HTTP_401_UNAUTHORIZED)
