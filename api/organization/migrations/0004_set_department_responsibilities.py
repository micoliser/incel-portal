from django.db import migrations


def set_from_current_rules(apps, schema_editor):
    """Carry over today's behaviour: the department named IT manages inventory
    and takes IT support; the department with code HR takes other support.
    Executive roles (codes ED and MD) are marked as having global access, which
    the code used to infer from the code alone."""
    Department = apps.get_model('organization', 'Department')
    Role = apps.get_model('organization', 'Role')

    Department.objects.filter(name__iexact='IT').update(manages_inventory=True)
    Department.objects.filter(code__iexact='IT').update(handles_it_support=True)
    Department.objects.filter(code__iexact='HR').update(handles_general_support=True)
    Role.objects.filter(code__in=['ED', 'MD']).update(has_global_access=True)


class Migration(migrations.Migration):
    dependencies = [
        ('organization', '0003_department_responsibilities'),
        # That migration creates the IT department on a fresh database; the
        # flags must be set after it.
        ('inventory', '0006_set_managing_dept_it'),
    ]

    operations = [
        migrations.RunPython(set_from_current_rules, migrations.RunPython.noop),
    ]
