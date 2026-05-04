from django.db import migrations, models


def dedupe_push_subscriptions(apps, schema_editor):
    PushSubscription = apps.get_model('notifications', 'PushSubscription')
    endpoint_ids = (
        PushSubscription.objects.values_list('endpoint', flat=True)
        .distinct()
    )

    for endpoint in endpoint_ids:
        subscriptions = list(
            PushSubscription.objects.filter(endpoint=endpoint).order_by('-updated_at', '-id')
        )
        if len(subscriptions) <= 1:
            continue

        duplicate_ids = [subscription.id for subscription in subscriptions[1:]]
        PushSubscription.objects.filter(id__in=duplicate_ids).delete()


def reverse_noop(apps, schema_editor):
    return None


class Migration(migrations.Migration):

    dependencies = [
        ('notifications', '0001_initial'),
    ]

    operations = [
        migrations.RunPython(dedupe_push_subscriptions, reverse_noop),
        migrations.RemoveConstraint(
            model_name='pushsubscription',
            name='notifications_unique_user_endpoint',
        ),
        migrations.AddConstraint(
            model_name='pushsubscription',
            constraint=models.UniqueConstraint(
                fields=['endpoint'],
                name='notifications_unique_endpoint',
            ),
        ),
    ]
