"""Reset a dedicated end-to-end test database to a fixed, known dataset.

The portal's Playwright suite (portal/e2e) runs against this data. Names,
emails and counts here are mirrored in portal/e2e/support/seed.ts, so a
change in one place must be made in the other.

The command wipes every table first. It refuses to run unless the database
name ends in ``_e2e``.
"""

from __future__ import annotations

from datetime import time, timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

User = get_user_model()

E2E_PASSWORD = 'E2e-Portal!2026'
E2E_DB_SUFFIX = '_e2e'


class Command(BaseCommand):
    help = 'Wipe the *_e2e database and load the fixed end-to-end test dataset.'

    def handle(self, *args, **options):
        db_name = str(connection.settings_dict.get('NAME', ''))
        if not db_name.endswith(E2E_DB_SUFFIX):
            raise CommandError(
                f'Refusing to seed database "{db_name}": seed_e2e deletes all data and only '
                f'runs against a database whose name ends in "{E2E_DB_SUFFIX}".'
            )

        # Seeding must never send mail or push, whatever the surrounding env says.
        settings.EMAIL_ENABLED = False
        settings.WEB_PUSH_VAPID_PUBLIC_KEY = ''
        settings.WEB_PUSH_VAPID_PRIVATE_KEY = ''

        call_command('flush', interactive=False, verbosity=0)
        with transaction.atomic():
            Seeder().run()

        self.stdout.write(self.style.SUCCESS(f'Seeded end-to-end dataset into "{db_name}".'))


class Seeder:
    def __init__(self):
        self.now = timezone.now()
        self.today = timezone.localdate()
        self.this_monday = self.today - timedelta(days=self.today.weekday())
        # Weekly summaries are built for the week two weeks back, not last week.
        # Other seeded records are dated "today" or "yesterday", and on a Monday
        # yesterday is last week, which would change the summary figures
        # depending on the day the suite runs.
        self.summary_monday = self.this_monday - timedelta(days=14)
        self.users: dict[str, User] = {}
        self._task_sequence = 0

    def run(self):
        self.seed_organization()
        self.seed_users()
        self.seed_leaders()
        self.seed_applications()
        self.seed_tasks()
        self.seed_recurring()
        self.seed_todos()
        self.seed_reports()
        self.seed_support()
        self.seed_inventory()
        self.seed_summaries_and_goals()
        self.seed_notifications()
        self.seed_audit_logs()

    # ------------------------------------------------------------------
    # Organization and people
    # ------------------------------------------------------------------

    def seed_organization(self):
        from organization.models import Department, Role, Team, Unit

        # Mirrors production: administration is done by superusers, not by an ADMIN role.
        self.role_staff = Role.objects.create(name='Staff', code='STAFF')
        self.role_ed = Role.objects.create(name='ED', code='ED', has_global_access=True)
        self.role_md = Role.objects.create(name='MD', code='MD', has_global_access=True)

        self.dept_ops = Department.objects.create(name='Operations', code='OPS')
        self.dept_it = Department.objects.create(
            name='IT', code='IT', manages_inventory=True, handles_it_support=True,
        )
        self.dept_hr = Department.objects.create(name='Human Resources', code='HR', handles_general_support=True)
        self.dept_finance = Department.objects.create(name='Finance', code='FIN')

        self.unit_logistics = Unit.objects.create(department=self.dept_ops, name='Logistics', code='OPS-LOG')
        self.unit_warehouse = Unit.objects.create(department=self.dept_ops, name='Warehouse', code='OPS-WH')
        self.team_dispatch = Team.objects.create(unit=self.unit_logistics, name='Dispatch', code='OPS-LOG-DSP')

    def _user(self, key, first, last, role, department, unit=None, team=None, is_active=True,
              is_superuser=False):
        from accounts.models import StaffProfile

        email = f'{key}@e2e.test'
        user = User.objects.create_user(
            username=email,
            email=email,
            password=E2E_PASSWORD,
            first_name=first,
            last_name=last,
            is_active=is_active,
            is_superuser=is_superuser,
            is_staff=is_superuser,
        )
        StaffProfile.objects.create(
            user=user,
            role=role,
            department=department,
            unit=unit,
            team=team,
            is_active=is_active,
            last_activity_at=self.now,
        )
        self.users[key] = user
        return user

    def seed_users(self):
        ops, it, hr, fin = self.dept_ops, self.dept_it, self.dept_hr, self.dept_finance
        log, dsp = self.unit_logistics, self.team_dispatch

        self._user('admin', 'Ada', 'Admin', self.role_staff, hr, is_superuser=True)
        self._user('director', 'Dele', 'Director', self.role_ed, fin)
        self._user('manager', 'Mary', 'Manager', self.role_staff, ops)
        self._user('supervisor', 'Sam', 'Supervisor', self.role_staff, ops, unit=log)
        self._user('lead', 'Lola', 'Lead', self.role_staff, ops, unit=log, team=dsp)
        self._user('staff', 'Stan', 'Staff', self.role_staff, ops, unit=log, team=dsp)
        self._user('peer', 'Pat', 'Peer', self.role_staff, ops, unit=log, team=dsp)
        self._user('warehouse', 'Wale', 'Warehouse', self.role_staff, ops, unit=self.unit_warehouse)
        self._user('itmanager', 'Ife', 'Itmanager', self.role_staff, it)
        self._user('itstaff', 'Tolu', 'Technician', self.role_staff, it)
        self._user('hrmanager', 'Hana', 'Hrmanager', self.role_staff, hr)
        # Femi and Chidi are the "sandbox" pair: tests that create or change data act as
        # them, so the records the read-only tests rely on (mostly Stan's) never move.
        self._user('finance', 'Femi', 'Finance', self.role_staff, fin)
        self._user('clerk', 'Chidi', 'Clerk', self.role_staff, fin)
        # Receives the seeded notifications that the notification tests read and clear.
        self._user('inbox', 'Ina', 'Inbox', self.role_staff, fin)
        # Used only by the change-password test.
        self._user('changer', 'Chika', 'Changer', self.role_staff, fin)
        self._user('former', 'Fola', 'Former', self.role_staff, ops, is_active=False)

    def seed_leaders(self):
        u = self.users
        self.dept_ops.line_manager = u['manager']
        self.dept_ops.save()
        self.dept_it.line_manager = u['itmanager']
        self.dept_it.save()
        self.dept_hr.line_manager = u['hrmanager']
        self.dept_hr.save()
        self.unit_logistics.supervisor = u['supervisor']
        self.unit_logistics.save()
        self.team_dispatch.team_lead = u['lead']
        self.team_dispatch.save()

    # ------------------------------------------------------------------
    # Applications
    # ------------------------------------------------------------------

    def seed_applications(self):
        from applications.models import (
            ApplicationAccessOverride,
            InternalApplication,
            RecentApplication,
        )

        A = InternalApplication
        self.app_payroll = A.objects.create(
            name='Payroll Hub', slug='payroll-hub', description='Payslips and salary history for all staff.',
            app_url='https://payroll.e2e.test', access_scope=A.AccessScope.ALL_AUTHENTICATED,
        )
        self.app_fleet = A.objects.create(
            name='Fleet Tracker', slug='fleet-tracker', description='Vehicle and delivery tracking for Operations.',
            app_url='https://fleet.e2e.test', access_scope=A.AccessScope.RESTRICTED,
        )
        self.app_fleet.departments.set([self.dept_ops])
        self.app_itdesk = A.objects.create(
            name='IT Console', slug='it-console', description='Device management for the IT team.',
            app_url='https://itconsole.e2e.test', access_scope=A.AccessScope.RESTRICTED,
        )
        self.app_itdesk.departments.set([self.dept_it])
        self.app_ledger = A.objects.create(
            name='Finance Ledger', slug='finance-ledger', description='General ledger for Finance.',
            app_url='https://ledger.e2e.test', access_scope=A.AccessScope.RESTRICTED,
            status=A.Status.MAINTENANCE,
        )
        self.app_ledger.departments.set([self.dept_finance])
        A.objects.create(
            name='Legacy Archive', slug='legacy-archive', description='Retired document archive.',
            app_url='https://archive.e2e.test', access_scope=A.AccessScope.RESTRICTED,
            status=A.Status.INACTIVE, visibility_scope=A.VisibilityScope.HIDDEN,
        )

        # Pat Peer is explicitly allowed into the IT Console; Wale is explicitly denied Fleet Tracker.
        ApplicationAccessOverride.objects.create(
            application=self.app_itdesk, user=self.users['peer'],
            effect=ApplicationAccessOverride.Effect.ALLOW, reason='Covering IT handover',
        )
        ApplicationAccessOverride.objects.create(
            application=self.app_fleet, user=self.users['warehouse'],
            effect=ApplicationAccessOverride.Effect.DENY, reason='Not a driver',
        )
        RecentApplication.objects.create(user=self.users['staff'], application=self.app_payroll)

    # ------------------------------------------------------------------
    # Tasks
    # ------------------------------------------------------------------

    def _task(self, title, by, to, status='pending', priority='medium', deadline_days=3,
              description='', created_days_ago=0, completed_days_ago=None):
        from tasks.models import Task, TaskActivity

        assigner, assignee = self.users[by], self.users[to]
        task = Task.objects.create(
            title=title,
            description=description or f'{title} - seeded for end-to-end tests.',
            assigned_by=assigner,
            assigned_to=assignee,
            status=status,
            priority=priority,
            deadline=self.now + timedelta(days=deadline_days),
        )
        # Lists are ordered newest first, so give every task a distinct timestamp:
        # among tasks created on the same day, the first one seeded is the newest.
        self._task_sequence += 1
        created_at = self.now - timedelta(days=created_days_ago, seconds=self._task_sequence)
        updates = {'created_at': created_at}
        if status == 'completed':
            updates['completed_at'] = self.now - timedelta(days=completed_days_ago or 0)
        Task.objects.filter(pk=task.pk).update(**updates)

        activity = TaskActivity.objects.create(
            task=task, user=assigner, activity_type='created',
            comment=f'Task created by {assigner.get_full_name()}',
        )
        TaskActivity.objects.filter(pk=activity.pk).update(created_at=created_at)
        return task

    def seed_tasks(self):
        from tasks.models import TaskActivity

        # Assigned to Stan by his line manager, one in each status.
        self.task_pending = self._task('Prepare weekly stock report', 'manager', 'staff', 'pending', 'high', 2)
        self.task_progress = self._task('Update vendor contact list', 'manager', 'staff', 'in_progress', 'medium', 4)
        self.task_review = self._task('Draft safety checklist', 'manager', 'staff', 'under_review', 'medium', 1)
        self.task_done = self._task(
            'Archive delivery notes', 'manager', 'staff', 'completed', 'low', 5,
            created_days_ago=1, completed_days_ago=0,
        )
        self.task_overdue = self._task('Submit fuel receipts', 'manager', 'staff', 'pending', 'high', -2)
        # Created by Stan for a colleague.
        self.task_created = self._task('Review shift roster', 'staff', 'peer', 'pending', 'medium', 3)
        self.task_created_review = self._task('Count pallet returns', 'staff', 'peer', 'under_review', 'low', 2)
        # Not involving Stan at all: only managers with oversight and global users see these.
        self.task_other_team = self._task('Reconcile warehouse stock', 'supervisor', 'warehouse', 'in_progress', 'medium', 6)
        self.task_it = self._task('Patch office routers', 'itmanager', 'itstaff', 'pending', 'high', 7)

        # Completed work in the summarised week (created Mon-Wed, completed Tue-Thu).
        days_since_summary_week = (self.today - self.summary_monday).days
        for index, title in enumerate(['Clean loading bay', 'Label new shelving', 'Return hire van']):
            self._task(
                title, 'manager', 'staff', 'completed', 'high' if index == 0 else 'medium', 10,
                created_days_ago=days_since_summary_week - index,
                completed_days_ago=days_since_summary_week - index - 1,
            )

        TaskActivity.objects.create(
            task=self.task_progress, user=self.users['manager'], activity_type='comment',
            comment='Please include the new courier contacts.',
        )
        TaskActivity.objects.create(
            task=self.task_progress, user=self.users['staff'], activity_type='comment',
            comment='Will do, half of them are in already.',
            links=[{'url': 'https://example.com/contacts', 'title': 'Contacts sheet'}],
        )
        TaskActivity.objects.create(
            task=self.task_review, user=self.users['staff'], activity_type='status_change',
            old_value='in_progress', new_value='under_review', comment='Submitted for review',
        )

    def seed_recurring(self):
        from tasks.models import RecurringSchedule
        from tasks.services import calculate_next_run_at

        common = dict(
            assigned_by=self.users['manager'], assigned_to=self.users['staff'],
            frequency='daily', interval=1, include_weekends=True, times=['09:00'], timezone='UTC',
            deadline_offset_minutes=480, start_at=self.now - timedelta(days=3),
        )
        self.schedule_active = RecurringSchedule.objects.create(
            title='Daily vehicle inspection', description='Walk-round check before first dispatch.',
            priority='high', **common,
        )
        self.schedule_active.next_run_at = calculate_next_run_at(self.schedule_active, reference=self.now)
        self.schedule_active.save()

        self.schedule_paused = RecurringSchedule.objects.create(
            title='Daily fuel log', description='Record fuel levels for each van.',
            priority='medium', is_paused=True, paused_at=self.now - timedelta(days=1),
            paused_by=self.users['manager'], **common,
        )
        self.schedule_ended = RecurringSchedule.objects.create(
            title='Daily yard sweep', description='No longer required.',
            priority='low', is_active=False, ended_at=self.now - timedelta(days=1),
            ended_by=self.users['manager'], **common,
        )

    def seed_todos(self):
        from tasks.models import TodoItem

        staff = self.users['staff']
        TodoItem.objects.create(
            user=staff, title='Call the tyre supplier', priority='high',
            due_date=self.today, due_time=time(23, 30), reminder_offset='none',
        )
        TodoItem.objects.create(
            user=staff, title='Book forklift training', priority='medium',
            due_date=self.today + timedelta(days=5), due_time=time(10, 0), reminder_offset='none',
        )
        TodoItem.objects.create(
            user=staff, title='Renew parking permit', priority='low',
            due_date=self.today - timedelta(days=3), due_time=time(9, 0), reminder_offset='none',
        )
        TodoItem.objects.create(
            user=staff, title='Hand in timesheet', priority='medium', is_completed=True,
            due_date=self.today, due_time=time(8, 0), reminder_offset='none',
        )
        TodoItem.objects.create(user=staff, title='Tidy desk drawers', priority='low', reminder_offset='none')
        TodoItem.objects.create(
            user=self.users['peer'], title='Peer private reminder', priority='low', reminder_offset='none',
        )

    # ------------------------------------------------------------------
    # Daily reports
    # ------------------------------------------------------------------

    def _report(self, key, report_date, entries):
        from tasks.models import DailyReport, DailyReportComment, DailyReportSubreport

        user = self.users[key]
        report = DailyReport.objects.create(
            user=user, department=user.staff_profile.department, report_date=report_date,
        )
        for title, body in entries:
            subreport = DailyReportSubreport.objects.create(daily_report=report, title=title, created_by=user)
            DailyReportComment.objects.create(subreport=subreport, author=user, body=body)
        return report

    def seed_reports(self):
        yesterday = self.today - timedelta(days=1)
        self.report_staff_today = self._report('staff', self.today, [
            ('Morning dispatch round', 'Loaded and sent out six vans before 9am.'),
            ('Stock count', 'Counted aisle four, two pallets short.'),
        ])
        self._report('peer', self.today, [('Returns processing', 'Processed eleven customer returns.')])
        self._report('itstaff', self.today, [('Printer repairs', 'Replaced the fuser on the second floor printer.')])
        self._report('staff', yesterday, [('Yard tidy', 'Cleared the old pallets from the yard.')])
        self._report('peer', yesterday, [('Route planning', 'Planned the routes for the week.')])

    # ------------------------------------------------------------------
    # Support
    # ------------------------------------------------------------------

    def _ticket(self, title, requester, category, status='open', priority='medium', handler=None):
        from support.models import SupportComment, SupportRequest
        from support.services import get_requester_line_manager

        user = self.users[requester]
        department = self.dept_it if category == 'IT_SUPPORT' else self.dept_hr
        ticket = SupportRequest.objects.create(
            requester=user, title=title, category=category, priority=priority,
            description=f'{title}. Seeded for end-to-end tests.',
            department=department, status=status, line_manager=get_requester_line_manager(user),
        )
        SupportComment.objects.create(
            request=ticket, author=user, is_system=True,
            body=f'Support request submitted — {ticket.get_category_display()}, {ticket.get_priority_display()} priority.',
        )
        if handler:
            ticket.assigned_to = self.users[handler]
            ticket.assigned_by = department.line_manager
            if status == 'resolved':
                ticket.resolved_at = self.now
            ticket.save()
        return ticket

    def seed_support(self):
        from support.models import SupportComment

        self.ticket_open = self._ticket('Laptop will not join the VPN', 'staff', 'IT_SUPPORT', 'open', 'high')
        self.ticket_progress = self._ticket(
            'Email signature is wrong', 'staff', 'IT_SUPPORT', 'in_progress', 'low', handler='itstaff',
        )
        SupportComment.objects.create(
            request=self.ticket_progress, author=self.users['itstaff'],
            body='I have asked for the new template and will apply it today.',
        )
        self.ticket_resolved = self._ticket(
            'Monitor flickers on startup', 'staff', 'IT_SUPPORT', 'resolved', 'medium', handler='itstaff',
        )
        self.ticket_hr = self._ticket('Leave balance looks wrong', 'staff', 'OTHER', 'open', 'medium')
        self.ticket_peer = self._ticket('Request for a second monitor', 'peer', 'IT_SUPPORT', 'open', 'low')

    # ------------------------------------------------------------------
    # Inventory
    # ------------------------------------------------------------------

    def seed_inventory(self):
        from inventory.models import (
            InventoryAssignment,
            InventoryCategory,
            InventoryItem,
            InventoryMaintenanceLog,
        )

        laptops = InventoryCategory.objects.create(name='Laptops', description='Portable computers')
        furniture = InventoryCategory.objects.create(name='Furniture', description='Desks and chairs')
        InventoryCategory.objects.create(name='Vehicles', description='Vans and cars')
        it_manager = self.users['itmanager']

        def item(name, code, category, serial, status='available', **extra):
            return InventoryItem.objects.create(
                name=name, code=code, category=category, serial_number=serial, status=status,
                purchase_date=self.today - timedelta(days=200), managing_department=self.dept_it, **extra,
            )

        self.item_assigned = item(
            'Dell Latitude 5440', '100001', laptops, 'DL-5440-001', 'assigned',
            current_assignee=self.users['staff'],
        )
        InventoryAssignment.objects.create(
            item=self.item_assigned, assigned_to=self.users['staff'], assigned_by=it_manager,
            condition_notes='New in box',
        )
        self.item_available = item('HP EliteBook 840', '100002', laptops, 'HP-840-002')
        self.item_dept = item(
            'Standing Desk', '100003', furniture, 'SD-003', 'assigned',
            current_assignee_department=self.dept_ops,
        )
        InventoryAssignment.objects.create(
            item=self.item_dept, assigned_to_department=self.dept_ops, assigned_by=it_manager,
        )
        self.item_maintenance = item('Lenovo ThinkPad T14', '100004', laptops, 'LN-T14-004', 'maintenance')
        InventoryMaintenanceLog.objects.create(
            item=self.item_maintenance, issue_reported='Battery drains within an hour',
            status='open', assigned_to=self.users['itstaff'], created_by=it_manager,
        )
        item('Office Chair', '100005', furniture, 'OC-005', 'retired')
        self.item_peer = item(
            'MacBook Air M2', '100006', laptops, 'MB-M2-006', 'assigned',
            current_assignee=self.users['peer'],
        )
        InventoryAssignment.objects.create(
            item=self.item_peer, assigned_to=self.users['peer'], assigned_by=it_manager,
        )

    # ------------------------------------------------------------------
    # Summaries, goals, notifications, audit
    # ------------------------------------------------------------------

    def seed_summaries_and_goals(self):
        from tasks.models import OrganizationSummaryCache, UserGoal, WeeklySummary
        from tasks.services import (
            calculate_organization_summary,
            calculate_user_weekly_summary,
            calculate_weekly_comparison,
        )

        week_before = self.summary_monday - timedelta(days=7)
        for user in User.objects.filter(is_active=True):
            previous = None
            for week_start in (week_before, self.summary_monday):
                week_end = week_start + timedelta(days=6)
                data = calculate_user_weekly_summary(user, week_start, week_end)
                summary = WeeklySummary.objects.create(
                    user=user, week_start_date=week_start, week_end_date=week_end, summary_data=data,
                )
                if previous is not None:
                    summary.previous_week_summary = previous
                    summary.comparison_metrics = calculate_weekly_comparison(data, previous.summary_data)
                    summary.save()
                previous = summary

        for week_start in (week_before, self.summary_monday):
            week_end = week_start + timedelta(days=6)
            OrganizationSummaryCache.objects.create(
                week_start_date=week_start, week_end_date=week_end,
                summary_data=calculate_organization_summary(week_start, week_end),
            )

        UserGoal.objects.create(
            user=self.users['staff'], metric='tasks_completed', target_value=5,
            period_start=self.this_monday, period_end=self.this_monday + timedelta(days=6),
        )

    def seed_notifications(self):
        from notifications.models import Notification

        staff, manager = self.users['staff'], self.users['manager']
        Notification.objects.create(
            recipient=staff, actor=manager, notification_type=Notification.TYPE_TASK_ASSIGNED,
            title='New Task', body='You were assigned: Prepare weekly stock report by Mary Manager',
            link_url=f'/tasks/{self.task_pending.id}', payload_json={'task_id': str(self.task_pending.id)},
        )
        Notification.objects.create(
            recipient=staff, actor=manager, notification_type=Notification.TYPE_TASK_COMMENT,
            title='New comment on task Update vendor contact list',
            body='Mary Manager made a new comment "Please include the..."',
            link_url=f'/tasks/{self.task_progress.id}', payload_json={'task_id': str(self.task_progress.id)},
        )
        Notification.objects.create(
            recipient=staff, actor=None, notification_type=Notification.TYPE_SUPPORT_RESOLVED,
            title='Support Request Resolved: Monitor flickers on startup',
            body='Your request has been marked as resolved. Please confirm or reopen if needed.',
            link_url=f'/support/{self.ticket_resolved.id}', is_read=True, read_at=self.now,
        )
        for title in ('Inbox notice one', 'Inbox notice two', 'Inbox notice three'):
            Notification.objects.create(
                recipient=self.users['inbox'], actor=manager,
                notification_type=Notification.TYPE_TASK_COMMENT, title=title,
                body=f'{title} body', link_url='/tasks',
            )

    def seed_audit_logs(self):
        from audit import log_audit

        admin = self.users['admin']
        log_audit(action='AUTH_LOGIN_SUCCESS', actor_user=admin, target_type='User', target_id=admin.id)
        log_audit(
            action='ADMIN_APPLICATION_CREATED', actor_user=admin, target_type='InternalApplication',
            target_id=self.app_payroll.id,
            metadata={'application_id': self.app_payroll.id, 'application_name': 'Payroll Hub', 'department_ids': []},
        )
        log_audit(
            action='ADMIN_USER_CREATED', actor_user=admin, target_type='User', target_id=self.users['staff'].id,
            metadata={'email': 'staff@e2e.test', 'role_code': 'STAFF', 'role_name': 'Staff'},
        )
