from celery import shared_task


@shared_task(name='notifications.send_push', ignore_result=True)
def send_push(notification_id):
    """Deliver one notification to the recipient's browsers."""
    from notifications.services import deliver_push

    deliver_push(notification_id)
