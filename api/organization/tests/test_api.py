from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.urls import reverse
from rest_framework import status

from applications.models import AuditLog
from common.test_utils import BaseAPITestCase
from organization.models import Department, Team, Unit

User = get_user_model()


class OrganizationApiTests(BaseAPITestCase):
    def test_departments_requires_authentication(self):
        response = self.client.get(reverse('department-list'))
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_departments_returns_only_active_departments(self):
        Department.objects.create(name='Dormant', code='DRM', is_active=False)

        self.client.credentials(**self.auth_headers_for(self.staff_user))
        response = self.client.get(reverse('department-list'))

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


class OrganizationManagementTests(BaseAPITestCase):
    """Who may change the organization tree, and what a change leaves behind."""

    def setUp(self):
        super().setUp()
        self.root = User.objects.create_superuser('root@example.com', 'root@example.com', 'RootStrongPass123!')
        self.unit = Unit.objects.create(name='Backend', code='BACK', department=self.dep_eng)
        self.team = Team.objects.create(name='API', code='API', unit=self.unit)
        self.other_unit = Unit.objects.create(name='Frontend', code='FRONT', department=self.dep_eng)

        self.profile = self.staff_user.staff_profile
        self.profile.unit = self.unit
        self.profile.team = self.team
        self.profile.save()

    def as_root(self):
        self.client.credentials(**self.auth_headers_for(self.root))

    def test_staff_can_read_but_not_change(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        self.assertEqual(self.client.get(reverse('unit-list')).status_code, status.HTTP_200_OK)
        self.assertEqual(
            self.client.post(reverse('department-list'), {'name': 'New', 'code': 'NEW'}).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.patch(reverse('team-detail', kwargs={'pk': self.team.id}), {'name': 'Renamed'}).status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            self.client.post(
                reverse('team-members', kwargs={'pk': self.team.id}), {'user_ids': [self.staff_user.id]}
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_put_is_not_offered(self):
        self.as_root()
        response = self.client.put(reverse('team-detail', kwargs={'pk': self.team.id}), {'name': 'X', 'code': 'X'})
        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_leader_is_read_as_a_user_and_written_by_id(self):
        self.as_root()
        url = reverse('team-detail', kwargs={'pk': self.team.id})

        response = self.client.patch(url, {'team_lead_id': self.staff_user.id})
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data['team_lead']['id'], self.staff_user.id)
        self.assertEqual(response.data['team_lead']['full_name'], 'Staff Member')
        self.assertNotIn('team_lead_info', response.data)
        self.assertTrue(AuditLog.objects.filter(action='ORG_LEADER_CHANGED', target_id=str(self.team.id)).exists())

        # Someone outside the team cannot lead it.
        response = self.client.patch(url, {'team_lead_id': self.admin_user.id})
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn('team_lead_id', response.data['error']['details'])

    def test_removing_only_affects_people_who_are_in_the_group(self):
        outsider = self.admin_user.staff_profile
        outsider.unit = self.other_unit
        outsider.save()

        self.as_root()
        response = self.client.post(
            reverse('unit-members', kwargs={'pk': self.unit.id}),
            {'action': 'remove', 'user_ids': [self.staff_user.id, self.admin_user.id]},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        self.profile.refresh_from_db()
        outsider.refresh_from_db()
        self.assertIsNone(self.profile.unit_id)
        self.assertIsNone(self.profile.team_id)
        self.assertEqual(outsider.unit_id, self.other_unit.id)  # was never in this unit

        log = AuditLog.objects.get(action='ORG_MEMBERS_REMOVED')
        self.assertEqual(log.metadata_json['user_ids'], [str(self.staff_user.id)])

    def test_a_leader_who_leaves_stops_leading(self):
        self.team.team_lead = self.staff_user
        self.team.save()
        self.unit.supervisor = self.staff_user
        self.unit.save()
        self.dep_eng.line_manager = self.staff_user
        self.dep_eng.save()

        self.as_root()
        response = self.client.post(
            reverse('department-members', kwargs={'pk': self.dep_hr.id}),
            {'action': 'add', 'user_ids': [self.staff_user.id]},
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)

        for group in (self.team, self.unit, self.dep_eng):
            group.refresh_from_db()
        self.assertIsNone(self.team.team_lead_id)
        self.assertIsNone(self.unit.supervisor_id)
        self.assertIsNone(self.dep_eng.line_manager_id)

    def test_editing_a_user_out_of_their_team_also_clears_their_leadership(self):
        self.team.team_lead = self.staff_user
        self.team.save()

        self.as_root()
        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}), {'team_id': None}
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.team.refresh_from_db()
        self.assertIsNone(self.team.team_lead_id)

    def test_a_user_cannot_be_placed_in_a_team_outside_their_unit(self):
        self.as_root()
        response = self.client.patch(
            reverse('users-detail', kwargs={'user_id': self.staff_user.id}),
            {'unit_id': str(self.other_unit.id), 'team_id': str(self.team.id)},
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.profile.refresh_from_db()
        self.assertEqual(self.profile.unit_id, self.unit.id)

    def test_deleting_a_department_with_members_is_a_conflict_not_a_crash(self):
        self.as_root()
        response = self.client.delete(reverse('department-detail', kwargs={'pk': self.dep_eng.id}))
        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(response.data['error']['type'], 'conflict')
        self.assertTrue(Department.objects.filter(pk=self.dep_eng.pk).exists())

    def test_changes_are_audited(self):
        self.as_root()
        created = self.client.post(reverse('department-list'), {'name': 'Legal', 'code': 'LEG'})
        self.assertEqual(created.status_code, status.HTTP_201_CREATED)
        detail = reverse('department-detail', kwargs={'pk': created.data['id']})
        self.client.patch(detail, {'name': 'Legal Affairs'})
        self.assertEqual(self.client.delete(detail).status_code, status.HTTP_204_NO_CONTENT)

        actions = list(
            AuditLog.objects.filter(target_type='department', target_id=created.data['id'])
            .order_by('created_at')
            .values_list('action', flat=True)
        )
        self.assertEqual(actions, ['ORG_GROUP_CREATED', 'ORG_GROUP_UPDATED', 'ORG_GROUP_DELETED'])

    def test_hierarchy_counts_active_members_without_a_query_per_group(self):
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        with CaptureQueriesContext(connection) as before:
            response = self.client.get(reverse('organization-hierarchy'))

        engineering = next(item for item in response.data if item['code'] == 'ENG')
        self.assertEqual(engineering['members_count'], 2)
        backend = next(item for item in engineering['units'] if item['code'] == 'BACK')
        self.assertEqual(backend['members_count'], 1)
        self.assertEqual(backend['teams'][0]['members_count'], 1)

        # A bigger tree costs the same number of queries.
        for index in range(5):
            department = Department.objects.create(name=f'Extra {index}', code=f'EX{index}')
            unit = Unit.objects.create(name=f'Extra unit {index}', code=f'EXU{index}', department=department)
            Team.objects.create(name=f'Extra team {index}', code=f'EXT{index}', unit=unit)
        with CaptureQueriesContext(connection) as after:
            self.client.get(reverse('organization-hierarchy'))
        self.assertLessEqual(len(after), len(before))
