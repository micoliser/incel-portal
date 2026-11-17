from django.db import migrations


def deactivate(apps, schema_editor):
    """Subscriptions created before endpoints were restricted may point
    anywhere. Any that is not a recognised browser push service is switched
    off, so the server never posts to it."""
    from notifications.serializers import is_allowed_push_endpoint

    PushSubscription = apps.get_model('notifications', 'PushSubscription')
    for subscription in PushSubscription.objects.filter(is_active=True).iterator():
        if not is_allowed_push_endpoint(subscription.endpoint):
            subscription.is_active = False
            subscription.save(update_fields=['is_active'])


class Migration(migrations.Migration):
    dependencies = [
        ('notifications', '0004_notification_type_choices'),
    ]

    operations = [
        migrations.RunPython(deactivate, migrations.RunPython.noop),
    ]
