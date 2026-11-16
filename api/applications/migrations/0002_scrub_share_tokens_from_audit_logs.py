from django.db import migrations


def scrub_share_tokens(apps, schema_editor):
    """Remove weekly-summary share tokens that older code wrote into audit metadata.

    A share token is a credential: anyone holding it can open the summary. The
    share action no longer logs it; this removes the copies already stored.
    """
    AuditLog = apps.get_model('applications', 'AuditLog')
    logs = AuditLog.objects.filter(action='WEEKLY_SUMMARY_SHARED')
    for log in logs.iterator():
        metadata = log.metadata_json
        if isinstance(metadata, dict) and 'share_token' in metadata:
            metadata.pop('share_token')
            log.metadata_json = metadata
            log.save(update_fields=['metadata_json'])


class Migration(migrations.Migration):

    dependencies = [
        ('applications', '0001_initial'),
    ]

    operations = [
        # The tokens cannot be restored, so reversing this is a no-op.
        migrations.RunPython(scrub_share_tokens, migrations.RunPython.noop),
    ]
