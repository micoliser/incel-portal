from pathlib import Path
from tempfile import NamedTemporaryFile

from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.test import TestCase

from accounts.models import StaffProfile
from organization.models import Department, Role

User = get_user_model()


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

        self.assertGreaterEqual(Department.objects.count(), 3)
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
        # No password is set, and a password column in the file is ignored.
        self.assertFalse(aileen.has_usable_password())
        self.assertEqual(aileen.first_name, "Aileen")
        self.assertEqual(aileen.last_name, "Lamberte")

        aileen_profile = StaffProfile.objects.get(user=aileen)
        self.assertEqual(aileen_profile.department.name, "Operations")
        self.assertEqual(aileen_profile.role.code, "STAFF")
