from datetime import date
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import override_settings

from accounts.models import StaffProfile
from applications.models import AuditLog
from clients.models import CreditClient
from common.test_utils import BaseAPITestCase
from notifications.models import Notification
from organization.models import Department, Unit
from service_requests.models import Audience, ServiceRequest
from service_requests.services import evidence_prefix, request_title

User = get_user_model()
BASE = '/api/v1/service-requests'


class RequestTestBase(BaseAPITestCase):
    def setUp(self):
        super().setUp()
        self.tourism = Department.objects.create(name='Tourism', code='TOURISM')
        self.control = Department.objects.create(name='Internal Control', code='IC')
        self.trading = Department.objects.create(name='Trading', code='TRADING')
        self.operations = Unit.objects.create(department=self.tourism, name='Operations', code='operations')
        self.sales = Unit.objects.create(department=self.tourism, name='Sales', code='sales')
        self.tic = Unit.objects.create(department=self.control, name='Tourism Internal Control', code='tic')
        self.accounts = Unit.objects.create(department=self.trading, name='Tourism Accounts', code='ta')

        self.ops_head = self.person('head', self.tourism, self.operations)
        self.operations.supervisor = self.ops_head
        self.operations.save()
        self.agent = self.person('agent', self.tourism, self.operations)
        self.agent2 = self.person('agent2', self.tourism, self.operations)
        self.sales_head = self.person('saleshead', self.tourism, self.sales)
        self.sales.supervisor = self.sales_head
        self.sales.save()
        self.manager = self.person('tm', self.tourism)
        self.tourism.line_manager = self.manager
        self.tourism.save()
        self.controller = self.person('ctl', self.control, self.tic)
        self.accountant = self.person('acc', self.trading, self.accounts)
        self.ed = self.admin_user  # role ED in the base class
        self.md_user = User.objects.create_user(username='md@example.com', email='md@example.com', password='x')
        StaffProfile.objects.create(user=self.md_user, role=self.role_md, department=self.dep_eng)
        self.outsider = self.staff_user

        def audience(purpose, kind, **target):
            Audience.objects.create(service='ticket', purpose=purpose, kind=kind, **target)

        audience('submit', 'unit_members', unit=self.operations)
        audience('notify', 'unit_members', unit=self.tic)
        audience('notify', 'unit_supervisor', unit=self.operations)
        audience('notify', 'department_manager', department=self.tourism)
        audience('notify', 'role', role=self.role_ed)
        audience('view', 'unit_members', unit=self.accounts)
        audience('first_approval', 'unit_supervisor', unit=self.sales)
        audience('first_approval', 'unit_supervisor', unit=self.operations)
        audience('first_approval', 'department_manager', department=self.tourism)
        audience('final_approval', 'role', role=self.role_ed)

        self.client_ngn = CreditClient.objects.create(
            name='Beamco', tin='12345678', credit_limit=Decimal('1000000'), credit_utilization=Decimal('200000'),
            credit_days=30, contact_person='A', phone='08031234567', email='a@b.com',
        )
        self.client_usd = CreditClient.objects.create(
            name='Desert Rose', tin='87654321', credit_limit=Decimal('20000'), credit_utilization=Decimal('0'),
            credit_days=30, currency='USD', contact_person='B', phone='08031234567', email='b@b.com',
        )

    def person(self, name, department, unit=None, role=None):
        user = User.objects.create_user(
            username=f'{name}@example.com', email=f'{name}@example.com', password='x', first_name=name.title(),
        )
        StaffProfile.objects.create(user=user, role=role or self.role_staff, department=department, unit=unit)
        return user

    def as_user(self, user):
        self.client.force_authenticate(user=user)

    def evidence(self, user=None, key='proof.pdf'):
        return {
            'object_key': f'{evidence_prefix(user or self.agent)}{key}', 'file_name': 'proof.pdf',
            'content_type': 'application/pdf', 'size': 1000,
        }

    def ticket(self, **overrides):
        data = {
            'payment_type': 'cash', 'party_type': 'client', 'client_name': 'AFRIWINGS',
            'passengers': ['STELLA CHIZENA ENOCK'], 'airline': 'ENUGU AIR', 'pnr': 'AB3ZKB',
            'departure_date': '2026-12-20', 'route': 'los-abv', 'vendor': 'ENUGU AIR PLATFORM',
            'selling_price': '149300', 'cost_price': '146300', 'amount_paid': '149300', 'evidence': self.evidence(),
        }
        data.update(overrides)
        return {key: value for key, value in data.items() if value is not ...}

    def credit_ticket(self, client=None, **overrides):
        base = {
            'payment_type': 'credit', 'client_id': str((client or self.client_ngn).id), 'client_name': ...,
            'amount_paid': ..., 'evidence': ...,
        }
        base.update(overrides)
        return self.ticket(**base)

    def submit(self, data, user=None):
        self.as_user(user or self.agent)
        return self.client.post(f'{BASE}/tickets', data, format='json')


class AccessTests(RequestTestBase):
    def test_only_operations_submit(self):
        for user in (self.agent, self.ops_head):
            response = self.submit(self.ticket(pnr=f'PNR{user.pk:03d}', evidence=self.evidence(user)), user=user)
            self.assertEqual(response.status_code, 201, response.data)
        for user in (self.sales_head, self.controller, self.accountant, self.ed, self.manager):
            response = self.submit(self.ticket(pnr='ZZZZZ1', evidence=self.evidence(user)), user=user)
            self.assertEqual(response.status_code, 403, user)

    def test_who_sees_requests(self):
        self.submit(self.ticket())
        for user in (self.agent2, self.ops_head, self.sales_head, self.manager, self.controller, self.accountant,
                     self.ed, self.md_user):
            self.as_user(user)
            self.assertEqual(self.client.get(BASE).data['count'], 1, user)
        self.as_user(self.outsider)
        self.assertEqual(self.client.get(BASE).status_code, 403)

    def test_a_superuser_only_views(self):
        root = User.objects.create_superuser(username='root', email='root@example.com', password='x')
        created = self.submit(self.credit_ticket(selling_price='900000', cost_price='800000')).data
        self.as_user(root)
        self.assertEqual(self.client.get(f'{BASE}/{created["id"]}').status_code, 200)
        self.assertEqual(self.client.post(f'{BASE}/{created["id"]}/approve').status_code, 403)
        me = self.client.get('/api/v1/me').data
        self.assertEqual((me['can_view_requests'], me['can_submit_requests'], me['can_approve_requests']), (True, False, False))
        self.assertEqual(self.submit(self.ticket(pnr='ROOT01', evidence=self.evidence(root)), user=root).status_code, 403)

    def test_me_flags(self):
        self.as_user(self.agent)
        me = self.client.get('/api/v1/me').data
        self.assertEqual((me['can_view_requests'], me['can_submit_requests'], me['can_approve_requests']), (True, True, False))
        self.as_user(self.ed)
        me = self.client.get('/api/v1/me').data
        self.assertEqual((me['can_view_requests'], me['can_submit_requests'], me['can_approve_requests']), (True, False, True))


class ValidationTests(RequestTestBase):
    def errors(self, data):
        response = self.submit(data)
        self.assertEqual(response.status_code, 400, response.data)
        return response.data['error']['details']

    def test_cash_ticket_goes_through(self):
        response = self.submit(self.ticket(passengers=['STELLA CHIZENA ENOCK', 'JOHN DOE']))
        self.assertEqual(response.status_code, 201, response.data)
        data = response.data
        self.assertEqual(data['status'], 'submitted')
        self.assertRegex(data['reference'], r'^TKT-\d{4}-00001$')
        self.assertEqual(data['title'], '[TICKET] Client: [AFRIWINGS_STELLA CHIZENA ENOCK +1 | Amount: ₦149,300]')
        self.assertEqual(data['revenue'], '3000.00')
        self.assertEqual(data['ticket']['route'], 'LOS-ABV')
        self.assertEqual(self.submit(self.ticket(pnr='XYZ123', evidence=self.evidence(key='b.pdf'))).data['reference'][-5:], '00002')

    def test_field_rules(self):
        details = self.errors(self.ticket(
            client_name='', passengers=['  '], pnr='ab', route='LOS ABV', departure_date='2026-12-20',
            return_date='2026-12-01',
        ))
        for field in ('client_name', 'passengers', 'pnr', 'route', 'return_date'):
            self.assertIn(field, details)

    def test_revenue_rules(self):
        self.assertIn('selling_price', self.errors(self.ticket(selling_price='100', cost_price='200', amount_paid='100')))
        details = self.errors(self.ticket(selling_price='200', cost_price='200', amount_paid='200'))
        self.assertEqual(details['confirm_zero_revenue'][0], 'There is no profit on this transaction. Confirm to submit anyway.')
        response = self.submit(self.ticket(selling_price='200', cost_price='200', amount_paid='200', confirm_zero_revenue=True))
        self.assertEqual(response.status_code, 201, response.data)

    def test_cash_needs_full_payment_and_evidence(self):
        details = self.errors(self.ticket(amount_paid='1000', evidence=None))
        self.assertIn('less than the selling price', str(details['amount_paid'][0]))
        self.assertIn('evidence', details)
        self.assertEqual(self.submit(self.ticket(amount_paid='200000')).status_code, 201)

    def test_evidence_must_be_an_image_or_pdf_uploaded_by_the_submitter(self):
        details = self.errors(self.ticket(evidence={**self.evidence(), 'content_type': 'text/html'}))
        self.assertIn('evidence', details)
        details = self.errors(self.ticket(evidence=self.evidence(user=self.agent2)))
        self.assertIn('not uploaded by you', str(details['evidence']))

    def test_discount_section(self):
        details = self.errors(self.ticket(party_type='affiliate', client_name='DEGENIUS'))
        self.assertEqual(set(details) & {'published_fare', 'net_commission', 'commission_given'},
                         {'published_fare', 'net_commission', 'commission_given'})
        details = self.errors(self.ticket(published_fare='1000', net_commission='2000', commission_given='3000'))
        self.assertIn('net_commission', details)
        self.assertIn('commission_given', details)
        response = self.submit(self.ticket(
            party_type='affiliate', client_name='DEGENIUS', published_fare='1000000', net_commission='200000',
            commission_given='50000', cost_price='1', selling_price='960000', amount_paid='960000',
        ))
        self.assertEqual(response.status_code, 201, response.data)
        # Cost = published fare - commission given; balance commission = net - given.
        self.assertEqual(response.data['cost_price'], '950000.00')
        self.assertEqual(response.data['ticket']['balance_commission'], '150000.00')
        self.assertEqual(response.data['revenue'], '10000.00')

    def test_pnr_cannot_be_on_two_live_requests(self):
        first = self.submit(self.ticket()).data
        details = self.errors(self.ticket(pnr='ab3zkb', evidence=self.evidence(key='b.pdf')))
        self.assertEqual(details['pnr'][0], 'Another request already uses this PNR.')
        self.client.post(f'{BASE}/{first["id"]}/cancel', {'reason': 'Typo'}, format='json')
        # Cancelled: the PNR, and the same evidence, can go on the new request.
        response = self.submit(self.ticket(created_from=first['id']))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(str(response.data['created_from']), str(first['id']))

    def test_other_currency_for_cash(self):
        details = self.errors(self.ticket(exchange_rate='1500'))
        self.assertIn('foreign_amount', details)
        self.assertIn('foreign_currency', details)
        details = self.errors(self.ticket(foreign_currency='USD', foreign_amount='90', exchange_rate='1500'))
        self.assertIn('less than the selling price', str(details['foreign_amount'][0]))
        response = self.submit(self.ticket(foreign_currency='usd', foreign_amount='100', exchange_rate='1500'))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['foreign_currency'], 'USD')


class CreditTests(RequestTestBase):
    def test_within_limit_uses_the_balance_at_once(self):
        response = self.submit(self.credit_ticket())
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['status'], 'submitted')
        self.assertEqual(response.data['client_name'], 'Beamco')
        self.assertEqual(response.data['credit'], {
            'currency': 'NGN', 'credit_limit': '1000000.00', 'utilization': '200000.00',
            'available_balance': '800000.00', 'requested_amount': '149300.00', 'balance_after_request': '650700.00',
        })
        self.client_ngn.refresh_from_db()
        self.assertEqual(self.client_ngn.credit_utilization, Decimal('349300.00'))
        change = self.client_ngn.changes.get()
        self.assertEqual((change.source, change.note), ('request', f'{response.data["reference"]} submitted'))

    def test_cancelling_gives_the_amount_back(self):
        created = self.submit(self.credit_ticket()).data
        response = self.client.post(f'{BASE}/{created["id"]}/cancel', {'reason': 'Client changed plans'}, format='json')
        self.assertEqual(response.data['status'], 'cancelled')
        self.client_ngn.refresh_from_db()
        self.assertEqual(self.client_ngn.credit_utilization, Decimal('200000.00'))

    def test_inactive_client_refused(self):
        self.client_ngn.status = 'inactive'
        self.client_ngn.save()
        self.assertIn('client_id', self.submit(self.credit_ticket()).data['error']['details'])

    def test_client_in_another_currency(self):
        details = self.submit(self.credit_ticket(client=self.client_usd)).data['error']['details']
        self.assertIn('foreign_amount', details)
        self.assertIn('exchange_rate', details)
        response = self.submit(self.credit_ticket(client=self.client_usd, foreign_amount='100', exchange_rate='1500'))
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data['credit']['requested_amount'], '100.00')
        self.client_usd.refresh_from_db()
        self.assertEqual(self.client_usd.credit_utilization, Decimal('100.00'))

    def test_over_limit_needs_two_approvals(self):
        mail.outbox = []
        created = self.submit(self.credit_ticket(selling_price='900000', cost_price='800000')).data
        self.assertEqual((created['status'], created['approval_stage']), ('pending_approval', 'first'))
        self.client_ngn.refresh_from_db()
        self.assertEqual(self.client_ngn.credit_utilization, Decimal('200000.00'))  # untouched until approved
        url = f'{BASE}/{created["id"]}'

        # The ED cannot give the first approval; a first-stage approver can.
        self.as_user(self.ed)
        self.assertEqual(self.client.post(f'{url}/approve').status_code, 403)
        self.as_user(self.sales_head)
        self.assertTrue(self.client.get(url).data['allowed']['approve'])
        self.assertEqual(self.client.get(f'{BASE}/awaiting-count').data['count'], 1)
        response = self.client.post(f'{url}/approve')
        self.assertEqual(response.data['approval_stage'], 'final')
        self.assertEqual(self.client.post(f'{url}/approve').status_code, 403)  # not a final approver

        self.as_user(self.ed)
        self.assertEqual(self.client.get(BASE, {'awaiting_me': 'true'}).data['count'], 1)
        response = self.client.post(f'{url}/approve')
        self.assertEqual(response.data['status'], 'approved')
        self.client_ngn.refresh_from_db()
        self.assertEqual(self.client_ngn.credit_utilization, Decimal('1100000.00'))
        self.assertEqual([d['decision'] for d in response.data['decisions']], ['approved', 'approved'])

        self.as_user(self.agent)
        self.assertEqual(self.client.post(f'{url}/complete').data['status'], 'completed')
        self.assertTrue(mail.outbox)

    def test_nobody_approves_their_own_request(self):
        created = self.submit(self.credit_ticket(selling_price='900000', cost_price='800000'), user=self.ops_head).data
        self.as_user(self.ops_head)
        response = self.client.post(f'{BASE}/{created["id"]}/approve')
        self.assertEqual(response.status_code, 403)
        self.assertIn('your own request', str(response.data))

    def test_rejection_closes_and_frees_the_pnr(self):
        created = self.submit(self.credit_ticket(selling_price='900000', cost_price='800000')).data
        self.as_user(self.manager)
        self.assertEqual(self.client.post(f'{BASE}/{created["id"]}/reject', {}, format='json').status_code, 400)
        response = self.client.post(f'{BASE}/{created["id"]}/reject', {'reason': 'Client owes too much'}, format='json')
        self.assertEqual((response.data['status'], response.data['closed_reason']), ('rejected', 'Client owes too much'))
        self.client_ngn.refresh_from_db()
        self.assertEqual(self.client_ngn.credit_utilization, Decimal('200000.00'))
        self.assertEqual(self.submit(self.credit_ticket()).status_code, 201)  # same PNR is free again
        self.as_user(self.agent)
        self.assertTrue(self.client.get(f'{BASE}/{created["id"]}').data['allowed']['copy'])


class SubmitterActionTests(RequestTestBase):
    def test_only_the_submitter_completes_or_cancels(self):
        created = self.submit(self.ticket()).data
        for user in (self.agent2, self.ops_head, self.ed):
            self.as_user(user)
            self.assertEqual(self.client.post(f'{BASE}/{created["id"]}/complete').status_code, 403)
            self.assertEqual(self.client.post(f'{BASE}/{created["id"]}/cancel', {'reason': 'x'}, format='json').status_code, 403)
        self.as_user(self.agent)
        self.assertEqual(self.client.post(f'{BASE}/{created["id"]}/complete').data['status'], 'completed')
        self.assertEqual(self.client.post(f'{BASE}/{created["id"]}/cancel', {'reason': 'x'}, format='json').status_code, 409)

    def test_pending_requests_cannot_be_completed_but_can_be_cancelled(self):
        created = self.submit(self.credit_ticket(selling_price='900000', cost_price='800000')).data
        self.assertEqual(self.client.post(f'{BASE}/{created["id"]}/complete').status_code, 409)
        self.assertEqual(self.client.post(f'{BASE}/{created["id"]}/cancel', {'reason': 'Not needed'}, format='json').data['status'], 'cancelled')

    def test_history_and_audit(self):
        created = self.submit(self.ticket()).data
        self.client.post(f'{BASE}/{created["id"]}/complete')
        history = self.client.get(f'{BASE}/{created["id"]}/history').data
        self.assertEqual([event['action'] for event in history['results']], ['completed', 'submitted'])
        self.assertEqual(AuditLog.objects.filter(action__startswith='SERVICE_REQUEST_').count(), 2)


class NotificationTests(RequestTestBase):
    def told(self, notification_type):
        return set(
            Notification.objects.filter(notification_type=notification_type).values_list('recipient__username', flat=True)
        )

    @override_settings(EMAIL_ENABLED=True, SEND_EMAILS_CELERY=False)
    def test_submitted_goes_to_stakeholders_with_email(self):
        mail.outbox = []
        with self.captureOnCommitCallbacks(execute=True):
            self.submit(self.ticket(), user=self.agent)
        expected = {'ctl@example.com', 'head@example.com', 'tm@example.com', 'admin@example.com'}
        self.assertEqual(self.told('service_request_submitted'), expected)
        self.assertEqual({message.to[0] for message in mail.outbox}, expected)
        self.assertTrue(mail.outbox[0].subject.startswith('New service request: [TICKET] Client: [AFRIWINGS_'))

    def test_approval_needed_also_goes_to_first_approvers_and_never_to_the_actor(self):
        self.submit(self.credit_ticket(selling_price='900000', cost_price='800000'), user=self.ops_head)
        told = self.told('service_request_approval_needed')
        self.assertIn('saleshead@example.com', told)
        self.assertIn('tm@example.com', told)
        self.assertNotIn('head@example.com', told)  # the submitter

    def test_list_filters_and_suggestions(self):
        self.submit(self.ticket())
        self.submit(self.credit_ticket(pnr='QWE123', airline='AIR PEACE'))
        self.as_user(self.controller)
        self.assertEqual(self.client.get(BASE, {'payment_type': 'credit'}).data['count'], 1)
        self.assertEqual(self.client.get(BASE, {'search': 'qwe123'}).data['count'], 1)
        self.assertEqual(self.client.get(BASE, {'status': 'submitted'}).data['count'], 2)
        self.assertEqual(self.client.get(BASE, {'status': 'nope'}).status_code, 400)
        suggestions = self.client.get(f'{BASE}/suggestions', {'field': 'airline', 'search': 'air'}).data
        self.assertEqual(suggestions['results'], ['AIR PEACE', 'ENUGU AIR'])


class TitleTests(BaseAPITestCase):
    def test_title_format(self):
        self.assertEqual(
            request_title('ticket', 'AFRIWINGS', ['STELLA'], Decimal('149300.50')),
            '[TICKET] Client: [AFRIWINGS_STELLA | Amount: ₦149,300.50]',
        )
        self.assertEqual(date(2026, 1, 1).year, 2026)
