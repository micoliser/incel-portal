from django.contrib.auth.models import User
from rest_framework.test import APITestCase
from rest_framework import status
from django.urls import reverse

from accounts.models import StaffProfile
from organization.models import Department, Unit, Team, Role

class AdminUserListViewTests(APITestCase):
    def setUp(self):
        # Admin user
        self.admin = User.objects.create_user(username='admin', password='pwd')
        self.role_ed = Role.objects.create(name='Executive Director', code='ED', has_global_access=True)
        StaffProfile.objects.create(user=self.admin, role=self.role_ed)
        self.client.force_authenticate(user=self.admin)

        # Hierarchy
        self.dept = Department.objects.create(name='Engineering', code='ENG')
        self.unit = Unit.objects.create(name='Backend', code='BACK', department=self.dept)
        self.team = Team.objects.create(name='API', code='API', unit=self.unit)

        # Users
        self.user_none = User.objects.create_user(username='unassigned')
        StaffProfile.objects.create(user=self.user_none, role=self.role_ed)

        self.user_dept = User.objects.create_user(username='dept')
        StaffProfile.objects.create(user=self.user_dept, role=self.role_ed, department=self.dept)

        self.user_unit = User.objects.create_user(username='unit')
        StaffProfile.objects.create(user=self.user_unit, role=self.role_ed, department=self.dept, unit=self.unit)

        self.user_team = User.objects.create_user(username='team')
        StaffProfile.objects.create(user=self.user_team, role=self.role_ed, department=self.dept, unit=self.unit, team=self.team)

        self.url = reverse('admin-users-list')

    def test_filter_by_department(self):
        response = self.client.get(self.url, {'department_id': self.dept.id})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Should include dept, unit, team users
        usernames = [u['username'] for u in response.data['results']]
        self.assertIn('dept', usernames)
        self.assertIn('unit', usernames)
        self.assertIn('team', usernames)
        self.assertNotIn('unassigned', usernames)

    def test_filter_by_unit(self):
        response = self.client.get(self.url, {'unit_id': self.unit.id})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Should include unit, team users
        usernames = [u['username'] for u in response.data['results']]
        self.assertNotIn('dept', usernames)
        self.assertIn('unit', usernames)
        self.assertIn('team', usernames)
        self.assertNotIn('unassigned', usernames)

    def test_filter_by_team(self):
        response = self.client.get(self.url, {'team_id': self.team.id})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        # Should include only team user
        usernames = [u['username'] for u in response.data['results']]
        self.assertEqual(len(usernames), 1)
        self.assertEqual(usernames[0], 'team')

    def test_filter_unassigned_department(self):
        response = self.client.get(self.url, {'unassigned': 'department'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        usernames = [u['username'] for u in response.data['results']]
        self.assertIn('unassigned', usernames)
        self.assertIn('admin', usernames) # admin also has no department
        self.assertNotIn('dept', usernames)

    def test_filter_unassigned_unit(self):
        response = self.client.get(self.url, {'unassigned': 'unit'})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        usernames = [u['username'] for u in response.data['results']]
        self.assertIn('unassigned', usernames)
        self.assertIn('dept', usernames)
        self.assertNotIn('unit', usernames)
        self.assertNotIn('team', usernames)
