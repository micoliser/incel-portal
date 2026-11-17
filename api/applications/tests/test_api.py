from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from accounts.models import StaffProfile
from applications.models import InternalApplication, RecentApplication
from organization.models import Role

User = get_user_model()

class RecentApplicationsAPITest(APITestCase):
    def setUp(self):
        self.user = User.objects.create_user(username='alice', password='password')
        self.client.force_authenticate(self.user)

        # Create 6 applications to test trimming
        self.apps = []
        for i in range(6):
            app = InternalApplication.objects.create(
                name=f"App {i}",
                slug=f"app-{i}",
                app_url=f"https://example.com/app-{i}",
                access_scope=InternalApplication.AccessScope.ALL_AUTHENTICATED,
                status=InternalApplication.Status.ACTIVE,
            )
            self.apps.append(app)

    def test_post_open_creates_and_updates_recent(self):
        app = self.apps[0]
        url = reverse('applications-open', args=[app.id])

        # First open should create
        resp = self.client.post(url)
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertTrue(RecentApplication.objects.filter(user=self.user, application=app).exists())

        first = RecentApplication.objects.get(user=self.user, application=app)
        first_time = first.opened_at

        # Post again should update timestamp
        resp2 = self.client.post(url)
        self.assertEqual(resp2.status_code, status.HTTP_200_OK)
        second = RecentApplication.objects.get(user=self.user, application=app)
        self.assertTrue(second.opened_at >= first_time)

    def test_trims_to_four_entries_and_gets_recent(self):
        # Open six apps sequentially
        for app in self.apps:
            resp = self.client.post(reverse('applications-open', args=[app.id]))
            self.assertEqual(resp.status_code, status.HTTP_200_OK)

        # After all opens, get recent should return at most 4, most recent first
        resp = self.client.get(reverse('me-recent-applications'))
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        data = resp.json()
        self.assertTrue(isinstance(data, list))
        self.assertLessEqual(len(data), 4)

        # Confirm ordering: the last opened app should be first
        returned_app_ids = [item['application']['id'] for item in data]
        expected = [str(a.id) for a in self.apps[::-1][:4]]
        self.assertEqual(returned_app_ids, expected)


class ApplicationEmailAPITest(APITestCase):
    def setUp(self):
        self.global_role = Role.objects.create(name='Admin', code='ADMIN', has_global_access=True)
        self.admin_user = User.objects.create_user(
            username='admin@example.com',
            email='admin@example.com',
            password='password',
            first_name='Admin',
            last_name='User',
        )
        StaffProfile.objects.create(user=self.admin_user, role=self.global_role)
        self.client.force_authenticate(self.admin_user)

        self.eng_role = Role.objects.create(name='Staff', code='STAFF', has_global_access=False)
        self.dep_eng = self._create_department('Engineering', 'ENG')
        self.dep_hr = self._create_department('Human Resources', 'HR')

        self.eng_user = User.objects.create_user(
            username='eng@example.com',
            email='eng@example.com',
            password='password',
            first_name='Eng',
            last_name='User',
        )
        StaffProfile.objects.create(user=self.eng_user, role=self.eng_role, department=self.dep_eng, is_active=True)

        self.hr_user = User.objects.create_user(
            username='hr@example.com',
            email='hr@example.com',
            password='password',
            first_name='Hr',
            last_name='User',
        )
        StaffProfile.objects.create(user=self.hr_user, role=self.eng_role, department=self.dep_hr, is_active=True)

    def _create_department(self, name, code):
        from organization.models import Department
        return Department.objects.create(name=name, code=code)

    @patch('applications.views_api.ApplicationEmailManager.send_application_created_to_users')
    def test_application_create_sends_after_departments_are_set(self, mock_send):
        payload = {
            'name': 'Payroll',
            'slug': 'payroll',
            'description': 'Payroll portal',
            'app_url': 'https://example.com/payroll',
            'access_scope': InternalApplication.AccessScope.RESTRICTED,
            'visibility_scope': InternalApplication.VisibilityScope.VISIBLE_TO_ALL,
            'department_ids': [str(self.dep_eng.id), str(self.dep_hr.id)],
        }

        response = self.client.post(reverse('applications-list'), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertTrue(mock_send.called)
        created_app = InternalApplication.objects.get(slug='payroll')
        mock_send.assert_called_once_with(created_app)

    @patch('applications.views_api.ApplicationEmailManager.send_departmental_access_emails')
    def test_department_update_sends_only_for_new_departments(self, mock_send):
        app = InternalApplication.objects.create(
            name='Benefits',
            slug='benefits',
            description='Benefits portal',
            app_url='https://example.com/benefits',
            access_scope=InternalApplication.AccessScope.RESTRICTED,
            status=InternalApplication.Status.ACTIVE,
        )
        app.departments.add(self.dep_eng)

        payload = {
            'department_ids': [str(self.dep_eng.id), str(self.dep_hr.id)],
        }
        response = self.client.patch(reverse('applications-detail', kwargs={'application_id': app.id}), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(mock_send.called)
        called_app, recipients = mock_send.call_args.args
        self.assertEqual(called_app.id, app.id)
        self.assertEqual(set(recipients), {'hr@example.com'})

    @patch('applications.views_api.ApplicationEmailManager.send_departmental_access_revoked_emails')
    def test_department_update_sends_revoke_for_removed_departments(self, mock_send):
        app = InternalApplication.objects.create(
            name='Finance',
            slug='finance',
            description='Finance portal',
            app_url='https://example.com/finance',
            access_scope=InternalApplication.AccessScope.RESTRICTED,
            status=InternalApplication.Status.ACTIVE,
        )
        app.departments.add(self.dep_eng, self.dep_hr)

        payload = {
            'department_ids': [str(self.dep_eng.id)],
        }
        response = self.client.patch(reverse('applications-detail', kwargs={'application_id': app.id}), payload, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(mock_send.called)
        called_app, recipients = mock_send.call_args.args
        self.assertEqual(called_app.id, app.id)
        self.assertEqual(set(recipients), {'hr@example.com'})


class ApplicationVisibilityTests(APITestCase):
    """Who can see which applications, and who gets their address."""

    def setUp(self):
        from organization.models import Department

        self.staff_role = Role.objects.create(name='Staff', code='STAFF', has_global_access=False)
        self.dep_eng = Department.objects.create(name='Engineering', code='ENG')
        self.dep_hr = Department.objects.create(name='Human Resources', code='HR', handles_general_support=True)

        self.staff = User.objects.create_user(username='staff@example.com', email='staff@example.com')
        StaffProfile.objects.create(user=self.staff, role=self.staff_role, department=self.dep_eng)
        self.root = User.objects.create_superuser('root@example.com', 'root@example.com', 'RootStrongPass123!')

        A = InternalApplication
        self.open_app = A.objects.create(
            name='Open', slug='open', app_url='https://open.example.com',
            access_scope=A.AccessScope.ALL_AUTHENTICATED,
        )
        self.hr_app = A.objects.create(
            name='HR Only', slug='hr-only', app_url='https://hr.example.com', access_scope=A.AccessScope.RESTRICTED,
        )
        self.hr_app.departments.add(self.dep_hr)
        self.hidden_app = A.objects.create(
            name='Hidden', slug='hidden', app_url='https://hidden.example.com',
            access_scope=A.AccessScope.ALL_AUTHENTICATED, visibility_scope=A.VisibilityScope.HIDDEN,
        )
        self.inactive_app = A.objects.create(
            name='Switched Off', slug='switched-off', app_url='https://off.example.com',
            access_scope=A.AccessScope.ALL_AUTHENTICATED, status=A.Status.INACTIVE,
        )

    def _list(self, user, **params):
        self.client.force_authenticate(user)
        response = self.client.get(reverse('applications-list'), params)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        return response.data

    def test_list_is_always_paginated(self):
        data = self._list(self.staff)
        self.assertEqual(set(data), {'count', 'page', 'page_size', 'total_pages', 'results'})
        self.assertEqual(data['page_size'], 15)
        self.assertEqual(self._list(self.staff, page_size=2)['page_size'], 2)

    def test_hidden_applications_exist_only_for_administrators(self):
        names = {item['name'] for item in self._list(self.staff)['results']}
        self.assertEqual(names, {'Open', 'HR Only', 'Switched Off'})

        names = {item['name'] for item in self._list(self.root)['results']}
        self.assertIn('Hidden', names)

        self.client.force_authenticate(self.staff)
        hidden = {'application_id': self.hidden_app.id}
        self.assertEqual(self.client.get(reverse('applications-detail', kwargs=hidden)).status_code, 404)
        self.assertEqual(self.client.get(reverse('applications-can-access', kwargs=hidden)).status_code, 404)
        self.assertEqual(self.client.post(reverse('applications-open', kwargs=hidden)).status_code, 404)

    def test_deleting_an_application_removes_it_for_everyone_but_administrators(self):
        self.client.force_authenticate(self.root)
        detail = reverse('applications-detail', kwargs={'application_id': self.open_app.id})
        self.assertEqual(self.client.delete(detail).status_code, status.HTTP_204_NO_CONTENT)

        self.assertNotIn('Open', {item['name'] for item in self._list(self.staff)['results']})
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.client.get(detail).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(
            self.client.post(reverse('applications-open', kwargs={'application_id': self.open_app.id})).status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_address_is_only_given_to_someone_who_may_open_the_application(self):
        by_name = {item['name']: item for item in self._list(self.staff)['results']}
        self.assertEqual(by_name['Open']['app_url'], 'https://open.example.com')
        self.assertTrue(by_name['Open']['can_access'])
        self.assertIsNone(by_name['HR Only']['app_url'])
        self.assertFalse(by_name['HR Only']['can_access'])
        self.assertIsNone(by_name['Switched Off']['app_url'])

        # An administrator edits applications, so sees every address.
        by_name = {item['name']: item for item in self._list(self.root)['results']}
        self.assertEqual(by_name['HR Only']['app_url'], 'https://hr.example.com')

    def test_an_inactive_application_cannot_be_opened(self):
        self.client.force_authenticate(self.staff)
        response = self.client.post(reverse('applications-open', kwargs={'application_id': self.inactive_app.id}))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
        self.assertEqual(response.data['error']['message'], 'This application is inactive.')

    def test_accessible_filter_and_search(self):
        names = [item['name'] for item in self._list(self.staff, accessible='true')['results']]
        self.assertEqual(names, ['Open', 'Switched Off'])
        names = [item['name'] for item in self._list(self.staff, search='hr')['results']]
        self.assertEqual(names, ['HR Only'])

    def test_listing_does_not_query_per_application(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        self.client.force_authenticate(self.staff)
        with CaptureQueriesContext(connection) as before:
            self.client.get(reverse('applications-list'))
        for index in range(8):
            app = InternalApplication.objects.create(
                name=f'Extra {index}', slug=f'extra-{index}', app_url='https://x.example.com',
            )
            app.departments.add(self.dep_hr)
        with CaptureQueriesContext(connection) as after:
            self.client.get(reverse('applications-list'))
        self.assertLessEqual(len(after), len(before))

    def test_only_administrators_can_create_edit_or_delete(self):
        self.client.force_authenticate(self.staff)
        detail = reverse('applications-detail', kwargs={'application_id': self.open_app.id})
        payload = {'name': 'New', 'slug': 'new', 'app_url': 'https://new.example.com'}
        self.assertEqual(self.client.post(reverse('applications-list'), payload).status_code, 403)
        self.assertEqual(self.client.patch(detail, {'name': 'Renamed'}).status_code, 403)
        self.assertEqual(self.client.delete(detail).status_code, 403)

    def test_setting_an_exception_twice_updates_it(self):
        self.client.force_authenticate(self.root)
        url = reverse('applications-overrides', kwargs={'application_id': self.hr_app.id})

        first = self.client.post(url, {'user_id': self.staff.id, 'effect': 'ALLOW'})
        self.assertEqual(first.status_code, status.HTTP_201_CREATED)
        self.assertEqual(first.data['user']['id'], self.staff.id)
        self.assertEqual(str(first.data['application_id']), str(self.hr_app.id))

        second = self.client.post(url, {'user_id': self.staff.id, 'effect': 'DENY'})
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertEqual(second.data['effect'], 'DENY')
