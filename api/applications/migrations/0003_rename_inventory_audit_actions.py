from django.db import migrations

# Inventory audit rows used dotted lowercase names (inventory.item.created)
# while every other action is UPPER_SNAKE. Stored rows are renamed so the log
# can be filtered by one style.
RENAMES = {
    'inventory.item.assigned': 'INVENTORY_ITEM_ASSIGNED',
    'inventory.item.created': 'INVENTORY_ITEM_CREATED',
    'inventory.item.deleted': 'INVENTORY_ITEM_DELETED',
    'inventory.item.returned': 'INVENTORY_ITEM_RETURNED',
    'inventory.item.updated': 'INVENTORY_ITEM_UPDATED',
    'inventory.maintenance.created': 'INVENTORY_MAINTENANCE_CREATED',
    'inventory.maintenance.deleted': 'INVENTORY_MAINTENANCE_DELETED',
    'inventory.maintenance.updated': 'INVENTORY_MAINTENANCE_UPDATED',
}


def _rename(apps, mapping):
    AuditLog = apps.get_model('applications', 'AuditLog')
    for old, new in mapping.items():
        AuditLog.objects.filter(action=old).update(action=new)


def forwards(apps, schema_editor):
    _rename(apps, RENAMES)


def backwards(apps, schema_editor):
    _rename(apps, {new: old for old, new in RENAMES.items()})


class Migration(migrations.Migration):
    dependencies = [
        ('applications', '0002_scrub_share_tokens_from_audit_logs'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
