from django.db import migrations


def grant(apps, schema_editor):
    """Credit client rights as agreed (2026-11-27), by the codes used in production:
    the Tourism / Operations supervisor and every member of Tourism Accounts manage;
    Tourism / Operations and Tourism Internal Control members view; the Tourism
    line manager views. Afterwards they are set on the records (Django admin), not
    in code. Units that do not exist are skipped."""
    Department = apps.get_model('organization', 'Department')
    Unit = apps.get_model('organization', 'Unit')

    Unit.objects.filter(code__iexact='operations', department__code__iexact='TOURISM').update(
        credit_client_access='supervisor_manages'
    )
    Unit.objects.filter(code__iexact='tourism-accounts').update(credit_client_access='manage')
    Unit.objects.filter(code__iexact='tourism-internal-control').update(credit_client_access='view')
    Department.objects.filter(code__iexact='TOURISM').update(manager_views_credit_clients=True)


class Migration(migrations.Migration):
    dependencies = [
        ('organization', '0005_credit_client_access'),
    ]

    operations = [
        migrations.RunPython(grant, migrations.RunPython.noop),
    ]
