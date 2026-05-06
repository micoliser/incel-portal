from pathlib import Path
from tempfile import NamedTemporaryFile

from django.contrib.auth.models import User
from django.core.management import call_command
from django.test import TestCase

from accounts.models import StaffProfile
from organization.models import Department, Role


class ImportUsersFromCsvCommandTests(TestCase):
    def test_import_creates_departments_and_users_and_skips_blank_emails(self):
        csv_content = """First Name,Last Name,Other Names,Official Email Address,Passwords,Sex,Departments
Aileen,Lamberte,Lulu,aileen@example.com,Incel@123,Female,Operations
Chibuzo,Ewelachi,Jephtha,,Incel@123,Male,Admin
Barry,Nwachukwu,Ogbu,barry@example.com,Incel@123,Male,Tourism
"""

        with NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as tmp:
            tmp.write(csv_content)
            tmp_path = Path(tmp.name)

        try:
            call_command("import_users_from_csv", str(tmp_path))
        finally:
            tmp_path.unlink(missing_ok=True)

        self.assertEqual(Department.objects.count(), 3)
        self.assertTrue(Department.objects.filter(name="Admin").exists())
        self.assertTrue(Department.objects.filter(name="Operations").exists())
        self.assertTrue(Department.objects.filter(name="Tourism").exists())

        self.assertEqual(User.objects.count(), 2)
        self.assertTrue(User.objects.filter(username="aileen@example.com").exists())
        self.assertTrue(User.objects.filter(username="barry@example.com").exists())
        self.assertFalse(User.objects.filter(username="").exists())

        staff_role = Role.objects.get(code="STAFF")
        self.assertEqual(staff_role.name, "Staff")

        aileen = User.objects.get(username="aileen@example.com")
        self.assertTrue(aileen.check_password("Incel@123"))
        self.assertEqual(aileen.first_name, "Aileen")
        self.assertEqual(aileen.last_name, "Lamberte")

        aileen_profile = StaffProfile.objects.get(user=aileen)
        self.assertEqual(aileen_profile.department.name, "Operations")
        self.assertEqual(aileen_profile.role.code, "STAFF")
