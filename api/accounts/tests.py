from django.contrib.auth.models import User
from django.core.exceptions import ValidationError
from django.test import TestCase

from accounts.models import StaffProfile
from organization.models import Department, Role, Team, Unit


class StaffProfileModelTests(TestCase):
    def setUp(self):
        self.role_staff = Role.objects.create(name='Staff', code='STAFF')
        self.role_ed = Role.objects.create(name='Executive Director', code='ED', has_global_access=True)

        self.user_lm = User.objects.create_user(username='lm', password='pwd')
        self.user_sup = User.objects.create_user(username='sup', password='pwd')
        self.user_tl = User.objects.create_user(username='tl', password='pwd')
        self.user_staff = User.objects.create_user(username='staff', password='pwd')
        self.user_ed = User.objects.create_user(username='ed', password='pwd')

        self.department = Department.objects.create(name='Engineering', code='ENG', line_manager=self.user_lm)
        self.unit = Unit.objects.create(name='Backend', code='BACK', department=self.department, supervisor=self.user_sup)
        self.team = Team.objects.create(name='API', code='API', unit=self.unit, team_lead=self.user_tl)

    def test_direct_manager_resolution(self):
        # 1. User in team -> should return team lead
        profile1 = StaffProfile(user=self.user_staff, role=self.role_staff, team=self.team)
        profile1.clean()  # Should auto-fill unit and department
        self.assertEqual(profile1.direct_manager, self.user_tl)
        self.assertEqual(profile1.unit, self.unit)
        self.assertEqual(profile1.department, self.department)

        # 2. User in unit but no team -> should return supervisor
        profile2 = StaffProfile(user=self.user_staff, role=self.role_staff, unit=self.unit)
        profile2.clean()
        self.assertEqual(profile2.direct_manager, self.user_sup)

        # 3. User in department but no unit -> should return line manager
        profile3 = StaffProfile(user=self.user_staff, role=self.role_staff, department=self.department)
        profile3.clean()
        self.assertEqual(profile3.direct_manager, self.user_lm)

        # 4. User nowhere -> should return None
        profile4 = StaffProfile(user=self.user_staff, role=self.role_staff)
        self.assertIsNone(profile4.direct_manager)

    def test_display_title_resolution(self):
        # 1. Global role overrides everything
        profile_ed = StaffProfile.objects.create(user=self.user_ed, role=self.role_ed, department=self.department)
        self.assertEqual(profile_ed.display_title, 'Executive Director')

        # 2. Structural role: Line Manager
        profile_lm = StaffProfile.objects.create(user=self.user_lm, role=self.role_staff, department=self.department)
        self.assertEqual(profile_lm.display_title, 'Line Manager')

        # 3. Structural role: Supervisor
        profile_sup = StaffProfile.objects.create(user=self.user_sup, role=self.role_staff, unit=self.unit)
        profile_sup.clean()
        profile_sup.save()
        self.assertEqual(profile_sup.display_title, 'Supervisor')

        # 4. Structural role: Team Lead
        profile_tl = StaffProfile.objects.create(user=self.user_tl, role=self.role_staff, team=self.team)
        profile_tl.clean()
        profile_tl.save()
        self.assertEqual(profile_tl.display_title, 'Team Lead')

        # 5. Base staff
        profile_staff = StaffProfile.objects.create(user=self.user_staff, role=self.role_staff, team=self.team)
        profile_staff.clean()
        profile_staff.save()
        self.assertEqual(profile_staff.display_title, 'Staff')

    def test_clean_validation_hierarchy_mismatch(self):
        other_dept = Department.objects.create(name='HR', code='HR')
        other_unit = Unit.objects.create(name='Recruiting', code='REC', department=other_dept)

        # Team unit mismatch
        profile = StaffProfile(user=self.user_staff, role=self.role_staff, team=self.team, unit=other_unit)
        with self.assertRaises(ValidationError):
            profile.clean()

        # Unit department mismatch
        profile2 = StaffProfile(user=self.user_staff, role=self.role_staff, unit=self.unit, department=other_dept)
        with self.assertRaises(ValidationError):
            profile2.clean()
