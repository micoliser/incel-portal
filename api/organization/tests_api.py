from django.urls import reverse
from rest_framework import status

from common.test_utils import BaseAPITestCase
from organization.models import Department


class OrganizationApiTests(BaseAPITestCase):
    def test_departments_requires_authentication(self):
        response = self.client.get(reverse('organization-departments-list'))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_departments_returns_only_active_departments(self):
        Department.objects.create(name='Dormant', code='DRM', is_active=False)

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('organization-departments-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        codes = {item['code'] for item in response.data}
        self.assertIn('ENG', codes)
        self.assertIn('HR', codes)
        self.assertNotIn('DRM', codes)

    def test_roles_requires_global_access(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('organization-roles-list'))
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_roles_list_for_ed(self):
        self.client.credentials(**self.auth_headers_for(self.admin_user))
        response = self.client.get(reverse('organization-roles-list'))

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        codes = {item['code'] for item in response.data}
        self.assertTrue({'STAFF', 'ED', 'MD'}.issubset(codes))
