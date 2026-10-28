import logging
from typing import List, Dict, Any
from emails.services.base_email_service import BaseEmailService
from emails.config import EmailType

logger = logging.getLogger(__name__)


class TaskCreatedEmailService(BaseEmailService):
    """Send email when a task is created."""

    email_type = EmailType.TASK_CREATED
    template_name = "emails/tasks/task_created.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        task_name = context.get('task_name', 'Task')
        recipient_type = context.get('recipient_type', 'assignee')

        if recipient_type == 'assigner':
            return f"You created a new task: {task_name}"
        if recipient_type == 'manager_both':
            assigner_name = context.get('assigner_name', 'Team Member')
            assignee_name = context.get('assignee_name', 'Team Member')
            return f"[Team Task] {assigner_name} assigned a task to {assignee_name}: {task_name}"
        if recipient_type == 'manager_assignee':
            assignee_name = context.get('assignee_name', 'Team Member')
            return f"[Task Assigned] {assignee_name} was assigned: {task_name}"
        if recipient_type == 'manager_assigner':
            assigner_name = context.get('assigner_name', 'Team Member')
            return f"[Task Delegation] {assigner_name} assigned a task: {task_name}"
        return f"You've been assigned a new task: {task_name}"


class TaskCompletedEmailService(BaseEmailService):
    """Send email when a task is completed."""

    email_type = EmailType.TASK_COMPLETED
    template_name = "emails/tasks/task_completed.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        task_name = context.get('task_name', 'Task')
        recipient_type = context.get('recipient_type', 'assignee')

        if recipient_type == 'assigner':
            return f"Task completed: {task_name}"
        if recipient_type == 'manager_both':
            assigner_name = context.get('assigner_name', 'Team Member')
            assignee_name = context.get('assignee_name', 'Team Member')
            return f"[Team Task Completed] {assignee_name} completed task from {assigner_name}: {task_name}"
        if recipient_type == 'manager_assignee':
            assignee_name = context.get('assignee_name', 'Team Member')
            return f"[Task Completed] {assignee_name} completed: {task_name}"
        if recipient_type == 'manager_assigner':
            assigner_name = context.get('assigner_name', 'Team Member')
            return f"[Task Completed] Task delegated by {assigner_name} completed: {task_name}"
        return f"You completed a task: {task_name}"


class RecurringTaskCreatedEmailService(BaseEmailService):
    """Send email when a recurring task is created."""

    email_type = EmailType.RECURRING_TASK_CREATED
    template_name = "emails/tasks/recurring_task_created.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        task_name = context.get('task_name', 'Recurring Task')
        recipient_type = context.get('recipient_type', 'assignee')

        if recipient_type == 'assigner':
            return f"You created a recurring task: {task_name}"
        if recipient_type == 'manager_both':
            assigner_name = context.get('assigner_name', 'Team Member')
            assignee_name = context.get('assignee_name', 'Team Member')
            return f"[Team Recurring Task] {assigner_name} created recurring task for {assignee_name}: {task_name}"
        if recipient_type == 'manager_assignee':
            assignee_name = context.get('assignee_name', 'Team Member')
            return f"[Recurring Task Assigned] {assignee_name} assigned: {task_name}"
        if recipient_type == 'manager_assigner':
            assigner_name = context.get('assigner_name', 'Team Member')
            return f"[Recurring Task Delegation] {assigner_name} created recurring task: {task_name}"
        return f"You've been assigned a recurring task: {task_name}"


class RecurringTaskUpdatedEmailService(BaseEmailService):
    """Send email when a recurring task is updated."""

    email_type = EmailType.RECURRING_TASK_UPDATED
    template_name = "emails/tasks/recurring_task_status_changed.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        task_name = context.get('task_name', 'Recurring Task')
        recipient_type = context.get('recipient_type', 'assignee')
        if recipient_type == 'manager_both':
            return f"[Team Recurring Task Updated] {task_name}"
        if recipient_type == 'manager_assignee':
            assignee_name = context.get('assignee_name', 'Team Member')
            return f"[Recurring Task Updated] {assignee_name}: {task_name}"
        if recipient_type == 'manager_assigner':
            assigner_name = context.get('assigner_name', 'Team Member')
            return f"[Recurring Task Updated] {assigner_name}'s task: {task_name}"
        return f"Recurring task updated: {task_name}"


class RecurringTaskPausedEmailService(BaseEmailService):
    """Send email when a recurring task is paused."""

    email_type = EmailType.RECURRING_TASK_PAUSED
    template_name = "emails/tasks/recurring_task_status_changed.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        task_name = context.get('task_name', 'Recurring Task')
        recipient_type = context.get('recipient_type', 'assignee')
        if recipient_type == 'manager_both':
            return f"[Team Recurring Task Paused] {task_name}"
        if recipient_type == 'manager_assignee':
            assignee_name = context.get('assignee_name', 'Team Member')
            return f"[Recurring Task Paused] {assignee_name}: {task_name}"
        if recipient_type == 'manager_assigner':
            assigner_name = context.get('assigner_name', 'Team Member')
            return f"[Recurring Task Paused] {assigner_name}'s task: {task_name}"
        return f"Recurring task paused: {task_name}"


class RecurringTaskResumedEmailService(BaseEmailService):
    """Send email when a recurring task is resumed."""

    email_type = EmailType.RECURRING_TASK_RESUMED
    template_name = "emails/tasks/recurring_task_status_changed.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        task_name = context.get('task_name', 'Recurring Task')
        recipient_type = context.get('recipient_type', 'assignee')
        if recipient_type == 'manager_both':
            return f"[Team Recurring Task Resumed] {task_name}"
        if recipient_type == 'manager_assignee':
            assignee_name = context.get('assignee_name', 'Team Member')
            return f"[Recurring Task Resumed] {assignee_name}: {task_name}"
        if recipient_type == 'manager_assigner':
            assigner_name = context.get('assigner_name', 'Team Member')
            return f"[Recurring Task Resumed] {assigner_name}'s task: {task_name}"
        return f"Recurring task resumed: {task_name}"


class RecurringTaskEndedEmailService(BaseEmailService):
    """Send email when a recurring task is ended."""

    email_type = EmailType.RECURRING_TASK_ENDED
    template_name = "emails/tasks/recurring_task_status_changed.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        task_name = context.get('task_name', 'Recurring Task')
        recipient_type = context.get('recipient_type', 'assignee')
        if recipient_type == 'manager_both':
            return f"[Team Recurring Task Ended] {task_name}"
        if recipient_type == 'manager_assignee':
            assignee_name = context.get('assignee_name', 'Team Member')
            return f"[Recurring Task Ended] {assignee_name}: {task_name}"
        if recipient_type == 'manager_assigner':
            assigner_name = context.get('assigner_name', 'Team Member')
            return f"[Recurring Task Ended] {assigner_name}'s task: {task_name}"
        return f"Recurring task ended: {task_name}"


class TaskEmailManager:
    """Manager for task-related emails."""

    @staticmethod
    def _send_to_recipient(service, recipient_email: str, context: Dict[str, Any], task_id: str, label: str) -> None:
        if not recipient_email:
            logger.error("Task %s %s email skipped because recipient email is empty", task_id, label)
            return

        sent = service.send([recipient_email], context)
        if sent:
            logger.info("Task %s %s email queued/sent to %s", task_id, label, recipient_email)
        else:
            logger.error("Task %s %s email failed for %s", task_id, label, recipient_email)

    @staticmethod
    def send_task_created_emails(task: Any) -> None:
        """
        Send emails when task is created.

        Args:
            task: Task instance from models
        """
        # Normalize common fields with fallbacks to support different model names
        task_id = str(getattr(task, 'id', getattr(task, 'pk', '')))
        task_name = getattr(task, 'title', '')
        description = getattr(task, 'description', '')
        # due_date may be named 'due_date' or 'deadline'
        due_date = getattr(task, 'due_date', getattr(task, 'deadline', None))
        priority = getattr(task, 'priority', None)

        # created_by may be named 'created_by' or 'assigned_by'
        created_by = getattr(task, 'created_by', getattr(task, 'assigned_by', None))
        assigned_to = getattr(task, 'assigned_to', getattr(task, 'assigned_to', None))

        # Defensive checks
        if not created_by or not assigned_to:
            # Log and abort if essential participants are missing
            from emails import logger as emails_logger

            emails_logger.error(
                f"TaskEmailManager: missing created_by or assigned_to for task {task_id}"
            )
            return

        assignee_name = getattr(assigned_to, 'get_full_name', lambda: None)() or getattr(assigned_to, 'username', '')
        assigner_name = getattr(created_by, 'get_full_name', lambda: None)() or getattr(created_by, 'username', '')

        # Context for assignee
        assignee_context = {
            'task_id': task_id,
            'task_name': task_name,
            'recipient_type': 'assignee',
            'recipient_name': assignee_name,
            'assignee_name': assignee_name,
            'assigner_name': assigner_name,
            'description': description,
            'due_date': due_date,
            'priority': priority,
            'is_recurring': False,
        }

        service = TaskCreatedEmailService()

        # Send only to assignee
        try:
            TaskEmailManager._send_to_recipient(
                service,
                getattr(assigned_to, 'email', ''),
                assignee_context,
                task_id,
                'assignee',
            )
        except Exception as e:
            logger.error(f"Failed to send assignee email for task {task_id}: {str(e)}")

        # Notify direct managers
        TaskEmailManager._notify_managers(
            service,
            assignee_context,
            assigned_to,
            created_by,
            task_id,
            'task_created',
        )

    @staticmethod
    def _notify_managers(
        service,
        base_context: Dict[str, Any],
        assignee: Any,
        assigner: Any,
        item_id: str,
        event_name: str,
    ) -> None:
        """
        Notifies the direct manager of the assignee and/or assigner,
        applying deduplication and conflict rules.
        """
        try:
            from emails.utils import get_direct_manager

            assignee_manager = get_direct_manager(assignee) if assignee else None
            assigner_manager = get_direct_manager(assigner) if assigner else None

            assignee_id = getattr(assignee, 'id', None)
            assigner_id = getattr(assigner, 'id', None)

            # Conflict Rule: If a manager IS the assigner or assignee, do not send that manager an oversight email
            if assignee_manager and (assignee_manager.id == assigner_id or assignee_manager.id == assignee_id):
                assignee_manager = None

            if assigner_manager and (assigner_manager.id == assigner_id or assigner_manager.id == assignee_id):
                assigner_manager = None

            # Case 1: Both share the same manager
            if assignee_manager and assigner_manager and assignee_manager.id == assigner_manager.id:
                context = dict(base_context)
                context['recipient_type'] = 'manager_both'
                context['recipient_name'] = assignee_manager.get_full_name() or assignee_manager.username
                TaskEmailManager._send_to_recipient(
                    service,
                    assignee_manager.email,
                    context,
                    item_id,
                    f'manager_both_{event_name}',
                )
                return

            # Case 2: Assignee manager
            if assignee_manager:
                context = dict(base_context)
                context['recipient_type'] = 'manager_assignee'
                context['recipient_name'] = assignee_manager.get_full_name() or assignee_manager.username
                TaskEmailManager._send_to_recipient(
                    service,
                    assignee_manager.email,
                    context,
                    item_id,
                    f'manager_assignee_{event_name}',
                )

            # Case 3: Assigner manager
            if assigner_manager:
                context = dict(base_context)
                context['recipient_type'] = 'manager_assigner'
                context['recipient_name'] = assigner_manager.get_full_name() or assigner_manager.username
                TaskEmailManager._send_to_recipient(
                    service,
                    assigner_manager.email,
                    context,
                    item_id,
                    f'manager_assigner_{event_name}',
                )
        except Exception as e:
            logger.error(f"Failed to notify managers for {event_name} {item_id}: {str(e)}")

    @staticmethod
    def send_task_completed_emails(task: Any) -> None:
        """Send emails when task is completed."""
        completed_by = getattr(task, 'assigned_to', None)
        created_by = getattr(task, 'created_by', getattr(task, 'assigned_by', None))
        if not created_by or not completed_by:
            from emails import logger as emails_logger
            emails_logger.error(
                f"TaskEmailManager: missing created_by or assigned_to for completed task {getattr(task, 'id', getattr(task, 'pk', ''))}"
            )
            return

        assigner_name = created_by.get_full_name() or created_by.username
        assignee_name = completed_by.get_full_name() or completed_by.username
        assigner_context = {
            'task_id': str(task.id),
            'task_name': task.title,
            'recipient_type': 'assigner',
            'recipient_name': assigner_name,
            'assigner_name': assigner_name,
            'assignee_name': assignee_name,
            'description': task.description,
            'completed_by': assignee_name,
        }

        service = TaskCompletedEmailService()
        TaskEmailManager._send_to_recipient(service, created_by.email, assigner_context, str(task.id), 'assigner')

        # Notify direct managers
        TaskEmailManager._notify_managers(
            service,
            assigner_context,
            completed_by,
            created_by,
            str(task.id),
            'task_completed',
        )

    @staticmethod
    def send_recurring_task_created_emails(task: Any) -> None:
        """Send emails when recurring task is created."""
        created_by = getattr(task, 'created_by', getattr(task, 'assigned_by', None))
        assigned_to = getattr(task, 'assigned_to', None)
        recurrence_pattern = getattr(task, 'recurrence_pattern', None) or getattr(task, 'frequency', None)
        if not created_by or not assigned_to:
            from emails import logger as emails_logger
            emails_logger.error(
                f"TaskEmailManager: missing created_by or assigned_to for recurring task {getattr(task, 'id', getattr(task, 'pk', ''))}"
            )
            return

        assignee_name = assigned_to.get_full_name() or assigned_to.username
        assigner_name = created_by.get_full_name() or created_by.username
        assignee_context = {
            'task_id': str(task.id),
            'task_name': task.title,
            'recipient_type': 'assignee',
            'recipient_name': assignee_name,
            'assignee_name': assignee_name,
            'assigner_name': assigner_name,
            'description': task.description,
            'recurrence_pattern': recurrence_pattern,
            'is_recurring': True,
        }

        service = RecurringTaskCreatedEmailService()
        TaskEmailManager._send_to_recipient(service, assigned_to.email, assignee_context, str(task.id), 'assignee')

        # Notify direct managers
        TaskEmailManager._notify_managers(
            service,
            assignee_context,
            assigned_to,
            created_by,
            str(task.id),
            'recurring_task_created',
        )

    @staticmethod
    def _build_recurring_schedule_context(schedule: Any, recipient_type: str, event_label: str) -> Dict[str, Any]:
        assigned_by = getattr(schedule, 'assigned_by', None)
        assigned_to = getattr(schedule, 'assigned_to', None)
        assignee_name = getattr(assigned_to, 'get_full_name', lambda: None)() or getattr(assigned_to, 'username', '') if assigned_to else ''
        assigner_name = getattr(assigned_by, 'get_full_name', lambda: None)() or getattr(assigned_by, 'username', '') if assigned_by else ''

        return {
            'schedule_id': str(getattr(schedule, 'id', getattr(schedule, 'pk', ''))),
            'task_name': getattr(schedule, 'title', 'Recurring Task'),
            'recipient_type': recipient_type,
            'recipient_name': assignee_name,
            'assignee_name': assignee_name,
            'assigner_name': assigner_name,
            'description': getattr(schedule, 'description', ''),
            'frequency': getattr(schedule, 'frequency', ''),
            'interval': getattr(schedule, 'interval', 1),
            'timezone': getattr(schedule, 'timezone', 'UTC'),
            'start_at': getattr(schedule, 'start_at', None),
            'end_at': getattr(schedule, 'end_at', None),
            'next_run_at': getattr(schedule, 'next_run_at', None),
            'is_active': getattr(schedule, 'is_active', True),
            'is_paused': getattr(schedule, 'is_paused', False),
            'event_label': event_label,
        }

    @staticmethod
    def send_recurring_task_updated_emails(schedule: Any) -> None:
        assigned_to = getattr(schedule, 'assigned_to', None)
        assigned_by = getattr(schedule, 'assigned_by', None)
        if not assigned_to:
            from emails import logger as emails_logger

            emails_logger.error(
                f"TaskEmailManager: missing assigned_to for recurring schedule update {getattr(schedule, 'id', getattr(schedule, 'pk', ''))}"
            )
            return

        context = TaskEmailManager._build_recurring_schedule_context(
            schedule,
            recipient_type='assignee',
            event_label='edited',
        )
        service = RecurringTaskUpdatedEmailService()
        TaskEmailManager._send_to_recipient(service, assigned_to.email, context, str(schedule.id), 'assignee')
        TaskEmailManager._notify_managers(service, context, assigned_to, assigned_by, str(schedule.id), 'recurring_updated')

    @staticmethod
    def send_recurring_task_paused_emails(schedule: Any) -> None:
        assigned_to = getattr(schedule, 'assigned_to', None)
        assigned_by = getattr(schedule, 'assigned_by', None)
        if not assigned_to:
            from emails import logger as emails_logger

            emails_logger.error(
                f"TaskEmailManager: missing assigned_to for recurring schedule pause {getattr(schedule, 'id', getattr(schedule, 'pk', ''))}"
            )
            return

        context = TaskEmailManager._build_recurring_schedule_context(
            schedule,
            recipient_type='assignee',
            event_label='paused',
        )
        service = RecurringTaskPausedEmailService()
        TaskEmailManager._send_to_recipient(service, assigned_to.email, context, str(schedule.id), 'assignee')
        TaskEmailManager._notify_managers(service, context, assigned_to, assigned_by, str(schedule.id), 'recurring_paused')

    @staticmethod
    def send_recurring_task_resumed_emails(schedule: Any) -> None:
        assigned_to = getattr(schedule, 'assigned_to', None)
        assigned_by = getattr(schedule, 'assigned_by', None)
        if not assigned_to:
            from emails import logger as emails_logger

            emails_logger.error(
                f"TaskEmailManager: missing assigned_to for recurring schedule resume {getattr(schedule, 'id', getattr(schedule, 'pk', ''))}"
            )
            return

        context = TaskEmailManager._build_recurring_schedule_context(
            schedule,
            recipient_type='assignee',
            event_label='resumed',
        )
        service = RecurringTaskResumedEmailService()
        TaskEmailManager._send_to_recipient(service, assigned_to.email, context, str(schedule.id), 'assignee')
        TaskEmailManager._notify_managers(service, context, assigned_to, assigned_by, str(schedule.id), 'recurring_resumed')

    @staticmethod
    def send_recurring_task_ended_emails(schedule: Any) -> None:
        assigned_to = getattr(schedule, 'assigned_to', None)
        assigned_by = getattr(schedule, 'assigned_by', None)
        if not assigned_to:
            from emails import logger as emails_logger

            emails_logger.error(
                f"TaskEmailManager: missing assigned_to for recurring schedule end {getattr(schedule, 'id', getattr(schedule, 'pk', ''))}"
            )
            return

        context = TaskEmailManager._build_recurring_schedule_context(
            schedule,
            recipient_type='assignee',
            event_label='ended',
        )
        service = RecurringTaskEndedEmailService()
        TaskEmailManager._send_to_recipient(service, assigned_to.email, context, str(schedule.id), 'assignee')
        TaskEmailManager._notify_managers(service, context, assigned_to, assigned_by, str(schedule.id), 'recurring_ended')
