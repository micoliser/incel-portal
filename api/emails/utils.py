"""Utility functions and helpers for email system."""

import logging
from typing import List, Optional, Dict, Any
from django.contrib.auth import get_user_model
from emails.config import EmailConfig

User = get_user_model()
logger = logging.getLogger(__name__)


class EmailNotificationHelper:
    """Helper class for managing email notifications."""

    @staticmethod
    def is_email_enabled() -> bool:
        """Check if email notifications are enabled."""
        return EmailConfig.is_enabled()

    @staticmethod
    def is_debug_mode() -> bool:
        """Check if debug mode is enabled."""
        return EmailConfig.is_debug_mode()

    @staticmethod
    def get_valid_email(email: str) -> Optional[str]:
        """
        Validate and return email address.
        
        Args:
            email: Email address to validate
            
        Returns:
            Email if valid, None otherwise
        """
        if not email or not isinstance(email, str):
            return None
        
        email = email.strip().lower()
        
        # Simple email validation
        if '@' not in email or '.' not in email.split('@')[1]:
            logger.warning(f"Invalid email: {email}")
            return None
        
        return email

    @staticmethod
    def filter_valid_emails(emails: List[str]) -> List[str]:
        """
        Filter out invalid emails from a list.
        
        Args:
            emails: List of email addresses
            
        Returns:
            List of valid email addresses
        """
        valid = []
        for email in emails:
            validated = EmailNotificationHelper.get_valid_email(email)
            if validated:
                valid.append(validated)
        return list(set(valid))  # Remove duplicates

    @staticmethod
    def get_user_by_email(email: str) -> Optional[User]:
        """
        Get user by email address.
        
        Args:
            email: Email address
            
        Returns:
            User instance or None
        """
        try:
            return User.objects.get(email=email)
        except User.DoesNotExist:
            return None

    @staticmethod
    def format_name(user: User) -> str:
        """
        Format user's display name.
        
        Args:
            user: User instance
            
        Returns:
            Formatted name (first_name last_name or username)
        """
        if user.first_name and user.last_name:
            return f"{user.first_name} {user.last_name}"
        elif user.first_name:
            return user.first_name
        return user.username

    @staticmethod
    def get_department_users(department_id: str) -> List[str]:
        """
        Get all active users' emails in a department.
        
        Args:
            department_id: Department UUID
            
        Returns:
            List of user emails
        """
        from organization.models import Department
        from accounts.models import StaffProfile

        try:
            Department.objects.get(id=department_id)
            profiles = StaffProfile.objects.filter(
                is_active=True,
                department_id=department_id,
            ).select_related('user')
            return [p.user.email for p in profiles if p.user and p.user.is_active]
        except Exception as e:
            logger.error(f"Failed to get department users: {str(e)}")
            return []

    @staticmethod
    def get_all_active_user_emails() -> List[str]:
        """
        Get all active users' emails.
        
        Returns:
            List of active user emails
        """
        return list(
            User.objects.filter(is_active=True)
            .values_list('email', flat=True)
        )

    @staticmethod
    def log_email_event(
        email_type: str,
        recipients: List[str],
        subject: str,
        status: str = 'pending',
        error_message: str = None
    ) -> None:
        """
        Log an email event for audit trail.
        
        Args:
            email_type: Type of email
            recipients: List of recipients
            subject: Email subject
            status: Email status (pending/sent/failed)
            error_message: Error message if failed
        """
        if not EmailConfig.is_enabled():
            return
        
        try:
            from emails.models import EmailLog
            EmailLog.objects.create(
                email_type=email_type,
                recipients=recipients,
                subject=subject,
                status=status,
                error_message=error_message,
            )
        except Exception as e:
            logger.error(f"Failed to log email event: {str(e)}")


class BulkEmailManager:
    """Manage bulk email operations safely."""

    @staticmethod
    def send_to_multiple_users(
        email_type: str,
        users: List[User],
        email_service,
        context_builder,
        batch_size: int = 100
    ) -> Dict[str, int]:
        """
        Send emails to multiple users with batching.
        
        Args:
            email_type: Type of email
            users: List of users to send to
            email_service: Email service class
            context_builder: Function to build context for each user
            batch_size: Number of emails per batch
            
        Returns:
            Dict with success/failure counts
        """
        results = {'success': 0, 'failed': 0}
        
        for i in range(0, len(users), batch_size):
            batch = users[i:i + batch_size]
            
            for user in batch:
                try:
                    context = context_builder(user)
                    service = email_service()
                    service.send([user.email], context)
                    results['success'] += 1
                except Exception as e:
                    logger.error(
                        f"Failed to send {email_type} to {user.email}: {str(e)}"
                    )
                    results['failed'] += 1
        
        logger.info(
            f"Bulk email results: {results['success']} sent, "
            f"{results['failed']} failed"
        )
        return results

    @staticmethod
    def send_to_department(
        email_type: str,
        department_id: str,
        email_service,
        context_builder
    ) -> Dict[str, int]:
        """
        Send emails to all users in a department.
        
        Args:
            email_type: Type of email
            department_id: Department UUID
            email_service: Email service class
            context_builder: Function to build context
            
        Returns:
            Dict with success/failure counts
        """
        try:
            from accounts.models import StaffProfile

            profiles = StaffProfile.objects.filter(
                is_active=True,
                department_id=department_id,
            ).select_related('user')
            users = [p.user for p in profiles if p.user and p.user.is_active]
            return BulkEmailManager.send_to_multiple_users(
                email_type, list(users), email_service, context_builder
            )
        except Exception as e:
            logger.error(
                f"Failed to send bulk emails to department: {str(e)}"
            )
            return {'success': 0, 'failed': 0}


class EmailTemplateContext:
    """Helper for building common template contexts."""

    @staticmethod
    def get_base_context(**kwargs) -> Dict[str, Any]:
        """Get base context available in all emails."""
        return {
            'portal_name': 'Incel Portal',
            'company_name': 'Your Company',
            'support_email': 'support@yourcompany.com',
            **kwargs
        }

    @staticmethod
    def get_task_context(task: Any, recipient_type: str = 'assignee') -> Dict[str, Any]:
        """Get context for task-related emails."""
        context = EmailTemplateContext.get_base_context()
        context.update({
            'task_id': str(task.id),
            'task_name': task.title,
            'recipient_type': recipient_type,
            'description': task.description,
            'due_date': task.due_date,
            'priority': task.priority,
        })
        
        if recipient_type == 'assigner':
            context.update({
                'recipient_name': EmailNotificationHelper.format_name(task.created_by),
                'other_user_name': EmailNotificationHelper.format_name(task.assigned_to),
            })
        else:
            context.update({
                'recipient_name': EmailNotificationHelper.format_name(task.assigned_to),
                'other_user_name': EmailNotificationHelper.format_name(task.created_by),
            })
        
        return context

    @staticmethod
    def get_application_context(
        application: Any,
        user_email: str = None
    ) -> Dict[str, Any]:
        """Get context for application-related emails."""
        context = EmailTemplateContext.get_base_context()
        context.update({
            'application_id': str(application.id),
            'application_name': application.name,
            'application_url': application.app_url,
            'description': application.description,
            'logo_url': application.logo_url,
        })
        
        if user_email:
            user = EmailNotificationHelper.get_user_by_email(user_email)
            if user:
                context['recipient_name'] = EmailNotificationHelper.format_name(user)
        
        return context

    @staticmethod
    def get_user_context(user: User) -> Dict[str, Any]:
        """Get context for user-related emails."""
        context = EmailTemplateContext.get_base_context()
        context.update({
            'user_id': str(user.id),
            'username': user.username,
            'email': user.email,
            'first_name': user.first_name or user.username,
            'is_active': user.is_active,
        })
        return context
