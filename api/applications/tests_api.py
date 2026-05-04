from django.urls import reverse
from rest_framework.test import APITestCase
from rest_framework import status
from django.contrib.auth import get_user_model
from applications.models import InternalApplication, RecentApplication
from django.utils import timezone

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
		expected = [a.id for a in self.apps[::-1][:4]]
		self.assertEqual(returned_app_ids, expected)
