from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.auth import get_user_model
from unittest.mock import patch

from applications.models import InternalApplication, RecentApplication
from django.utils import timezone

from accounts.models import StaffProfile
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
		self.global_role = Role.objects.create(name='Executive Director', code='ED', has_global_access=True)
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

		response = self.client.post(reverse('admin-applications-create'), payload, format='json')

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
		response = self.client.put(reverse('admin-applications-departments', kwargs={'application_id': app.id}), payload, format='json')

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
		response = self.client.put(reverse('admin-applications-departments', kwargs={'application_id': app.id}), payload, format='json')

		self.assertEqual(response.status_code, status.HTTP_200_OK)
		self.assertTrue(mock_send.called)
		called_app, recipients = mock_send.call_args.args
		self.assertEqual(called_app.id, app.id)
		self.assertEqual(set(recipients), {'hr@example.com'})
