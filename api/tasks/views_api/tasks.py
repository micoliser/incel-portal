"""Tasks and task drafts."""

import logging
from datetime import timedelta

from django.db import models, transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from applications.audit import log_audit
from applications.audit_actions import AuditAction
from common.permissions import has_global_access
from common.users import display_name
from emails.services.task_emails import TaskEmailManager
from notifications.models import Notification
from notifications.services import create_notification

from ..hierarchy import get_subordinate_user_ids
from ..models import (
    Task,
    TaskActivity,
    TaskAttachment,
    TaskDraft,
)
from ..permissions import IsTaskAssignedOrAssigner
from ..s3 import (
    TaskAttachmentStorageError,
    build_task_attachment_key_prefix,
    generate_task_attachment_upload_url,
)
from ..serializers import (
    TaskActivitySerializer,
    TaskAttachmentUploadRequestSerializer,
    TaskCommentCreateSerializer,
    TaskDraftSerializer,
    TaskSerializer,
)
from ..services import create_task_with_side_effects

logger = logging.getLogger(__name__)

def _comment_preview(comment_text: str, words: int = 3) -> str:
    tokens = [token for token in comment_text.split() if token]
    preview = " ".join(tokens[:words])
    if preview:
        return f"{preview}..."
    return "..."


class TaskPagination(PageNumberPagination):
    page_size = 20


class TaskViewSet(ModelViewSet):
    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = TaskPagination
    # No DELETE: tasks are a record of assigned work. Deleting one would also
    # remove its activity history and attachments, with nothing in the audit log.
    http_method_names = ['get', 'post', 'put', 'patch', 'head', 'options']

    @action(detail=False, methods=['get'])
    def dashboard(self, request):
        """GET /tasks/dashboard/ - Dashboard task summary for the current user."""
        user = request.user
        now = timezone.now()
        due_soon_cutoff = now + timedelta(days=3)

        base_queryset = Task.objects.filter(
            models.Q(assigned_to=user) | models.Q(assigned_by=user)
        ).distinct()

        assigned_to_queryset = base_queryset.filter(assigned_to=user)
        assigned_by_queryset = base_queryset.filter(assigned_by=user)

        def build_bucket(queryset):
            counts = queryset.aggregate(
                count=Count('id'),
                pending=Count('id', filter=Q(status='pending')),
                in_progress=Count('id', filter=Q(status='in_progress')),
                under_review=Count('id', filter=Q(status='under_review')),
                completed=Count('id', filter=Q(status='completed')),
                high_priority=Count(
                    'id',
                    filter=Q(priority='high') & ~Q(status='completed'),
                ),
                due_soon_or_overdue=Count(
                    'id',
                    filter=Q(deadline__isnull=False)
                    & ~Q(status='completed')
                    & Q(deadline__lte=due_soon_cutoff),
                ),
            )

            tasks = TaskSerializer(
                queryset.select_related('assigned_by', 'assigned_to')[:5],
                many=True,
            ).data

            return {
                'count': counts['count'] or 0,
                'pending': counts['pending'] or 0,
                'in_progress': counts['in_progress'] or 0,
                'under_review': counts['under_review'] or 0,
                'completed': counts['completed'] or 0,
                'high_priority': counts['high_priority'] or 0,
                'due_soon_or_overdue': counts['due_soon_or_overdue'] or 0,
                'tasks': tasks,
            }

        total_counts = base_queryset.aggregate(
            count=Count('id'),
            pending=Count('id', filter=Q(status='pending')),
            in_progress=Count('id', filter=Q(status='in_progress')),
            under_review=Count('id', filter=Q(status='under_review')),
            completed=Count('id', filter=Q(status='completed')),
            overdue=Count(
                'id',
                filter=Q(deadline__isnull=False)
                & ~Q(status='completed')
                & Q(deadline__lt=now),
            ),
        )

        return Response(
            {
                'assigned_to': build_bucket(assigned_to_queryset),
                'assigned_by': build_bucket(assigned_by_queryset),
                'total': {
                    'count': total_counts['count'] or 0,
                    'pending': total_counts['pending'] or 0,
                    'in_progress': total_counts['in_progress'] or 0,
                    'under_review': total_counts['under_review'] or 0,
                    'completed': total_counts['completed'] or 0,
                    'overdue': total_counts['overdue'] or 0,
                },
            }
        )

    def get_queryset(self):
        user = self.request.user
        if not user or not user.is_authenticated:
            return Task.objects.none()

        subordinate_ids = get_subordinate_user_ids(user)
        has_global = has_global_access(user)

        if has_global:
            base_query = models.Q()
        elif subordinate_ids:
            base_query = (
                models.Q(assigned_to=user)
                | models.Q(assigned_by=user)
                | models.Q(assigned_to_id__in=subordinate_ids)
                | models.Q(assigned_by_id__in=subordinate_ids)
            )
        else:
            base_query = models.Q(assigned_to=user) | models.Q(assigned_by=user)

        queryset = Task.objects.filter(base_query).distinct()

        view_filter = (self.request.query_params.get('view') or '').strip()
        if view_filter == 'assigned':
            queryset = queryset.filter(assigned_to=user)
        elif view_filter == 'created':
            queryset = queryset.filter(assigned_by=user)
        elif view_filter == 'team':
            if has_global:
                queryset = Task.objects.exclude(assigned_to=user, assigned_by=user)
            elif subordinate_ids:
                queryset = Task.objects.filter(
                    models.Q(assigned_to_id__in=subordinate_ids)
                    | models.Q(assigned_by_id__in=subordinate_ids)
                ).distinct()
            else:
                queryset = Task.objects.none()
        elif self.action == 'list' and not view_filter:
            queryset = queryset.filter(models.Q(assigned_to=user) | models.Q(assigned_by=user))

        statuses_raw = (self.request.query_params.get('status') or '').strip()
        if statuses_raw:
            status_values = [value.strip() for value in statuses_raw.split(',') if value.strip()]
            allowed_statuses = {choice[0] for choice in Task.STATUS_CHOICES}
            valid_statuses = [value for value in status_values if value in allowed_statuses]
            if valid_statuses:
                queryset = queryset.filter(status__in=valid_statuses)

        priorities_raw = (self.request.query_params.get('priority') or '').strip()
        if priorities_raw:
            priority_values = [value.strip() for value in priorities_raw.split(',') if value.strip()]
            allowed_priorities = {choice[0] for choice in Task.PRIORITY_CHOICES}
            valid_priorities = [value for value in priority_values if value in allowed_priorities]
            if valid_priorities:
                queryset = queryset.filter(priority__in=valid_priorities)

        return queryset

    def get_permissions(self):
        if self.action in ['list', 'create']:
            return [IsAuthenticated()]
        return [IsAuthenticated(), IsTaskAssignedOrAssigner()]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        assignees = serializer.validated_data.get('assigned_to_ids')
        if not assignees:
            single = serializer.validated_data.get('assigned_to')
            assignees = [single] if single else []

        with transaction.atomic():
            created_tasks = []
            for assignee in assignees:
                task = create_task_with_side_effects(
                    assigner=request.user,
                    assignee=assignee,
                    title=serializer.validated_data['title'],
                    description=serializer.validated_data.get('description', ''),
                    priority=serializer.validated_data['priority'],
                    deadline=serializer.validated_data['deadline'],
                    request=request,
                )
                created_tasks.append(task)

        headers = self.get_success_headers(serializer.data)
        serialized = TaskSerializer(created_tasks, many=True, context={'request': request}).data
        if len(created_tasks) == 1 and 'assigned_to_ids' not in request.data:
            return Response(serialized[0], status=status.HTTP_201_CREATED, headers=headers)
        return Response({
            'count': len(created_tasks),
            'tasks': serialized,
            'id': serialized[0]['id'] if serialized else None,
        }, status=status.HTTP_201_CREATED, headers=headers)

    def perform_update(self, serializer):
        old_task = self.get_object()
        old_status = old_task.status
        old_deadline = old_task.deadline
        old_priority = old_task.priority
        old_title = old_task.title
        old_description = old_task.description

        edit_reason = serializer.validated_data.pop('edit_reason', None)
        rejection_reason = serializer.validated_data.pop('rejection_reason', None)

        task = serializer.save()

        # Handle status changes
        if old_status != task.status:
            new_status = task.status
            if new_status == 'completed':
                task.completed_at = timezone.now()
                task.save(update_fields=['completed_at'])
                TaskActivity.objects.create(
                    task=task,
                    user=self.request.user,
                    activity_type='status_change',
                    old_value=old_status,
                    new_value=new_status,
                    comment='Approved by assigner',
                )
                create_notification(
                    recipient=task.assigned_to,
                    actor=self.request.user,
                    notification_type=Notification.TYPE_TASK_STATUS_CHANGED,
                    title=f'Task approved: {task.title}',
                    body=f'{display_name(self.request.user)} approved completion of "{task.title}".',
                    link_url=f'/tasks/{task.id}',
                    payload={
                        'task_id': task.id,
                        'old_status': old_status,
                        'new_status': new_status,
                    },
                )
            elif new_status == 'under_review':
                TaskActivity.objects.create(
                    task=task,
                    user=self.request.user,
                    activity_type='status_change',
                    old_value=old_status,
                    new_value=new_status,
                    comment='Submitted for review',
                )
                create_notification(
                    recipient=task.assigned_by,
                    actor=self.request.user,
                    notification_type=Notification.TYPE_TASK_STATUS_CHANGED,
                    title=f'Task submitted for review: {task.title}',
                    body=f'{display_name(self.request.user)} submitted "{task.title}" for completion approval.',
                    link_url=f'/tasks/{task.id}',
                    payload={
                        'task_id': task.id,
                        'old_status': old_status,
                        'new_status': new_status,
                    },
                )
                TaskEmailManager.send_task_submitted_for_review_emails(task)
            elif old_status == 'under_review' and new_status in ['in_progress', 'pending']:
                comment_text = f'Changes requested: {rejection_reason}' if rejection_reason else 'Changes requested by assigner'
                TaskActivity.objects.create(
                    task=task,
                    user=self.request.user,
                    activity_type='status_change',
                    old_value=old_status,
                    new_value=new_status,
                    comment=comment_text,
                )
                create_notification(
                    recipient=task.assigned_to,
                    actor=self.request.user,
                    notification_type=Notification.TYPE_TASK_STATUS_CHANGED,
                    title=f'Changes requested: {task.title}',
                    body=f'{display_name(self.request.user)} requested changes on "{task.title}". Reason: {rejection_reason or "Review feedback provided."}',
                    link_url=f'/tasks/{task.id}',
                    payload={
                        'task_id': task.id,
                        'old_status': old_status,
                        'new_status': new_status,
                        'reason': rejection_reason or '',
                    },
                )
                TaskEmailManager.send_task_revision_requested_emails(task, reason=rejection_reason or '')
            else:
                recipient = task.assigned_by if self.request.user == task.assigned_to else task.assigned_to
                TaskActivity.objects.create(
                    task=task,
                    user=self.request.user,
                    activity_type='status_change',
                    old_value=old_status,
                    new_value=new_status,
                )
                create_notification(
                    recipient=recipient,
                    actor=self.request.user,
                    notification_type=Notification.TYPE_TASK_STATUS_CHANGED,
                    title=f'Status updated for task {task.title}',
                    body=f'{display_name(self.request.user)} changed the status to {new_status.replace("_", " ")}',
                    link_url=f'/tasks/{task.id}',
                    payload={
                        'task_id': task.id,
                        'old_status': old_status,
                        'new_status': new_status,
                    },
                )

            log_audit(
                action=AuditAction.TASK_STATUS_CHANGED,
                request=self.request,
                target_type='task',
                target_id=task.id,
                metadata={
                    'old_status': old_status,
                    'new_status': new_status,
                    'assigned_to_id': task.assigned_to_id,
                    'reason': rejection_reason or '',
                },
            )

        # Handle task detail edits (deadline, priority, title, description)
        changes = {}
        if old_deadline != task.deadline:
            changes['deadline'] = {
                'old': old_deadline.isoformat() if old_deadline else None,
                'new': task.deadline.isoformat() if task.deadline else None,
            }
        if old_priority != task.priority:
            changes['priority'] = {'old': old_priority, 'new': task.priority}
        if old_title != task.title:
            changes['title'] = {'old': old_title, 'new': task.title}
        if old_description != task.description:
            changes['description'] = {'old': old_description, 'new': task.description}

        if changes:
            change_descriptions = []
            if 'deadline' in changes:
                old_fmt = old_deadline.strftime('%b %d, %Y %H:%M') if old_deadline else 'None'
                new_fmt = task.deadline.strftime('%b %d, %Y %H:%M') if task.deadline else 'None'
                change_descriptions.append(f"Deadline updated from {old_fmt} to {new_fmt}")
            if 'priority' in changes:
                change_descriptions.append(f"Priority changed from {old_priority} to {task.priority}")
            if 'title' in changes:
                change_descriptions.append(f"Title updated to '{task.title}'")
            if 'description' in changes:
                change_descriptions.append("Description updated")

            summary_text = "; ".join(change_descriptions)
            activity_comment = f"{summary_text}. Note: {edit_reason}" if edit_reason else summary_text

            TaskActivity.objects.create(
                task=task,
                user=self.request.user,
                activity_type='task_edited',
                old_value=str(changes)[:255],
                new_value=summary_text[:255],
                comment=activity_comment,
            )

            log_audit(
                action=AuditAction.TASK_EDITED,
                request=self.request,
                target_type='task',
                target_id=task.id,
                metadata={
                    'changes': changes,
                    'reason': edit_reason or '',
                    'assigned_to_id': task.assigned_to_id,
                },
            )

            create_notification(
                recipient=task.assigned_to,
                actor=self.request.user,
                notification_type=Notification.TYPE_TASK_STATUS_CHANGED,
                title=f'Task updated: {task.title}',
                body=f'{display_name(self.request.user)} updated task: {summary_text}',
                link_url=f'/tasks/{task.id}',
                payload={'task_id': task.id, 'changes': changes},
            )

            TaskEmailManager.send_task_updated_emails(task, changes=changes, reason=edit_reason or '')

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        task = self.get_object()
        if request.user != task.assigned_by:
            return Response({'error': 'Only the assigner can approve task completion.'}, status=status.HTTP_403_FORBIDDEN)
        if task.status != 'under_review':
            return Response({'error': 'Only tasks under review can be approved.'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = self.get_serializer(task, data={'status': 'completed'}, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        task = self.get_object()
        if request.user != task.assigned_by:
            return Response({'error': 'Only the assigner can reject task completion.'}, status=status.HTTP_403_FORBIDDEN)
        if task.status != 'under_review':
            return Response({'error': 'Only tasks under review can be rejected.'}, status=status.HTTP_400_BAD_REQUEST)

        reason = request.data.get('reason') or ''
        if not isinstance(reason, str):
            raise ValidationError({'reason': 'Must be text.'})
        reason = reason.strip()
        target_status = request.data.get('target_status', 'in_progress')
        if target_status not in ['in_progress', 'pending']:
            target_status = 'in_progress'

        serializer = self.get_serializer(task, data={'status': target_status, 'rejection_reason': reason}, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='attachment-upload-url')
    def attachment_upload_url(self, request, pk=None):
        task = self.get_object()
        serializer = TaskAttachmentUploadRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            payload = generate_task_attachment_upload_url(
                task_id=task.id,
                file_name=serializer.validated_data['file_name'],
                content_type=serializer.validated_data['content_type'],
            )
        except TaskAttachmentStorageError as exc:
            raise ValidationError(str(exc))
        return Response(payload)

    @action(detail=True, methods=['get'])
    def activities(self, request, pk=None):
        task = self.get_object()
        activities = task.activities.all()
        serializer = TaskActivitySerializer(activities, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def comments(self, request, pk=None):
        task = self.get_object()
        serializer = TaskCommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        attachments_data = serializer.validated_data.get('attachments')
        if attachments_data:
            expected_prefix = build_task_attachment_key_prefix(task.id)
            # Accept either configured prefix (which may include env prefix) or the bare 'task-attachments/<id>/'
            alt_prefix = None
            if '/' in expected_prefix:
                alt_prefix = expected_prefix.split('/', 1)[-1]
                if not alt_prefix.endswith('/'):
                    alt_prefix = alt_prefix + '/'
            for attachment_data in attachments_data:
                key = str(attachment_data['object_key'])
                ok = key.startswith(expected_prefix) or (alt_prefix and key.startswith(alt_prefix))
                if not ok:
                    return Response(
                        {'attachments': ['One or more attachment keys do not belong to this task.']},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        links_data = serializer.validated_data.get('links', [])
        activity = TaskActivity.objects.create(
            task=task,
            user=request.user,
            activity_type='comment',
            comment=serializer.validated_data['comment'],
            links=links_data,
        )

        if attachments_data:
            for attachment_data in attachments_data:
                TaskAttachment.objects.create(
                    activity=activity,
                    object_key=attachment_data['object_key'],
                    file_name=attachment_data['file_name'],
                    content_type=attachment_data['content_type'],
                    size=attachment_data['size'],
                )

        recipient = task.assigned_by if request.user == task.assigned_to else task.assigned_to
        notification_body = f'{display_name(request.user)} made a new comment "{_comment_preview(serializer.validated_data["comment"], 3)}"'
        if attachments_data:
            attachment_count = len(attachments_data)
            files_text = "file" if attachment_count == 1 else "files"
            notification_body += f' [{attachment_count} {files_text} attached]'
        if links_data:
            link_count = len(links_data)
            links_text = "link" if link_count == 1 else "links"
            notification_body += f' [{link_count} {links_text} attached]'
        create_notification(
            recipient=recipient,
            actor=request.user,
            notification_type=Notification.TYPE_TASK_COMMENT,
            title=f'New comment on task {task.title}',
            body=notification_body,
            link_url=f'/tasks/{task.id}',
            payload={
                'task_id': task.id,
                'comment_id': str(activity.id),
            },
        )

        response_serializer = TaskActivitySerializer(activity)
        return Response(response_serializer.data, status=status.HTTP_201_CREATED)


class TaskDraftViewSet(ModelViewSet):
    serializer_class = TaskDraftSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return TaskDraft.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
