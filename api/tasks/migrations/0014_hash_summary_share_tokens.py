import hashlib
from datetime import timedelta

from django.conf import settings
from django.db import migrations
from django.utils import timezone


def hash_tokens(apps, schema_editor):
    """Replace each stored share token with its SHA-256, which is what lookups
    now compare against, so links already handed out keep working. Public links
    created before links had an expiry get the standard lifetime from today."""
    expiry = timezone.now() + timedelta(days=getattr(settings, 'SUMMARY_SHARE_LINK_DAYS', 30))

    for model_name in ('WeeklySummaryShare', 'WeeklySummaryUserShare'):
        model = apps.get_model('tasks', model_name)
        for share in model.objects.exclude(share_token__isnull=True).exclude(share_token='').iterator():
            share.share_token = hashlib.sha256(share.share_token.encode('utf-8')).hexdigest()
            share.save(update_fields=['share_token'])

    apps.get_model('tasks', 'WeeklySummaryShare').objects.filter(expires_at__isnull=True).update(expires_at=expiry)


class Migration(migrations.Migration):
    dependencies = [
        ('tasks', '0013_recurringschedule_include_weekends_and_more'),
    ]

    operations = [
        # Hashing cannot be undone; going backwards leaves the hashes in place
        # (old links then stop working, which is the safe direction).
        migrations.RunPython(hash_tokens, migrations.RunPython.noop),
    ]
