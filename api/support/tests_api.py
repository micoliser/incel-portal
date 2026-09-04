from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth.models import User
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import StaffProfile
from common.test_utils import BaseAPITestCase
from notifications.models import Notification
from organization.models import Department, Role
from support.models import SupportAttachment, SupportComment, SupportRequest
from support.services import (
    auto_close_resolved_requests,
    route_support_request,
    update_request_status,
)


class SupportRoutingTests(TestCase):
    """Test category → department routing logic."""

    def setUp(self):
        self.dep_it = Department.objects.create(name='IT', code='IT')
        self.dep_hr = Department.objects.create(name='HR', code='HR')

    def test_it_support_routes_to_it(self):
        dept = route_support_request('IT_SUPPORT')
        self.assertEqual(dept.code, 'IT')

    def test_other_routes_to_hr(self):
        dept = route_support_request('OTHER')
        self.assertEqual(dept.code, 'HR')

    def test_raises_error_if_department_missing(self):
        self.dep_it.delete()
        with self.assertRaises(Exception):
            route_support_request('IT_SUPPORT')


class SupportModelTests(TestCase):
    """Test SupportRequest model basics."""

    def setUp(self):
        self.dep_it = Department.objects.create(name='IT', code='IT')
        self.role = Role.objects.create(name='Staff', code='STAFF')
        self.user = User.objects.create_user(username='user1', password='pass')
        StaffProfile.objects.create(user=self.user, role=self.role, department=self.dep_it)

    def test_create_support_request(self):
        request = SupportRequest.objects.create(
            requester=self.user,
            title='Test Request',
            category='IT_SUPPORT',
            priority='high',
            description='Need help',
            department=self.dep_it,
        )
        self.assertEqual(request.status, 'open')
        self.assertIsNone(request.assigned_to)
        self.assertIsNone(request.resolved_at)

    def test_status_transitions(self):
        request = SupportRequest.objects.create(
            requester=self.user,
            title='Test',
            category='IT_SUPPORT',
            priority='medium',
            description='Test',
            department=self.dep_it,
        )

        update_request_status(request, 'assigned', user=self.user)
        self.assertEqual(request.status, 'assigned')

        update_request_status(request, 'in_progress', user=self.user)
        self.assertEqual(request.status, 'in_progress')

        update_request_status(request, 'resolved', user=self.user)
        self.assertEqual(request.status, 'resolved')
        self.assertIsNotNone(request.resolved_at)

        update_request_status(request, 'closed', user=self.user)
        self.assertEqual(request.status, 'closed')
        self.assertIsNotNone(request.closed_at)

    def test_invalid_transition_raises_error(self):
        request = SupportRequest.objects.create(
            requester=self.user,
            title='Test',
            category='IT_SUPPORT',
            priority='medium',
            description='Test',
            department=self.dep_it,
        )
        with self.assertRaises(Exception):
            update_request_status(request, 'closed', user=self.user)

    def test_is_overdue_auto_close(self):
        request = SupportRequest.objects.create(
            requester=self.user,
            title='Test',
            category='IT_SUPPORT',
            priority='medium',
            description='Test',
            department=self.dep_it,
            status='resolved',
            resolved_at=timezone.now() - timedelta(days=10),
        )
        self.assertTrue(request.is_overdue_auto_close)

        recent_request = SupportRequest.objects.create(
            requester=self.user,
            title='Test 2',
            category='OTHER',
            priority='low',
            description='Test',
            department=self.dep_it,
            status='resolved',
            resolved_at=timezone.now() - timedelta(days=1),
        )
        self.assertFalse(recent_request.is_overdue_auto_close)

    def test_support_comment_creation(self):
        request = SupportRequest.objects.create(
            requester=self.user,
            title='Test',
            category='IT_SUPPORT',
            priority='medium',
            description='Test',
            department=self.dep_it,
        )
        comment = SupportComment.objects.create(
            request=request,
            author=self.user,
            body='This is a test comment',
        )
        self.assertEqual(comment.request, request)
        self.assertFalse(comment.is_system)

    def test_support_attachment_on_request(self):
        request = SupportRequest.objects.create(
            requester=self.user,
            title='Test',
            category='IT_SUPPORT',
            priority='medium',
            description='Test',
            department=self.dep_it,
        )
        attachment = SupportAttachment.objects.create(
            request=request,
            comment=None,
            object_key='test-key.pdf',
            file_name='test.pdf',
            content_type='application/pdf',
            size=1024,
        )
        self.assertEqual(attachment.request, request)
        self.assertIsNone(attachment.comment)

    def test_support_attachment_on_comment(self):
        request = SupportRequest.objects.create(
            requester=self.user,
            title='Test',
            category='IT_SUPPORT',
            priority='medium',
            description='Test',
            department=self.dep_it,
        )
        comment = SupportComment.objects.create(
            request=request,
            author=self.user,
            body='With file',
        )
        attachment = SupportAttachment.objects.create(
            request=None,
            comment=comment,
            object_key='comment-key.pdf',
            file_name='comment.pdf',
            content_type='application/pdf',
            size=2048,
        )
        self.assertEqual(attachment.comment, comment)
        self.assertIsNone(attachment.request)


class SupportAutoCloseTests(TestCase):
    """Test auto-close service."""

    def setUp(self):
        self.dep_it = Department.objects.create(name='IT', code='IT')
        self.role = Role.objects.create(name='Staff', code='STAFF')
        self.user = User.objects.create_user(username='user1', password='pass')
        StaffProfile.objects.create(user=self.user, role=self.role, department=self.dep_it)

    def test_auto_close_overdue_requests(self):
        SupportRequest.objects.create(
            requester=self.user,
            title='Old',
            category='IT_SUPPORT',
            priority='medium',
            description='Test',
            department=self.dep_it,
            status='resolved',
            resolved_at=timezone.now() - timedelta(days=10),
        )
        SupportRequest.objects.create(
            requester=self.user,
            title='Recent',
            category='OTHER',
            priority='low',
            description='Test',
            department=self.dep_it,
            status='resolved',
            resolved_at=timezone.now() - timedelta(days=1),
        )

        closed = auto_close_resolved_requests(days=7)
        self.assertEqual(closed, 1)

        old = SupportRequest.objects.get(title='Old')
        self.assertEqual(old.status, 'closed')
        self.assertIsNotNone(old.closed_at)

    def test_auto_close_creates_system_comment(self):
        request = SupportRequest.objects.create(
            requester=self.user,
            title='Old',
            category='IT_SUPPORT',
            priority='medium',
            description='Test',
            department=self.dep_it,
            status='resolved',
            resolved_at=timezone.now() - timedelta(days=10),
        )

        auto_close_resolved_requests(days=7)

        comments = SupportComment.objects.filter(request=request, is_system=True)
        self.assertTrue(comments.exists())
        self.assertIn('auto-closed', comments.first().body.lower())


class SupportAPITests(BaseAPITestCase):
    """Test support request API endpoints."""

    def setUp(self):
        super().setUp()
        self.dep_it = Department.objects.create(name='IT', code='IT')
        # dep_hr already created by BaseAPITestCase as self.dep_hr
        self.role_lm = Role.objects.create(
            name='Line Manager', code='LINE_MANAGER', has_global_access=False
        )
        self.role_handler = Role.objects.create(
            name='Handler', code='HANDLER', has_global_access=False
        )

        # Line manager in IT department
        self.lm_user = User.objects.create_user(
            username='lm@test.com', email='lm@test.com', password='pass'
        )
        StaffProfile.objects.create(
            user=self.lm_user, role=self.role_lm, department=self.dep_it
        )
        self.dep_it.line_manager = self.lm_user
        self.dep_it.save()

        # Handler in IT department
        self.handler_user = User.objects.create_user(
            username='handler@test.com', email='handler@test.com', password='pass'
        )
        StaffProfile.objects.create(
            user=self.handler_user, role=self.role_handler, department=self.dep_it
        )

        # Move staff_user to IT dept
        profile = StaffProfile.objects.get(user=self.staff_user)
        profile.department = self.dep_it
        profile.save()

        self.client = APIClient()

    def _auth(self, user):
        self.client.force_authenticate(user=user)

    # ── Creation ──

    def test_authenticated_user_can_create_request(self):
        self._auth(self.staff_user)
        response = self.client.post('/api/v1/support/requests/', {
            'title': 'My PC is broken',
            'category': 'IT_SUPPORT',
            'priority': 'high',
            'description': 'The screen is flickering.',
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['title'], 'My PC is broken')
        self.assertEqual(response.data['category'], 'IT_SUPPORT')
        self.assertEqual(response.data['status'], 'open')
        self.assertIn('department', response.data)

    def test_create_requires_authentication(self):
        response = self.client.post('/api/v1/support/requests/', {
            'title': 'Test',
            'category': 'IT_SUPPORT',
            'priority': 'low',
            'description': 'Test',
        })
        self.assertEqual(response.status_code, 401)

    def test_it_support_routes_to_it_department(self):
        self._auth(self.staff_user)
        response = self.client.post('/api/v1/support/requests/', {
            'title': 'IT Issue',
            'category': 'IT_SUPPORT',
            'priority': 'urgent',
            'description': 'Network down',
        })
        self.assertEqual(response.data['department']['code'], 'IT')

    def test_other_routes_to_hr(self):
        self._auth(self.staff_user)
        response = self.client.post('/api/v1/support/requests/', {
            'title': 'HR Issue',
            'category': 'OTHER',
            'priority': 'medium',
            'description': 'Need time off',
        })
        self.assertEqual(response.data['department']['code'], 'HR')

    def test_creation_creates_notification(self):
        self._auth(self.staff_user)
        response = self.client.post('/api/v1/support/requests/', {
            'title': 'Notify Test',
            'category': 'IT_SUPPORT',
            'priority': 'high',
            'description': 'Test notifications',
        })
        self.assertEqual(response.status_code, 201)

        # Line managers in IT should be notified
        notifications = Notification.objects.filter(
            notification_type='support_request_submitted'
        )
        self.assertTrue(notifications.exists())

    def test_creation_triggers_email_dispatch(self):
        """Verify _send_support_email is called when a request is created."""
        self._auth(self.staff_user)
        with patch('support.services._send_support_email') as mock_email:
            response = self.client.post('/api/v1/support/requests/', {
                'title': 'Email Test',
                'category': 'IT_SUPPORT',
                'priority': 'high',
                'description': 'Test emails',
            })
            self.assertEqual(response.status_code, 201)
            # Should send email to at least the department line manager
            self.assertGreaterEqual(mock_email.call_count, 1)
            # Check the first call has the right subject
            subject = mock_email.call_args_list[0][1].get('subject', '')
            self.assertIn('New Support Request', subject)

    def test_assignment_creates_notification_and_email(self):
        """Assigning sends in-app notification + email to the handler."""
        self._auth(self.staff_user)
        create_resp = self.client.post('/api/v1/support/requests/', {
            'title': 'Assign Notify',
            'category': 'IT_SUPPORT',
            'priority': 'medium',
            'description': 'Test',
        })
        req_id = create_resp.data['id']

        self._auth(self.lm_user)
        with patch('support.services._send_support_email') as mock_email:
            response = self.client.post(f'/api/v1/support/requests/{req_id}/assign/', {
                'assigned_to': self.handler_user.id,
            })
            self.assertEqual(response.status_code, 200)

            # In-app notification for the handler
            notif = Notification.objects.filter(
                notification_type='support_request_assigned',
                recipient=self.handler_user,
            )
            self.assertTrue(notif.exists())

            # Email to the handler
            mock_email.assert_called_once()
            subject = mock_email.call_args[1].get('subject', '')
            self.assertIn('Assigned', subject)

    def test_resolve_creates_notification_and_email(self):
        """Resolving sends in-app notification + email to the requester."""
        self._auth(self.staff_user)
        create_resp = self.client.post('/api/v1/support/requests/', {
            'title': 'Resolve Notify',
            'category': 'IT_SUPPORT',
            'priority': 'high',
            'description': 'Test',
        })
        req_id = create_resp.data['id']

        SupportRequest.objects.filter(id=req_id).update(
            assigned_to=self.handler_user,
            assigned_by=self.lm_user,
            status='in_progress',
        )

        self._auth(self.handler_user)
        with patch('support.services._send_support_email') as mock_email:
            response = self.client.post(f'/api/v1/support/requests/{req_id}/resolve/')
            self.assertEqual(response.status_code, 200)

            # In-app notification for the requester
            notif = Notification.objects.filter(
                notification_type='support_request_resolved',
                recipient=self.staff_user,
            )
            self.assertTrue(notif.exists())

            # Email to the requester
            mock_email.assert_called_once()
            subject = mock_email.call_args[1].get('subject', '')
            self.assertIn('Resolved', subject)

    def test_confirm_sends_closed_notifications(self):
        """Confirming (requester closes) sends notifications to requester + LM + handler."""
        self._auth(self.staff_user)
        create_resp = self.client.post('/api/v1/support/requests/', {
            'title': 'Close Notify',
            'category': 'IT_SUPPORT',
            'priority': 'medium',
            'description': 'Test',
        })
        req_id = create_resp.data['id']

        SupportRequest.objects.filter(id=req_id).update(
            status='resolved',
            resolved_at=timezone.now(),
            assigned_to=self.handler_user,
            assigned_by=self.lm_user,
        )

        self._auth(self.staff_user)
        response = self.client.post(f'/api/v1/support/requests/{req_id}/confirm/')
        self.assertEqual(response.status_code, 200)

        # Notifications for closed event
        closed_notifs = Notification.objects.filter(
            notification_type='support_request_closed',
        )
        # Should notify: requester + department line manager + handler (if not LM)
        self.assertGreaterEqual(closed_notifs.count(), 2)

    def test_confirm_sends_closed_email(self):
        """Confirming (requester closes) sends email to requester, department LM, and handler."""
        self._auth(self.staff_user)
        create_resp = self.client.post('/api/v1/support/requests/', {
            'title': 'Close Email Notify',
            'category': 'IT_SUPPORT',
            'priority': 'medium',
            'description': 'Test',
        })
        req_id = create_resp.data['id']

        SupportRequest.objects.filter(id=req_id).update(
            status='resolved',
            resolved_at=timezone.now(),
            assigned_to=self.handler_user,
            assigned_by=self.lm_user,
        )

        self._auth(self.staff_user)
        with patch('support.services._send_support_email') as mock_email:
            response = self.client.post(f'/api/v1/support/requests/{req_id}/confirm/')
            self.assertEqual(response.status_code, 200)

            recipients = {call.kwargs['recipient'].id for call in mock_email.call_args_list}
            self.assertEqual(recipients, {self.staff_user.id, self.lm_user.id, self.handler_user.id})
            self.assertEqual(mock_email.call_count, 3)
            self.assertTrue(
                all('Support Request Closed' in call.kwargs['subject'] for call in mock_email.call_args_list)
            )

    def test_requester_line_manager_fallback(self):
        """When staff has no explicit team/unit, falls back to department line_manager."""
        from support.services import get_requester_line_manager

        # Ensure the requester's department has a line manager to fall back to.
        profile = StaffProfile.objects.get(user=self.staff_user)
        profile.team = None
        profile.unit = None
        profile.department = self.dep_it
        profile.save()

        lm = get_requester_line_manager(self.staff_user)
        self.assertIsNotNone(lm)
        # Should fall back to lm_user (line_manager in staff's department)
        self.assertEqual(lm.id, self.lm_user.id)

    # ── Listing ──

    def test_user_sees_only_own_requests(self):
        self._auth(self.staff_user)
        self.client.post('/api/v1/support/requests/', {
            'title': 'Staff Issue',
            'category': 'IT_SUPPORT',
            'priority': 'low',
            'description': 'Test',
        })

        self._auth(self.handler_user)
        self.client.post('/api/v1/support/requests/', {
            'title': 'Handler Issue',
            'category': 'OTHER',
            'priority': 'low',
            'description': 'Test',
        })

        self._auth(self.staff_user)
        response = self.client.get('/api/v1/support/requests/')
        data = response.data.get('results', response.data) if isinstance(response.data, dict) else response.data
        titles = [item['title'] for item in data]
        self.assertIn('Staff Issue', titles)
        self.assertNotIn('Handler Issue', titles)

    # ── Assignment ──

    def test_department_manager_can_assign(self):
        self._auth(self.staff_user)
        create_resp = self.client.post('/api/v1/support/requests/', {
            'title': 'Assignable',
            'category': 'IT_SUPPORT',
            'priority': 'medium',
            'description': 'Please assign',
        })
        req_id = create_resp.data['id']

        self._auth(self.lm_user)
        response = self.client.post(f'/api/v1/support/requests/{req_id}/assign/', {
            'assigned_to': self.handler_user.id,
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['assigned_to']['id'], self.handler_user.id)

    def test_non_manager_cannot_assign(self):
        self._auth(self.staff_user)
        create_resp = self.client.post('/api/v1/support/requests/', {
            'title': 'No Assign',
            'category': 'IT_SUPPORT',
            'priority': 'medium',
            'description': 'Test',
        })
        req_id = create_resp.data['id']

        # Staff cannot assign
        response = self.client.post(f'/api/v1/support/requests/{req_id}/assign/', {
            'assigned_to': self.handler_user.id,
        })
        self.assertEqual(response.status_code, 403)

    # ── Status updates ──

    def test_assigned_handler_can_update_status(self):
        self._auth(self.staff_user)
        create_resp = self.client.post('/api/v1/support/requests/', {
            'title': 'Status Update',
            'category': 'IT_SUPPORT',
            'priority': 'high',
            'description': 'Test',
        })
        req_id = create_resp.data['id']

        # Assign first via raw update (simulating manager action)
        SupportRequest.objects.filter(id=req_id).update(
            assigned_to=self.handler_user,
            assigned_by=self.lm_user,
            status='assigned',
        )

        self._auth(self.handler_user)
        response = self.client.post(
            f'/api/v1/support/requests/{req_id}/update-status/',
            {'status': 'in_progress'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'in_progress')

    def test_handler_can_resolve(self):
        # Create as staff
        self._auth(self.staff_user)
        create_resp = self.client.post('/api/v1/support/requests/', {
            'title': 'Resolve Test',
            'category': 'IT_SUPPORT',
            'priority': 'high',
            'description': 'Test',
        })
        req_id = create_resp.data['id']

        # Assign and set to in_progress via manager
        SupportRequest.objects.filter(id=req_id).update(
            assigned_to=self.handler_user,
            assigned_by=self.lm_user,
            status='in_progress',
        )

        self._auth(self.handler_user)
        response = self.client.post(f'/api/v1/support/requests/{req_id}/resolve/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'resolved')
        self.assertIsNotNone(response.data['resolved_at'])

    # ── Confirm / Reopen ──

    def test_requester_can_confirm_resolution(self):
        self._auth(self.staff_user)
        create_resp = self.client.post('/api/v1/support/requests/', {
            'title': 'Confirm Test',
            'category': 'IT_SUPPORT',
            'priority': 'high',
            'description': 'Test',
        })
        req_id = create_resp.data['id']

        SupportRequest.objects.filter(id=req_id).update(
            status='resolved', resolved_at=timezone.now()
        )

        response = self.client.post(f'/api/v1/support/requests/{req_id}/confirm/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'closed')

    def test_requester_can_reopen(self):
        self._auth(self.staff_user)
        create_resp = self.client.post('/api/v1/support/requests/', {
            'title': 'Reopen Test',
            'category': 'IT_SUPPORT',
            'priority': 'high',
            'description': 'Test',
        })
        req_id = create_resp.data['id']

        SupportRequest.objects.filter(id=req_id).update(
            status='resolved', resolved_at=timezone.now()
        )

        response = self.client.post(f'/api/v1/support/requests/{req_id}/reopen/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'open')
        self.assertIsNone(response.data['assigned_to'])

    # ── Comments ──

    def test_can_add_comment(self):
        self._auth(self.staff_user)
        create_resp = self.client.post('/api/v1/support/requests/', {
            'title': 'Comment Test',
            'category': 'IT_SUPPORT',
            'priority': 'medium',
            'description': 'Test',
        })
        req_id = create_resp.data['id']

        response = self.client.post(
            f'/api/v1/support/requests/{req_id}/add-comment/',
            {'body': 'This is a comment'},
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data['body'], 'This is a comment')

    # ── Department list ──

    def test_department_manager_can_view_department_requests(self):
        self._auth(self.staff_user)
        self.client.post('/api/v1/support/requests/', {
            'title': 'Dept List Test',
            'category': 'IT_SUPPORT',
            'priority': 'medium',
            'description': 'Test',
        })

        self._auth(self.lm_user)
        response = self.client.get('/api/v1/support/requests/department/')
        self.assertEqual(response.status_code, 200)
        data = response.data.get('results', response.data) if isinstance(response.data, dict) else response.data
        titles = [item['title'] for item in data]
        self.assertIn('Dept List Test', titles)

    def test_non_manager_cannot_view_department_requests(self):
        self._auth(self.staff_user)
        response = self.client.get('/api/v1/support/requests/department/')
        self.assertEqual(response.status_code, 403)

class SupportAttachmentKeyTests(TestCase):
    def test_invalid_object_key_rejected(self):
        from support.serializers import SupportAttachmentConfirmSerializer
        
        # Valid key (requires 32 hex chars for UUID)
        serializer = SupportAttachmentConfirmSerializer(data={
            'object_key': 'support/request/1234567890abcdef1234567890abcdef.pdf',
            'file_name': 'test.pdf',
            'content_type': 'application/pdf',
            'size': 1024
        })
        self.assertTrue(serializer.is_valid())

        # Invalid keys (path traversal, absolute paths, wrong format)
        invalid_keys = [
            '../support/file.pdf',
            '/support/file.pdf',
            'support/../file.pdf',
            'file.pdf',  # missing folder prefix
            'support/subfolder/file.pdf'  # too many slashes
        ]
        
        for key in invalid_keys:
            serializer = SupportAttachmentConfirmSerializer(data={
                'object_key': key,
                'file_name': 'test.pdf',
                'content_type': 'application/pdf',
                'size': 1024
            })
            self.assertFalse(serializer.is_valid(), f"Key {key} should be invalid")
            self.assertIn('object_key', serializer.errors)
