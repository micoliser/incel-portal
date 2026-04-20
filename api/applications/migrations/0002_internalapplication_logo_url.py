from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('applications', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='internalapplication',
            name='logo_url',
            field=models.URLField(blank=True, max_length=500, null=True),
        ),
    ]