from django.db import migrations

# Ticket requests as agreed on 2026-11-27, by the codes used in production.
# Afterwards they are edited in Django admin (Service requests > Audiences).
# Anything that does not exist (a fresh or test database) is skipped.
UNIT_ROWS = [
    # (purpose, kind, department code, unit code)
    ('submit', 'unit_members', 'TOURISM', 'operations'),
    ('notify', 'unit_members', 'INTERNAL_CONTROL', 'tourism-internal-control'),
    ('notify', 'unit_supervisor', 'TOURISM', 'operations'),
    ('view', 'unit_members', 'TRADING', 'tourism-accounts'),
    ('first_approval', 'unit_supervisor', 'TOURISM', 'sales'),
    ('first_approval', 'unit_supervisor', 'TOURISM', 'operations'),
]
DEPARTMENT_ROWS = [
    ('notify', 'TOURISM'),
    ('first_approval', 'TOURISM'),
]
ROLE_ROWS = [
    ('notify', 'ED'),
    ('final_approval', 'ED'),
]


def create(apps, schema_editor):
    Audience = apps.get_model('service_requests', 'Audience')
    Unit = apps.get_model('organization', 'Unit')
    Department = apps.get_model('organization', 'Department')
    Role = apps.get_model('organization', 'Role')

    for purpose, kind, department_code, unit_code in UNIT_ROWS:
        unit = Unit.objects.filter(code__iexact=unit_code, department__code__iexact=department_code).first()
        if unit:
            Audience.objects.get_or_create(service='ticket', purpose=purpose, kind=kind, unit=unit)
    for purpose, department_code in DEPARTMENT_ROWS:
        department = Department.objects.filter(code__iexact=department_code).first()
        if department:
            Audience.objects.get_or_create(
                service='ticket', purpose=purpose, kind='department_manager', department=department,
            )
    for purpose, role_code in ROLE_ROWS:
        role = Role.objects.filter(code__iexact=role_code).first()
        if role:
            Audience.objects.get_or_create(service='ticket', purpose=purpose, kind='role', role=role)


class Migration(migrations.Migration):
    dependencies = [
        ('service_requests', '0001_initial'),
        ('organization', '0006_set_credit_client_access'),
    ]

    operations = [migrations.RunPython(create, migrations.RunPython.noop)]
