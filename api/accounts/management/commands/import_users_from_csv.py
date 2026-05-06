from __future__ import annotations

import csv
from pathlib import Path

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError

from accounts.models import StaffProfile
from organization.models import Department, Role


class Command(BaseCommand):
    help = "Import departments and users from a CSV file."

    def add_arguments(self, parser):
        parser.add_argument("csv_file", type=str, help="Path to the CSV file")

    def handle(self, *args, **options):
        csv_path = Path(options["csv_file"])
        if not csv_path.exists():
            raise CommandError(f"CSV file does not exist: {csv_path}")

        with csv_path.open("r", encoding="utf-8-sig", newline="") as handle:
            rows = list(csv.DictReader(handle))

        department_names = []
        for row in rows:
            department_name = (row.get("Departments") or "").strip()
            if department_name:
                department_names.append(department_name)

        department_map = {}
        created_departments = 0
        for department_name in sorted(set(department_names)):
            base_code = "".join(ch for ch in department_name.upper() if ch.isalnum())[:50]
            code = base_code or "DEPT"
            suffix = 1
            while Department.objects.filter(code=code).exclude(name=department_name).exists():
                suffix_text = f"-{suffix}"
                code = f"{base_code[:50 - len(suffix_text)]}{suffix_text}"
                suffix += 1

            department, created = Department.objects.get_or_create(
                name=department_name,
                defaults={"code": code},
            )
            if not created and department.code != code:
                Department.objects.filter(pk=department.pk).update(code=code)
                department.code = code
            department_map[department_name] = department
            created_departments += int(created)

        staff_role, _ = Role.objects.get_or_create(
            code="STAFF",
            defaults={"name": "Staff", "has_global_access": False},
        )

        created_users = 0
        skipped_rows = 0
        updated_profiles = 0

        for row in rows:
            email = (row.get("Official Email Address") or "").strip().lower()
            if not email:
                skipped_rows += 1
                continue

            first_name = (row.get("First Name") or "").strip()
            last_name = (row.get("Last Name") or "").strip()
            password = (row.get("Passwords") or "Incel@123").strip()
            department_name = (row.get("Departments") or "").strip()
            department = department_map.get(department_name)

            user, created = User.objects.get_or_create(
                username=email,
                defaults={
                    "email": email,
                    "first_name": first_name,
                    "last_name": last_name,
                },
            )
            if created:
                user.set_password(password)
                user.save()
                created_users += 1
            else:
                changed = False
                if user.email != email:
                    user.email = email
                    changed = True
                if user.first_name != first_name:
                    user.first_name = first_name
                    changed = True
                if user.last_name != last_name:
                    user.last_name = last_name
                    changed = True
                if changed:
                    user.save(update_fields=["email", "first_name", "last_name"])

            profile, profile_created = StaffProfile.objects.get_or_create(
                user=user,
                defaults={"role": staff_role, "department": department},
            )
            if not profile_created:
                profile.role = staff_role
                profile.department = department
                profile.save(update_fields=["role", "department"])
                updated_profiles += 1

        self.stdout.write(self.style.SUCCESS("Import complete."))
        self.stdout.write(f"Departments created: {created_departments}")
        self.stdout.write(f"Users created: {created_users}")
        self.stdout.write(f"Rows skipped due to blank email: {skipped_rows}")
        self.stdout.write(f"Profiles updated: {updated_profiles}")
