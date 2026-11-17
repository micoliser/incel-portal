from django.db import migrations

INDEX = 'auth_user_email_lower_uniq'


def refuse_if_duplicates(apps, schema_editor):
    """Stop with a clear message instead of a database error when two accounts
    already share an email (in any letter case). Resolve those by hand, for
    example by changing the address on the unused account, then migrate again."""
    from django.db.models import Count
    from django.db.models.functions import Lower

    User = apps.get_model('auth', 'User')
    duplicates = (
        User.objects.exclude(email='')
        .annotate(normalized=Lower('email'))
        .values('normalized')
        .annotate(total=Count('id'))
        .filter(total__gt=1)
    )
    found = [row['normalized'] for row in duplicates]
    if found:
        raise RuntimeError(
            'Cannot make email addresses unique: these are used by more than one account: '
            + ', '.join(sorted(found))
        )


class Migration(migrations.Migration):
    """Email is what people sign in with, so two accounts must never share one."""

    dependencies = [
        ('accounts', '0005_serviceapikey'),
        ('auth', '0012_alter_user_first_name_max_length'),
    ]

    operations = [
        migrations.RunPython(refuse_if_duplicates, migrations.RunPython.noop),
        migrations.RunSQL(
            sql=f"CREATE UNIQUE INDEX {INDEX} ON auth_user (LOWER(email)) WHERE email <> ''",
            reverse_sql=f'DROP INDEX {INDEX}',
        ),
    ]
