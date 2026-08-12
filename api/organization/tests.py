from django.contrib.auth.models import User
from rest_framework.test import APITestCase
from rest_framework import status
from django.urls import reverse

from organization.models import Department, Unit, Team, Role
from accounts.models import StaffProfile

class BulkMemberAssignmentTests(APITestCase):
    def setUp(self):
        # Create an admin user to perform the actions
        self.admin_user = User.objects.create_user(username='admin', password='password')
        self.role_ed = Role.objects.create(name='Executive Director', code='ED', has_global_access=True)
        StaffProfile.objects.create(user=self.admin_user, role=self.role_ed)
        self.client.force_authenticate(user=self.admin_user)

        # Create hierarchy
        self.dept = Department.objects.create(name='Engineering', code='ENG')
        self.unit = Unit.objects.create(name='Backend', code='BACK', department=self.dept)
        self.team = Team.objects.create(name='API', code='API', unit=self.unit)
        
        self.dept2 = Department.objects.create(name='Sales', code='SALES')

        # Create target users
        self.user1 = User.objects.create_user(username='u1', email='u1@test.com')
        self.user2 = User.objects.create_user(username='u2', email='u2@test.com')
        self.user3 = User.objects.create_user(username='u3', email='u3@test.com')

        # We need StaffProfiles for them
        StaffProfile.objects.create(user=self.user1, role=self.role_ed)
        StaffProfile.objects.create(user=self.user2, role=self.role_ed)
        StaffProfile.objects.create(user=self.user3, role=self.role_ed, department=self.dept2)

    def test_bulk_add_to_department(self):
        url = reverse('admin-departments-bulk-members', kwargs={'pk': self.dept.id})
        data = {'user_ids': [self.user1.id, self.user2.id], 'action': 'add'}
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user1.staff_profile.refresh_from_db()
        self.user2.staff_profile.refresh_from_db()
        self.assertEqual(self.user1.staff_profile.department, self.dept)
        self.assertEqual(self.user2.staff_profile.department, self.dept)

    def test_bulk_add_to_unit(self):
        url = reverse('admin-units-bulk-members', kwargs={'pk': self.unit.id})
        data = {'user_ids': [self.user1.id, self.user2.id], 'action': 'add'}
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user1.staff_profile.refresh_from_db()
        # Adding to unit should automatically set the department to unit.department
        self.assertEqual(self.user1.staff_profile.unit, self.unit)
        self.assertEqual(self.user1.staff_profile.department, self.dept)

    def test_bulk_remove_from_unit(self):
        # Initially assign user1 to unit
        self.user1.staff_profile.unit = self.unit
        self.user1.staff_profile.save()

        url = reverse('admin-units-bulk-members', kwargs={'pk': self.unit.id})
        data = {'user_ids': [self.user1.id], 'action': 'remove'}
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user1.staff_profile.refresh_from_db()
        self.assertIsNone(self.user1.staff_profile.unit)
        self.assertIsNone(self.user1.staff_profile.team)

    def test_bulk_add_to_team(self):
        url = reverse('admin-teams-bulk-members', kwargs={'pk': self.team.id})
        data = {'user_ids': [self.user3.id], 'action': 'add'}
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user3.staff_profile.refresh_from_db()
        # Adding to team should cascade up
        self.assertEqual(self.user3.staff_profile.team, self.team)
        self.assertEqual(self.user3.staff_profile.unit, self.unit)
        self.assertEqual(self.user3.staff_profile.department, self.dept)

    def test_bulk_remove_from_team(self):
        # Initially assign user3 to team
        self.user3.staff_profile.team = self.team
        self.user3.staff_profile.save()

        url = reverse('admin-teams-bulk-members', kwargs={'pk': self.team.id})
        data = {'user_ids': [self.user3.id], 'action': 'remove'}
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.user3.staff_profile.refresh_from_db()
        self.assertIsNone(self.user3.staff_profile.team)
        # It shouldn't remove the unit or department
        self.assertEqual(self.user3.staff_profile.department, self.dept2)

    def test_bulk_action_requires_global_access(self):
        # Create non-admin user
        normal_user = User.objects.create_user(username='normal', password='password')
        role_staff = Role.objects.create(name='Staff', code='STAFF', has_global_access=False)
        StaffProfile.objects.create(user=normal_user, role=role_staff)
        
        self.client.force_authenticate(user=normal_user)
        url = reverse('admin-departments-bulk-members', kwargs={'pk': self.dept.id})
        data = {'user_ids': [self.user1.id], 'action': 'add'}
        response = self.client.post(url, data, format='json')
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_bulk_add_invalid_user_id(self):
        url = reverse('admin-teams-bulk-members', kwargs={'pk': self.team.id})
        data = {'user_ids': [99999], 'action': 'add'}
        response = self.client.post(url, data, format='json')
        # Filter simply doesn't match anything, so it returns 200 without crashing
        self.assertEqual(response.status_code, status.HTTP_200_OK)
