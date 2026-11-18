"""Creating tasks with their history, notifications and emails."""

from __future__ import annotations

from datetime import datetime

from django.contrib.auth import get_user_model

from audit import log_audit
from audit.actions import AuditAction
from common.users import display_name
from notifications.models import Notification
from notifications.services import create_notification

from ..models import (
    RecurringSchedule,
    Task,
    TaskActivity,
)

User = get_user_model()


def create_task_with_side_effects(
    *,
    assigner: User,
    assignee: User,
    title: str,
    description: str = '',
    priority: str = 'medium',
    deadline: datetime | None = None,
    request=None,
    recurrence_schedule: RecurringSchedule | None = None,
    recurrence_scheduled_for: datetime | None = None,
) -> Task:
    task = Task.objects.create(
        title=title,
        description=description,
        assigned_by=assigner,
        assigned_to=assignee,
        priority=priority,
        deadline=deadline,
        recurrence_schedule=recurrence_schedule,
        recurrence_scheduled_for=recurrence_scheduled_for,
    )

    activity_comment = f'Task created by {display_name(assigner)}'
    if recurrence_schedule and recurrence_scheduled_for:
        activity_comment = (
            f'{activity_comment} from recurring schedule '
            f'for {recurrence_scheduled_for.isoformat()}'
        )

    TaskActivity.objects.create(
        task=task,
        user=assigner,
        activity_type='created',
        comment=activity_comment,
    )

    metadata = {
        'title': task.title,
        'assigned_by_id': task.assigned_by_id,
        'assigned_to_id': task.assigned_to_id,
        'priority': task.priority,
        'status': task.status,
    }
    if recurrence_schedule:
        metadata['recurrence_schedule_id'] = str(recurrence_schedule.id)
    if recurrence_scheduled_for:
        metadata['recurrence_scheduled_for'] = recurrence_scheduled_for

    log_audit(
        action=AuditAction.TASK_CREATED,
        request=request,
        actor_user=assigner,
        target_type='task',
        target_id=task.id,
        metadata=metadata,
    )

    body = f'You were assigned: {task.title} by {display_name(assigner)}'
    if recurrence_schedule:
        body = f'{body} [recurring]'

    create_notification(
        recipient=assignee,
        actor=assigner,
        notification_type=Notification.TYPE_TASK_ASSIGNED,
        title='New Task',
        body=body,
        link_url=f'/tasks/{task.id}',
        payload={
            'task_id': task.id,
            'status': task.status,
            'priority': task.priority,
            'recurrence_schedule_id': str(recurrence_schedule.id) if recurrence_schedule else None,
            'recurrence_scheduled_for': recurrence_scheduled_for,
        },
    )

    return task
