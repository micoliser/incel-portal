import io
import json
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from openpyxl import Workbook, load_workbook

from accounts.models import StaffProfile
from applications.models import AuditLog
from clients.models import CreditClient, CreditClientChange, CreditClientImport
from common.test_utils import BaseAPITestCase
from organization.models import Department, Unit

User = get_user_model()
BASE = '/api/v1/clients'


CONTACT_HEADERS = ['Contact Person', 'Phone', 'Email']
CONTACT_VALUES = ['Ada Obi', '+234 803 123 4567', 'ada@example.com']
CONTACT = {'contact_person': 'Ada Obi', 'phone': '+234 803 123 4567', 'email': 'ada@example.com'}


def with_contacts(rows):
    """Contact person, phone and email are required; most tests are about other
    columns, so they are added here unless the header already has them."""
    if not rows or any(str(cell).strip().lower() == 'email' for cell in rows[0]):
        return rows
    return [rows[0] + CONTACT_HEADERS] + [row + CONTACT_VALUES for row in rows[1:]]


def xlsx(rows, name='clients.xlsx', contacts=True):
    rows = with_contacts(rows) if contacts else rows
    workbook = Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    output = io.BytesIO()
    workbook.save(output)
    return SimpleUploadedFile(name, output.getvalue())


def csv_file(text, name='clients.csv'):  # used as written: include every required column
    return SimpleUploadedFile(name, text.encode('utf-8'))


HEADER = ['Name', 'TIN', 'Credit Limit', 'Credit Days', 'Credit Utilization', 'Currency', 'Status']


class ClientTestBase(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.tourism = Department.objects.create(name='Tourism', code='TOURISM', manager_views_credit_clients=True)
        self.trading = Department.objects.create(name='Trading', code='TRADING')
        self.control = Department.objects.create(name='Internal Control', code='INTERNAL_CONTROL')
        self.operations = Unit.objects.create(
            department=self.tourism, name='Operations', code='operations',
            credit_client_access=Unit.CreditClientAccess.SUPERVISOR_MANAGES,
        )
        self.sales = Unit.objects.create(department=self.tourism, name='Sales', code='sales')
        self.accounts = Unit.objects.create(
            department=self.trading, name='Tourism Accounts', code='tourism-accounts',
            credit_client_access=Unit.CreditClientAccess.MANAGE,
        )
        self.tic = Unit.objects.create(
            department=self.control, name='Tourism Internal Control', code='tourism-internal-control',
            credit_client_access=Unit.CreditClientAccess.VIEW,
        )
        self.supervisor = self.person('sup', self.tourism, self.operations)
        self.operations.supervisor = self.supervisor
        self.operations.save()
        self.ops_member = self.person('ops', self.tourism, self.operations)
        self.accountant = self.person('acc', self.trading, self.accounts)
        self.controller = self.person('tic', self.control, self.tic)
        self.tourism_manager = self.person('tm', self.tourism)
        self.tourism.line_manager = self.tourism_manager
        self.tourism.save()
        self.sales_member = self.person('sales', self.tourism, self.sales)
        self.trading_manager = self.person('trm', self.trading)
        self.trading.line_manager = self.trading_manager
        self.trading.save()
        self.ed = self.admin_user  # role ED (global access) in the base class
        self.superuser = User.objects.create_superuser(username='root', email='root@example.com', password='x')

    def person(self, name, department, unit=None):
        user = User.objects.create_user(username=f'{name}@example.com', email=f'{name}@example.com', password='x')
        StaffProfile.objects.create(user=user, role=self.role_staff, department=department, unit=unit)
        return user

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def make_client(self, **overrides):
        data = {
            'name': 'Acme Travels', 'tin': '12345678-0001', 'credit_limit': Decimal('1000000.00'),
            'credit_days': 30,
        }
        data.update(overrides)
        return CreditClient.objects.create(**data)


class AccessTests(ClientTestBase):
    def test_who_can_view_and_manage(self):
        managers = [self.supervisor, self.accountant, self.superuser]
        viewers = [self.ops_member, self.controller, self.tourism_manager, self.ed]
        outsiders = [self.sales_member, self.trading_manager, self.staff_user]
        payload = {'name': 'New Co', 'tin': '87654321', 'credit_limit': '500', 'credit_days': '15', **CONTACT}
        for index, user in enumerate(managers):
            self.as_user(user)
            self.assertEqual(self.client.get(BASE).status_code, 200, user)
            response = self.client.post(BASE, {**payload, 'name': f'New Co {index}', 'tin': f'8765432{index}'})
            self.assertEqual(response.status_code, 201, (user, response.data))
        for user in viewers:
            self.as_user(user)
            self.assertEqual(self.client.get(BASE).status_code, 200, user)
            self.assertEqual(self.client.post(BASE, payload).status_code, 403, user)
            self.assertEqual(self.client.get(f'{BASE}/imports/template').status_code, 403, user)
        for user in outsiders:
            self.as_user(user)
            self.assertEqual(self.client.get(BASE).status_code, 403, user)

    def test_rights_follow_the_records(self):
        # A new Operations supervisor manages; the old one only views.
        self.operations.supervisor = self.ops_member
        self.operations.save()
        self.as_user(self.ops_member)
        self.assertTrue(self.client.get('/api/v1/me').data['can_manage_clients'])
        self.as_user(self.supervisor)
        me = self.client.get('/api/v1/me').data
        self.assertTrue(me['can_view_clients'])
        self.assertFalse(me['can_manage_clients'])

    def test_no_delete_and_no_put(self):
        client = self.make_client()
        self.as_user(self.accountant)
        self.assertEqual(self.client.delete(f'{BASE}/{client.id}').status_code, 405)
        self.assertEqual(self.client.put(f'{BASE}/{client.id}', {}).status_code, 405)


class FormTests(ClientTestBase):
    def setUp(self):
        super().setUp()
        self.as_user(self.accountant)

    def test_create_validates_every_field(self):
        response = self.client.post(BASE, {
            'name': '', 'tin': 'abc', 'contact_person': ' ', 'phone': '12', 'email': 'nope', 'credit_limit': '0',
            'credit_days': '1.5', 'credit_utilization': '-1', 'currency': 'XYZ', 'status': 'maybe',
        })
        self.assertEqual(response.status_code, 400)
        details = response.data['error']['details']
        for field in ('name', 'tin', 'contact_person', 'phone', 'email', 'credit_limit', 'credit_days', 'credit_utilization', 'currency', 'status'):
            self.assertIn(field, details)

    def test_create_and_balance(self):
        response = self.client.post(BASE, {
            'name': '  Blue   Sky Ltd ', 'tin': '1234 5678', 'credit_limit': '1,500,000.50', 'credit_days': '30',
            'credit_utilization': '500000', 'currency': 'usd', 'email': 'Accounts@BlueSky.com', 'phone': '+234 803 123 4567',
            'contact_person': 'Bola Ade',
        })
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['name'], 'Blue Sky Ltd')
        self.assertEqual(response.data['tin'], '12345678')
        self.assertEqual(response.data['currency'], 'USD')
        self.assertEqual(response.data['status'], 'active')
        self.assertEqual(response.data['email'], 'accounts@bluesky.com')
        self.assertEqual(response.data['available_balance'], '1000000.50')
        client = CreditClient.objects.get()
        self.assertEqual(client.changes.get().source, CreditClientChange.Source.CREATED)
        self.assertTrue(AuditLog.objects.filter(action='CREDIT_CLIENT_CREATED').exists())

    def test_contact_person_phone_and_email_are_required(self):
        response = self.client.post(BASE, {'name': 'X', 'tin': '12345678', 'credit_limit': '10', 'credit_days': 1})
        details = response.data['error']['details']
        self.assertEqual(set(details), {'contact_person', 'phone', 'email'})
        response = self.client.post(BASE, {
            'name': 'X', 'tin': '12345678', 'credit_limit': '10', 'credit_days': 1,
            'contact_person': '', 'phone': '', 'email': '',
        })
        self.assertEqual(response.data['error']['details']['email'][0], 'Email is required.')

    def test_more_than_two_decimals_is_rejected(self):
        response = self.client.post(BASE, {'name': 'X', 'tin': '12345678', 'credit_limit': '10.005', 'credit_days': 1, **CONTACT})
        self.assertIn('credit_limit', response.data['error']['details'])

    def test_duplicates_are_rejected(self):
        self.make_client()
        response = self.client.post(BASE, {'name': 'ACME travels', 'tin': '99999999', 'credit_limit': '1', 'credit_days': 1, **CONTACT})
        self.assertIn('name', response.data['error']['details'])
        response = self.client.post(BASE, {'name': 'Other', 'tin': '12345678-0001', 'credit_limit': '1', 'credit_days': 1, **CONTACT})
        self.assertIn('tin', response.data['error']['details'])

    def test_edit_records_old_and_new_values(self):
        client = self.make_client()
        response = self.client.patch(f'{BASE}/{client.id}', {'credit_limit': '2000000'}, format='json')
        self.assertEqual(response.status_code, 200, response.data)
        change = client.changes.get()
        self.assertEqual(change.source, 'edited')
        self.assertEqual(change.changes, {'credit_limit': ['1000000.00', '2000000.00']})
        self.assertEqual(change.changed_by, self.accountant)
        history = self.client.get(f'{BASE}/{client.id}/history').data
        self.assertEqual(history['count'], 1)
        # Renaming to its own name (different case) is not a duplicate of itself.
        self.assertEqual(self.client.patch(f'{BASE}/{client.id}', {'name': 'ACME TRAVELS'}, format='json').status_code, 200)

    def test_search_and_filters(self):
        self.make_client()
        self.make_client(name='Zulu Ltd', tin='11112222', currency='USD', status='inactive')
        self.assertEqual(self.client.get(BASE, {'search': 'zulu'}).data['count'], 1)
        self.assertEqual(self.client.get(BASE, {'currency': 'USD'}).data['count'], 1)
        self.assertEqual(self.client.get(BASE, {'status': 'active'}).data['count'], 1)
        self.assertEqual(self.client.get(BASE, {'status': 'bad'}).status_code, 400)


class ImportTests(ClientTestBase):
    def setUp(self):
        super().setUp()
        self.as_user(self.supervisor)

    def preview(self, upload):
        return self.client.post(f'{BASE}/imports/preview', {'file': upload}, format='multipart')

    def confirm(self, upload, decisions=None):
        return self.client.post(
            f'{BASE}/imports/confirm',
            {'file': upload, 'confirmed': 'true', 'decisions': json.dumps(decisions or {})},
            format='multipart',
        )

    def test_template_has_the_expected_headers(self):
        response = self.client.get(f'{BASE}/imports/template')
        self.assertEqual(response.status_code, 200)
        sheet = load_workbook(io.BytesIO(response.content)).worksheets[0]
        headers = [cell.value for cell in sheet[1]]
        self.assertEqual(headers[:2], ['Name', 'TIN'])
        self.assertIn('Credit Utilization', headers)
        self.assertNotIn('Available Balance', headers)

    def test_headers_match_ignoring_case_spaces_underscores_and_hyphens(self):
        upload = xlsx([['  NAME ', 'tin', 'credit_limit', 'Credit-Days'], ['A Co', '12345678', 100, 30]])
        data = self.preview(upload).data
        self.assertEqual(data['column_errors'], [])
        self.assertTrue(data['can_import'])

    def test_missing_required_columns_reject_the_file(self):
        data = self.preview(xlsx([['Name', 'Limit'], ['A', 1]], contacts=False)).data
        self.assertFalse(data['can_import'])
        for column in ('Contact Person', 'Phone', 'Email'):
            self.assertIn(column, data['column_errors'][0])
        self.assertIn('TIN', data['column_errors'][0])
        self.assertIn('Credit Limit', data['column_errors'][0])
        self.assertIn('Credit Days', data['column_errors'][0])
        self.assertEqual(data['notices'], [])

    def test_repeated_column_rejects_the_file(self):
        data = self.preview(xlsx([['Name', 'TIN', 'tin', 'Credit Limit', 'Credit Days'], ['A', '12345678', '1', 1, 1]])).data
        self.assertFalse(data['can_import'])

    def test_row_errors_are_listed_by_row_and_field_and_nothing_saves(self):
        upload = xlsx([
            HEADER,
            ['Good Co', '12345678', 100, 30, 0, 'NGN', 'Active'],
            ['', 'abc', -5, 'x', 0, 'YEN', 'Active'],
        ])
        data = self.preview(upload).data
        self.assertFalse(data['can_import'])
        fields = {(error['row'], error['field']) for error in data['row_errors']}
        self.assertEqual(fields, {(3, 'name'), (3, 'tin'), (3, 'credit_limit'), (3, 'credit_days'), (3, 'currency')})
        upload.seek(0)
        self.assertEqual(self.confirm(upload).status_code, 409)
        self.assertFalse(CreditClient.objects.exists())

    def test_blank_contact_cells_are_row_errors(self):
        upload = xlsx([
            ['Name', 'TIN', 'Credit Limit', 'Credit Days', 'Contact Person', 'Phone', 'Email'],
            ['A Co', '12345678', 100, 30, '', None, '  '],
        ])
        data = self.preview(upload).data
        self.assertEqual({error['field'] for error in data['row_errors']}, {'contact_person', 'phone', 'email'})

    def test_notices_for_missing_and_ignored_columns(self):
        upload = xlsx([
            ['Name', 'TIN', 'Credit Limit', 'Credit Days', 'Available Balance', 'Region'],
            ['A Co', '12345678', 100, 30, 999, 'Lagos'],
        ])
        data = self.preview(upload).data
        self.assertTrue(data['can_import'])
        codes = {notice['code'] for notice in data['notices']}
        self.assertEqual(codes, {
            'unrecognised_columns', 'default_status', 'default_currency', 'default_credit_utilization',
            'available_balance_ignored',
        })
        upload.seek(0)
        self.assertEqual(self.confirm(upload).status_code, 201)
        client = CreditClient.objects.get()
        self.assertEqual((client.status, client.currency, client.credit_utilization), ('active', 'NGN', Decimal('0')))

    def test_over_limit_is_allowed_with_a_notice(self):
        upload = xlsx([HEADER, ['A Co', '12345678', 100, 30, 150, 'NGN', 'Active']])
        data = self.preview(upload).data
        over = [notice for notice in data['notices'] if notice['code'] == 'over_limit']
        self.assertEqual(over[0]['rows'][0]['available_balance'], '-50.00')
        upload.seek(0)
        self.assertEqual(self.confirm(upload).status_code, 201)
        self.assertEqual(CreditClient.objects.get().available_balance, Decimal('-50.00'))

    def test_confirm_needs_confirmation(self):
        upload = xlsx([HEADER, ['A Co', '12345678', 100, 30, 0, 'NGN', 'Active']])
        response = self.client.post(f'{BASE}/imports/confirm', {'file': upload}, format='multipart')
        self.assertEqual(response.status_code, 400)

    def test_existing_duplicate_update_or_reject(self):
        acme = self.make_client(credit_utilization=Decimal('300'))
        rows = [
            ['Name', 'TIN', 'Credit Limit', 'Credit Days'],
            ['acme travels', '55555555', 5000, 45],  # same name as existing
            ['New Co', '66666666', 100, 10],
        ]
        data = self.preview(xlsx(rows)).data
        self.assertEqual(len(data['duplicates']), 1)
        group = data['duplicates'][0]
        self.assertEqual(group['existing']['id'], str(acme.id))
        self.assertEqual(data['summary'], {'rows': 2, 'new': 1, 'duplicate_groups': 1})

        # No decision: refused.
        self.assertEqual(self.confirm(xlsx(rows)).status_code, 409)

        response = self.confirm(xlsx(rows), {group['id']: 2})
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual((response.data['created_count'], response.data['updated_count']), (1, 1))
        acme.refresh_from_db()
        self.assertEqual((acme.tin, acme.credit_limit, acme.credit_days), ('55555555', Decimal('5000.00'), 45))
        # Columns missing from the file keep the client's values on update.
        self.assertEqual(acme.credit_utilization, Decimal('300.00'))
        change = acme.changes.get()
        self.assertEqual(change.source, 'imported')
        self.assertIn('credit_limit', change.changes)
        self.assertEqual(CreditClientImport.objects.get().uploaded_by, self.supervisor)

    def test_reject_keeps_existing(self):
        acme = self.make_client()
        rows = [['Name', 'TIN', 'Credit Limit', 'Credit Days'], ['Other name', '12345678-0001', 1, 1]]
        group = self.preview(xlsx(rows)).data['duplicates'][0]
        response = self.confirm(xlsx(rows), {group['id']: 'reject'})
        self.assertEqual(response.data['rejected_count'], 1)
        acme.refresh_from_db()
        self.assertEqual(acme.name, 'Acme Travels')

    def test_duplicates_within_the_file_pick_one(self):
        rows = [
            ['Name', 'TIN', 'Credit Limit', 'Credit Days'],
            ['Dup Co', '11111111', 100, 1],
            ['Another', '11111111', 200, 2],  # same TIN as row 2
            ['dup co', '22222222', 300, 3],  # same name as row 2
        ]
        data = self.preview(xlsx(rows)).data
        self.assertEqual(len(data['duplicates']), 1)
        group = data['duplicates'][0]
        self.assertEqual([row['row'] for row in group['rows']], [2, 3, 4])
        self.assertIsNone(group['existing'])
        self.assertEqual(self.confirm(xlsx(rows), {group['id']: 9}).status_code, 409)
        response = self.confirm(xlsx(rows), {group['id']: 3})
        self.assertEqual((response.data['created_count'], response.data['rejected_count']), (1, 2))
        self.assertEqual(CreditClient.objects.get().name, 'Another')

    def test_row_matching_two_existing_clients_is_an_error(self):
        self.make_client()
        self.make_client(name='Zulu Ltd', tin='11112222')
        rows = [['Name', 'TIN', 'Credit Limit', 'Credit Days'], ['Zulu Ltd', '12345678-0001', 1, 1]]
        data = self.preview(xlsx(rows)).data
        self.assertFalse(data['can_import'])
        self.assertEqual(data['row_errors'][0]['row'], 2)

    def test_csv_and_bad_files(self):
        data = self.preview(csv_file(
            'name,tin,credit limit,credit days,contact person,phone,email\n'
            'A Co,12345678,"1,000.50",30,Ada,08031234567,ada@example.com\n'
        )).data
        self.assertTrue(data['can_import'])
        self.assertEqual(data['rows'][0]['values']['credit_limit'], '1000.50')
        self.assertEqual(self.preview(SimpleUploadedFile('a.xls', b'x')).status_code, 400)
        self.assertEqual(self.preview(SimpleUploadedFile('a.pdf', b'x')).status_code, 400)
        self.assertEqual(self.preview(SimpleUploadedFile('a.xlsx', b'not a zip')).status_code, 400)
        self.assertEqual(self.preview(SimpleUploadedFile('a.csv', b'\xff\xfe\x00bad')).status_code, 400)
        self.assertFalse(self.preview(xlsx([['Name', 'TIN', 'Credit Limit', 'Credit Days']], contacts=False)).data['can_import'])

    def test_numbers_from_excel_cells(self):
        # A TIN typed as a number arrives as an int; whole floats lose ".0".
        upload = xlsx([
            ['Name', 'TIN', 'Credit Limit', 'Credit Days', 'Phone', 'Contact Person', 'Email'],
            ['A Co', 12345678, 100.5, 30.0, 8031234567, 'Ada', 'ada@example.com'],
        ])
        data = self.preview(upload).data
        self.assertTrue(data['can_import'], data)
        self.assertEqual(data['rows'][0]['values']['tin'], '12345678')
        self.assertEqual(data['rows'][0]['values']['credit_days'], 30)

    def test_viewers_cannot_import(self):
        self.as_user(self.controller)
        upload = xlsx([HEADER, ['A Co', '12345678', 100, 30, 0, 'NGN', 'Active']])
        self.assertEqual(self.preview(upload).status_code, 403)
        self.assertEqual(self.client.get(f'{BASE}/imports').status_code, 200)
