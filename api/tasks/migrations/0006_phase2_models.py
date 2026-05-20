# Generated migration for Phase 2 features

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import uuid


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('tasks', '0005_weeklysummary_weeklysummaryshare_and_more'),
    ]

    operations = [
        # Update WeeklySummary model to add phase 2 fields
        migrations.AddField(
            model_name='weeklysummary',
            name='previous_week_summary',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='next_week', to='tasks.weeklysummary'),
        ),
        migrations.AddField(
            model_name='weeklysummary',
            name='comparison_metrics',
            field=models.JSONField(default=dict, help_text='Week-over-week changes: delta_tasks, delta_completion_rate, etc.'),
        ),
        # Create WeeklySummaryUserShare model
        migrations.CreateModel(
            name='WeeklySummaryUserShare',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('shared_by', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='summaries_shared_by_me', to=settings.AUTH_USER_MODEL)),
                ('shared_with', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='summaries_shared_with_me', to=settings.AUTH_USER_MODEL)),
                ('summary', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='user_shares', to='tasks.weeklysummary')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        # Create SummaryExport model
        migrations.CreateModel(
            name='SummaryExport',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('format', models.CharField(choices=[('pdf', 'PDF'), ('csv', 'CSV')], max_length=10)),
                ('file_url', models.CharField(max_length=500)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('exported_by', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='exported_summaries', to=settings.AUTH_USER_MODEL)),
                ('summary', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='exports', to='tasks.weeklysummary')),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        # Create UserGoal model
        migrations.CreateModel(
            name='UserGoal',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('metric', models.CharField(choices=[('completion_rate', 'Completion Rate (%)'), ('tasks_completed', 'Tasks Completed'), ('high_priority_completed', 'High Priority Tasks Completed'), ('on_time_completion_rate', 'On-Time Completion Rate (%)'), ('comments_added', 'Comments Added')], max_length=50)),
                ('target_value', models.FloatField()),
                ('period_start', models.DateField()),
                ('period_end', models.DateField()),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='goals', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        # Create OrganizationSummaryCache model
        migrations.CreateModel(
            name='OrganizationSummaryCache',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('week_start_date', models.DateField()),
                ('week_end_date', models.DateField()),
                ('summary_data', models.JSONField(default=dict)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'ordering': ['-week_start_date'],
            },
        ),
        # Add indexes
        migrations.AddIndex(
            model_name='weeklysummaryusershare',
            index=models.Index(fields=['shared_with', '-created_at'], name='tasks_weekl_shared__idx'),
        ),
        migrations.AddIndex(
            model_name='weeklysummaryusershare',
            index=models.Index(fields=['shared_by', '-created_at'], name='tasks_weekl_shared_3f3b2_idx'),
        ),
        migrations.AddConstraint(
            model_name='weeklysummaryusershare',
            constraint=models.UniqueConstraint(fields=['summary', 'shared_with'], name='unique_summary_shared_with'),
        ),
        migrations.AddIndex(
            model_name='summaryexport',
            index=models.Index(fields=['exported_by', '-created_at'], name='tasks_summa_experor_idx'),
        ),
        migrations.AddIndex(
            model_name='usergoal',
            index=models.Index(fields=['user', 'is_active'], name='tasks_userg_user_id_idx'),
        ),
        migrations.AddIndex(
            model_name='organizationsummarycache',
            index=models.Index(fields=['week_start_date'], name='tasks_organ_week_st_idx'),
        ),
        migrations.AlterUniqueTogether(
            name='organizationsummarycache',
            unique_together={('week_start_date',)},
        ),
    ]
