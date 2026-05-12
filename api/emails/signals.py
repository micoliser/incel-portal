import logging
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)

User = get_user_model()


# ===== TASK SIGNALS =====
# Import these in the signal handler to avoid circular imports at startup
def _get_task_model():
    from tasks.models import Task
    return Task


def _get_recurring_task_model():
    from tasks.models import RecurringSchedule
    return RecurringSchedule


@receiver(pre_save, sender='tasks.Task')
def cache_task_previous_state(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_status = None
        return
    previous = sender.objects.filter(pk=instance.pk).values_list('status', flat=True).first()
    instance._previous_status = previous


@receiver(pre_save, sender=User)
def cache_user_previous_state(sender, instance, **kwargs):
    if not instance.pk:
        instance._previous_is_active = None
        return
    previous = sender.objects.filter(pk=instance.pk).values_list('is_active', flat=True).first()
    instance._previous_is_active = previous


@receiver(post_save, sender='tasks.Task')
def task_created_handler(sender, instance, created, **kwargs):
    """Send emails when task is created."""
    if created and not kwargs.get('skip_email', False):
        logger.info(f"task_created_handler triggered for Task id={getattr(instance,'pk',None)}")
        from emails.services.task_emails import TaskEmailManager
        try:
            TaskEmailManager.send_task_created_emails(instance)
        except Exception as e:
            logger.error(f"Failed to send task created emails: {str(e)}")


@receiver(post_save, sender='tasks.Task')
def task_completed_handler(sender, instance, created, **kwargs):
    """Send emails when task is completed."""
    if not created:
        try:
            previous_status = getattr(instance, '_previous_status', None)
            if previous_status != 'completed' and instance.status == 'completed':
                from emails.services.task_emails import TaskEmailManager
                TaskEmailManager.send_task_completed_emails(instance)
        except Exception as e:
            logger.error(f"Failed to send task completed emails: {str(e)}")


@receiver(post_save, sender='tasks.RecurringSchedule')
def recurring_task_created_handler(sender, instance, created, **kwargs):
    """Send emails when recurring task is created."""
    if created and not kwargs.get('skip_email', False):
        from emails.services.task_emails import TaskEmailManager
        try:
            TaskEmailManager.send_recurring_task_created_emails(instance)
        except Exception as e:
            logger.error(f"Failed to send recurring task created emails: {str(e)}")


# ===== APPLICATION SIGNALS =====
def _get_application_model():
    from applications.models import InternalApplication
    return InternalApplication


def _get_access_override_model():
    from applications.models import ApplicationAccessOverride
    return ApplicationAccessOverride


@receiver(post_save, sender='applications.InternalApplication')
def application_created_handler(sender, instance, created, **kwargs):
    """Send emails when application is created."""
    if created and not kwargs.get('skip_email', False):
        # Application creation emails are sent from the application views after
        # department relations are finalized, so this signal intentionally stays
        # silent to avoid firing before many-to-many state is available.
        logger.info(
            "application_created_handler triggered for InternalApplication id=%s",
            getattr(instance, 'pk', None),
        )


@receiver(post_save, sender='applications.ApplicationAccessOverride')
def access_override_handler(sender, instance, created, **kwargs):
    """Send emails when access is granted/revoked via override."""
    if not kwargs.get('skip_email', False):
        from emails.services.application_emails import ApplicationEmailManager
        try:
            app = instance.application
            user_email = instance.user.email

            if instance.effect == 'ALLOW':
                ApplicationEmailManager.send_access_granted_email(
                    app, user_email, instance.reason
                )
            elif instance.effect == 'DENY':
                ApplicationEmailManager.send_access_revoked_email(
                    app, user_email, instance.reason
                )
        except Exception as e:
            logger.error(f"Failed to send access override emails: {str(e)}")


# ===== USER SIGNALS =====
@receiver(post_save, sender=User)
def user_created_handler(sender, instance, created, **kwargs):
    """Send welcome email when user is created."""
    if created and not kwargs.get('skip_email', False):
        from emails.services.user_emails import UserEmailManager
        try:
            temporary_password = kwargs.get('temporary_password') or getattr(
                instance, '_temporary_password', None
            )
            if not temporary_password:
                logger.info(
                    "Skipping user created email for user id=%s because no initial password was provided",
                    getattr(instance, 'pk', None),
                )
                return
            UserEmailManager.send_user_created_email(instance, temporary_password)
        except Exception as e:
            logger.error(f"Failed to send user created email: {str(e)}")


@receiver(post_save, sender=User)
def user_status_changed_handler(sender, instance, created, **kwargs):
    """Send email when user is enabled/disabled."""
    if not created:
        try:
            previous_is_active = getattr(instance, '_previous_is_active', None)
            if previous_is_active != instance.is_active and not kwargs.get('skip_email', False):
                from emails.services.user_emails import UserEmailManager
                UserEmailManager.send_user_status_changed_email(instance)
        except User.DoesNotExist:
            pass
        except Exception as e:
            logger.error(f"Failed to send user status changed email: {str(e)}")
