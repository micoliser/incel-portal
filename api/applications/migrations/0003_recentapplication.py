from django.db import migrations, models
import django.db.models.deletion
from django.conf import settings
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        ('applications', '0002_internalapplication_logo_url'),
    ]

    operations = [
        migrations.CreateModel(
            name='RecentApplication',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('opened_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('application', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='recent_entries', to='applications.internalapplication')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='recent_applications', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-opened_at'],
            },
        ),
        migrations.AddIndex(
            model_name='recentapplication',
            index=models.Index(fields=['user', 'opened_at'], name='applications_recent_user_opened_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='recentapplication',
            unique_together={('user', 'application')},
        ),
    ]
