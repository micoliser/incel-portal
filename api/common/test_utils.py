from django.contrib.auth.models import User
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import StaffProfile
from organization.models import Department, Role


class BaseAPITestCase(APITestCase):
    def setUp(self):
        super().setUp()
        self.role_staff = Role.objects.create(name='Staff', code='STAFF', has_global_access=False)
        self.role_ed = Role.objects.create(name='Executive Director', code='ED', has_global_access=True)
        self.role_md = Role.objects.create(name='Managing Director', code='MD', has_global_access=True)

        self.dep_eng = Department.objects.create(name='Engineering', code='ENG')
        self.dep_hr = Department.objects.create(name='Human Resources', code='HR')

        self.admin_user = User.objects.create_user(
            username='admin@example.com',
            email='admin@example.com',
            password='AdminStrongPass123!'
        )
        self.staff_user = User.objects.create_user(
            username='staff@example.com',
            email='staff@example.com',
            password='StaffStrongPass123!'
        )

        StaffProfile.objects.create(user=self.admin_user, role=self.role_ed, department=self.dep_eng)
        StaffProfile.objects.create(user=self.staff_user, role=self.role_staff, department=self.dep_eng)

    def auth_headers_for(self, user):
        refresh = RefreshToken.for_user(user)
        return {
            'HTTP_AUTHORIZATION': f'Bearer {str(refresh.access_token)}',
        }

    def login_payload(self, email='staff@example.com', password='StaffStrongPass123!'):
        return {
            'email': email,
            'password': password,
        }
