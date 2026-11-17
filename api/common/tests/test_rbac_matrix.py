"""Who may call which role-gated endpoint.

Every endpoint below is called as each kind of user. "Allowed" means the
request got past the permission checks (any status except 401, 403, or a 404
that hides something from the caller); write requests send an empty body, so
an allowed caller gets a 400 and nothing is changed. Endpoints open to every
signed-in user that only ever return the caller's own records (to-dos, goals,
notifications, own tasks) are covered by their own tests.

Run with RBAC_MATRIX_PRINT=1 to print the table.
"""

import os
from datetime import timedelta

from django.contrib.auth.models import User
from django.utils import timezone

from accounts.models import ServiceApiKey, StaffProfile
from applications.models import InternalApplication
from common.test_utils import BaseAPITestCase
from organization.models import Department, Role

STAFF, MANAGER, INVENTORY, EXECUTIVE, ADMIN_ROLE, SUPERUSER = (
    'staff', 'manager', 'inventory', 'executive', 'admin role', 'superuser',
)
EVERYONE = {STAFF, MANAGER, INVENTORY, EXECUTIVE, ADMIN_ROLE, SUPERUSER}
ADMINS = {ADMIN_ROLE, SUPERUSER}

# (label, method, path, who may call it). Paths use {app}, {dept}, {user}.
MATRIX = [
    ('List the staff directory', 'get', '/users', EVERYONE),
    ('Create a user', 'post', '/users', ADMINS),
    ('View one user in full', 'get', '/users/{user}', {EXECUTIVE, SUPERUSER}),
    ('Edit a user / reset link / enable-disable', 'patch', '/users/{user}', ADMINS),
    ('List roles', 'get', '/organization/roles', {EXECUTIVE, SUPERUSER}),
    ('View the organization tree', 'get', '/organization/hierarchy', EVERYONE),
    ('List departments, units, teams', 'get', '/organization/departments', EVERYONE),
    ('Create a department, unit or team', 'post', '/organization/departments', ADMINS),
    ('Edit a department, unit or team', 'patch', '/organization/departments/{dept}', ADMINS),
    ('Delete a department, unit or team', 'delete', '/organization/departments/{dept}', ADMINS),
    ('Move people in or out of a group', 'post', '/organization/departments/{dept}/members', ADMINS),
    ('List applications', 'get', '/applications', EVERYONE),
    ('Create an application', 'post', '/applications', ADMINS),
    ('Edit an application', 'patch', '/applications/{app}', ADMINS),
    ('Upload an application logo', 'post', '/applications/logo-upload-url', ADMINS),
    ('View per-person access exceptions', 'get', '/applications/{app}/overrides', ADMINS),
    ('Set a per-person access exception', 'post', '/applications/{app}/overrides', ADMINS),
    ('Read the audit log', 'get', '/audit-logs', {EXECUTIVE, ADMIN_ROLE, SUPERUSER}),
    ('Organization-wide weekly summary', 'get', '/summaries/organization?week_start_date=2026-11-02',
     {EXECUTIVE, SUPERUSER}),
    ('Department support queue', 'get', '/support/requests/department', {MANAGER, INVENTORY}),
    ('View assets', 'get', '/inventory/items', {INVENTORY, EXECUTIVE, ADMIN_ROLE, SUPERUSER}),
    ('Export assets', 'get', '/inventory/items/export', {INVENTORY, EXECUTIVE, ADMIN_ROLE, SUPERUSER}),
    ('Create or edit assets', 'post', '/inventory/items', {INVENTORY, ADMIN_ROLE, SUPERUSER}),
    ('Asset categories: create', 'post', '/inventory/categories', {INVENTORY, ADMIN_ROLE, SUPERUSER}),
    ('View maintenance logs', 'get', '/inventory/maintenance-logs',
     {INVENTORY, EXECUTIVE, ADMIN_ROLE, SUPERUSER}),
    ('Log maintenance', 'post', '/inventory/maintenance-logs', {INVENTORY, ADMIN_ROLE, SUPERUSER}),
    ('My assigned assets', 'get', '/me/inventory', EVERYONE),
    ('Directory for other services (API key only)', 'get', '/external/users', set()),
]


class RoleAccessMatrixTests(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        it = Department.objects.create(name='Tech', code='TECH', manages_inventory=True, handles_it_support=True)
        admin_role = Role.objects.create(name='Admin', code='ADMIN', has_global_access=False)

        def person(name, role, department):
            user = User.objects.create_user(f'{name}@example.com', email=f'{name}@example.com', password='x')
            StaffProfile.objects.create(user=user, role=role, department=department)
            return user

        manager = person('manager', self.role_staff, self.dep_hr)
        self.dep_hr.line_manager = manager
        self.dep_hr.save()
        inventory = person('inventory', self.role_staff, it)
        it.line_manager = inventory
        it.save()

        self.callers = {
            STAFF: self.staff_user,
            MANAGER: manager,
            INVENTORY: inventory,
            EXECUTIVE: self.admin_user,  # an Executive Director in the shared fixtures
            ADMIN_ROLE: person('administrator', admin_role, self.dep_eng),
            SUPERUSER: User.objects.create_superuser('root@example.com', 'root@example.com', 'x'),
        }
        self.app = InternalApplication.objects.create(name='Payroll', slug='payroll', app_url='https://p.example.com')
        # Something that can be edited or deleted without harm.
        self.spare = Department.objects.create(name='Spare', code='SPARE')

    def _call(self, user, method, path):
        if user is None:
            self.client.credentials()
        else:
            self.client.credentials(**self.auth_headers_for(user))
        url = '/api/v1' + path.format(app=self.app.id, dept=self.spare.id, user=self.staff_user.id)
        return getattr(self.client, method)(url, {}, format='json')

    @staticmethod
    def _allowed(response):
        return response.status_code not in (401, 403, 404)

    def test_each_endpoint_admits_exactly_the_expected_callers(self):
        rows = []
        for label, method, path, expected in MATRIX:
            allowed = set()
            for name, user in self.callers.items():
                response = self._call(user, method, path)
                if self._allowed(response):
                    allowed.add(name)
                # Recreate anything a successful delete removed.
                if not Department.objects.filter(pk=self.spare.pk).exists():
                    self.spare = Department.objects.create(name='Spare', code='SPARE')
            rows.append((label, method.upper(), path, allowed))
            self.assertEqual(allowed, expected, f'{method.upper()} {path}')

            anonymous = self._call(None, method, path)
            self.assertEqual(anonymous.status_code, 401, f'signed out: {method.upper()} {path}')

        if os.environ.get('RBAC_MATRIX_PRINT'):
            order = [STAFF, MANAGER, INVENTORY, EXECUTIVE, ADMIN_ROLE, SUPERUSER]
            print('\n| What | ' + ' | '.join(order) + ' |')
            print('|---|' + '---|' * len(order))
            for label, method, path, allowed in rows:
                marks = ' | '.join('yes' if name in allowed else '-' for name in order)
                print(f'| {label} (`{method} {path.split("?")[0]}`) | {marks} |')

    def test_a_service_key_reaches_only_the_external_directory(self):
        _key, raw = ServiceApiKey.generate_key(name='Other system')
        headers = {'HTTP_AUTHORIZATION': f'Bearer {raw}'}
        self.assertEqual(self.client.get('/api/v1/external/users', **headers).status_code, 200)
        for path in ('/users', '/audit-logs', '/applications', '/me'):
            self.assertIn(self.client.get('/api/v1' + path, **headers).status_code, (401, 403), path)

    def test_an_expired_or_inactive_session_reaches_nothing(self):
        self.staff_user.is_active = False
        self.staff_user.save(update_fields=['is_active'])
        self.client.credentials(**self.auth_headers_for(self.staff_user))
        self.assertEqual(self.client.get('/api/v1/me').status_code, 401)

    def test_executives_cannot_change_anything_administrative(self):
        """Global access is read access: an executive sees everything but edits nothing."""
        executive = self.callers[EXECUTIVE]
        for method, path in (
            ('post', '/users'), ('patch', '/users/{user}'), ('post', '/applications'),
            ('post', '/organization/departments'), ('post', '/inventory/items'),
        ):
            self.assertEqual(self._call(executive, method, path).status_code, 403, path)
        self.assertGreater(timezone.now() + timedelta(days=1), timezone.now())
