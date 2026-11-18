"""Tasks and task drafts."""

import logging
from datetime import timedelta

from django.db import models, transaction
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from audit import log_audit
from audit.actions import AuditAction
from common.exceptions import Conflict
from common.params import list_param
from common.permissions import has_global_access
from common.uploads import checked_upload
from common.users import display_name
from common.viewsets import (
    CreateModelMixin,
    DestroyModelMixin,
    GenericViewSet,
    ListModelMixin,
    PartialUpdateModelMixin,
    RetrieveModelMixin,
)
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
from ..permissions import IsTaskAssignedOrAssigner, IsTaskAssigner, require_may_change_task
from ..s3 import (
    TaskAttachmentStorageError,
    build_task_attachment_key_prefix,
    generate_task_attachment_upload_url,
)
from ..serializers import (
    MAX_DRAFTS_PER_USER,
    TaskActivitySerializer,
    TaskAttachmentUploadRequestSerializer,
    TaskCommentCreateSerializer,
    TaskDraftSerializer,
    TaskRejectSerializer,
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


def _choice_of(choices):
    allowed = {value for value, _label in choices}

    def cast(value):
        if value not in allowed:
            raise ValueError(value)
        return value

    return cast


class TaskViewSet(
    ListModelMixin,
    RetrieveModelMixin,
    CreateModelMixin,
    PartialUpdateModelMixin,
    GenericViewSet,
):
    serializer_class = TaskSerializer
    permission_classes = [IsAuthenticated]
    # No DELETE: tasks are a record of assigned work. Deleting one would also
    # remove its activity history and attachments, with nothing in the audit log.
    lookup_value_converter = 'uuid'

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

        params = self.request.query_params
        statuses = list_param(params, 'status', _choice_of(Task.STATUS_CHOICES))
        if statuses:
            queryset = queryset.filter(status__in=statuses)

        priorities = list_param(params, 'priority', _choice_of(Task.PRIORITY_CHOICES))
        if priorities:
            queryset = queryset.filter(priority__in=priorities)

        return queryset

    def get_permissions(self):
        if self.action in ['list', 'create']:
            return [IsAuthenticated()]
        if self.action in ['approve', 'reject']:
            return [IsAuthenticated(), IsTaskAssigner()]
        return [IsAuthenticated(), IsTaskAssignedOrAssigner()]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # `assigned_to_ids` for several people, or `assigned_to_id` for one.
        assignees = serializer.validated_data.get('assigned_to_ids') or [serializer.validated_data['assigned_to']]

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

        # One task per assignee, so the response is always a list.
        serialized = TaskSerializer(created_tasks, many=True, context={'request': request}).data
        return Response({'count': len(serialized), 'results': serialized}, status=status.HTTP_201_CREATED)

    @transaction.atomic
    def perform_update(self, serializer):
        # The task row is locked for the whole update, so two people acting at
        # once (say, approving while the assignee withdraws) cannot both win,
        # and the history written below always matches the change made.
        old_task = Task.objects.select_for_update().get(pk=serializer.instance.pk)
        if old_task.status != serializer.instance.status:
            raise Conflict('This task was just changed by someone else. Reload it and try again.')
        require_may_change_task(self.request.user, old_task, serializer.validated_data)
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
        if task.status != 'under_review':
            raise ValidationError('Only tasks under review can be approved.')

        serializer = self.get_serializer(task, data={'status': 'completed'}, partial=True)
        serializer.is_valid(raise_exception=True)
        self.perform_update(serializer)
        return Response(TaskSerializer(task, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        task = self.get_object()
        if task.status != 'under_review':
            raise ValidationError('Only tasks under review can be rejected.')

        rejection = TaskRejectSerializer(data=request.data)
        rejection.is_valid(raise_exception=True)

        serializer = self.get_serializer(
            task,
            data={
                'status': rejection.validated_data['target_status'],
                'rejection_reason': rejection.validated_data['reason'],
            },
            partial=True,
        )
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
            for attachment_data in attachments_data:
                key = str(attachment_data['object_key'])
                if not key.startswith(expected_prefix):
                    raise ValidationError(
                        {'attachments': ['One or more attachment keys do not belong to this task.']}
                    )
                # Record what storage holds, not what the browser claims.
                attachment_data['size'], attachment_data['content_type'] = checked_upload(
                    key,
                    field='attachments',
                    claimed_size=attachment_data['size'],
                    claimed_type=attachment_data['content_type'],
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


class TaskDraftViewSet(
    ListModelMixin,
    RetrieveModelMixin,
    CreateModelMixin,
    PartialUpdateModelMixin,
    DestroyModelMixin,
    GenericViewSet,
):
    """A user's own unfinished task forms. A short personal list, shown whole."""

    serializer_class = TaskDraftSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None
    lookup_value_converter = 'uuid'

    def get_queryset(self):
        return TaskDraft.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        if TaskDraft.objects.filter(user=self.request.user).count() >= MAX_DRAFTS_PER_USER:
            raise ValidationError(f'You can keep at most {MAX_DRAFTS_PER_USER} drafts. Delete some first.')
        serializer.save(user=self.request.user)
