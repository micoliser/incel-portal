from typing import List, Dict, Any
from emails.services.base_email_service import BaseEmailService
from emails.config import EmailType


class TaskCreatedEmailService(BaseEmailService):
    """Send email when a task is created."""

    email_type = EmailType.TASK_CREATED
    template_name = "emails/tasks/task_created.html"

    def _get_subject(self, context: Dict[str, Any]) -> str:
        task_name = context.get('task_name', 'Task')
        recipient_type = context.get('recipient_type', 'assignee')

        if recipient_type == 'assigner':
            return f"You created a new task: {task_name}"
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
        return f"You've been assigned a recurring task: {task_name}"


class TaskEmailManager:
    """Manager for task-related emails."""

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

        # Context for assigner
        assigner_context = {
            'task_id': task_id,
            'task_name': task_name,
            'recipient_type': 'assigner',
            'recipient_name': getattr(created_by, 'get_full_name', lambda: None)() or getattr(created_by, 'username', ''),
            'assignee_name': getattr(assigned_to, 'get_full_name', lambda: None)() or getattr(assigned_to, 'username', ''),
            'description': description,
            'due_date': due_date,
            'priority': priority,
            'is_recurring': False,
        }

        # Context for assignee
        assignee_context = {
            'task_id': task_id,
            'task_name': task_name,
            'recipient_type': 'assignee',
            'recipient_name': getattr(assigned_to, 'get_full_name', lambda: None)() or getattr(assigned_to, 'username', ''),
            'assigner_name': getattr(created_by, 'get_full_name', lambda: None)() or getattr(created_by, 'username', ''),
            'description': description,
            'due_date': due_date,
            'priority': priority,
            'is_recurring': False,
        }

        service = TaskCreatedEmailService()

        # Send to assigner
        try:
            service.send([getattr(created_by, 'email', '')], assigner_context)
        except Exception as e:
            logger.error(f"Failed to send assigner email for task {task_id}: {str(e)}")

        # Send to assignee
        try:
            service.send([getattr(assigned_to, 'email', '')], assignee_context)
        except Exception as e:
            logger.error(f"Failed to send assignee email for task {task_id}: {str(e)}")

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

        assigner_context = {
            'task_id': str(task.id),
            'task_name': task.title,
            'recipient_type': 'assigner',
            'recipient_name': created_by.get_full_name()
            or created_by.username,
            'assignee_name': completed_by.get_full_name()
            or completed_by.username,
            'description': task.description,
            'completed_by': completed_by.get_full_name()
            or completed_by.username,
        }

        assignee_context = {
            'task_id': str(task.id),
            'task_name': task.title,
            'recipient_type': 'assignee',
            'recipient_name': completed_by.get_full_name()
            or completed_by.username,
            'assigner_name': created_by.get_full_name()
            or created_by.username,
            'description': task.description,
        }

        service = TaskCompletedEmailService()
        service.send([created_by.email], assigner_context)
        service.send([completed_by.email], assignee_context)

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

        assigner_context = {
            'task_id': str(task.id),
            'task_name': task.title,
            'recipient_type': 'assigner',
            'recipient_name': created_by.get_full_name()
            or created_by.username,
            'assignee_name': assigned_to.get_full_name()
            or assigned_to.username,
            'description': task.description,
            'recurrence_pattern': recurrence_pattern,
            'is_recurring': True,
        }

        assignee_context = {
            'task_id': str(task.id),
            'task_name': task.title,
            'recipient_type': 'assignee',
            'recipient_name': assigned_to.get_full_name()
            or assigned_to.username,
            'assigner_name': created_by.get_full_name()
            or created_by.username,
            'description': task.description,
            'recurrence_pattern': recurrence_pattern,
            'is_recurring': True,
        }

        service = RecurringTaskCreatedEmailService()
        service.send([created_by.email], assigner_context)
        service.send([assigned_to.email], assignee_context)
