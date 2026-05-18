from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from tasks.models import WeeklySummary
from tasks.services import calculate_user_weekly_summary


class Command(BaseCommand):
    help = 'Generate weekly summaries for all users based on past activity'

    def add_arguments(self, parser):
        parser.add_argument(
            '--weeks',
            type=int,
            default=8,
            help='Number of weeks to generate summaries for (default: 8)',
        )
        parser.add_argument(
            '--user-id',
            type=int,
            help='Generate summaries for a specific user ID only',
        )

    def handle(self, *args, **options):
        weeks_back = options['weeks']
        user_id = options.get('user_id')

        # Get users
        if user_id:
            users = User.objects.filter(id=user_id)
            if not users.exists():
                raise CommandError(f'User with id {user_id} not found')
        else:
            users = User.objects.filter(is_active=True)

        self.stdout.write(
            self.style.SUCCESS(f'Generating summaries for {users.count()} user(s)...')
        )

        # Calculate the most recent completed week.
        # If today is Monday, the current week is still in progress and should
        # not be generated yet, so start from the previous Monday instead.
        today = timezone.now().date()
        days_since_monday = today.weekday()  # Monday is 0
        current_week_monday = today - timedelta(days=days_since_monday)
        most_recent_completed_week_monday = current_week_monday - timedelta(weeks=1)

        summaries_created = 0
        summaries_updated = 0
        errors = 0

        for user in users:
            user_status = f'\n📊 Processing user: {user.username} (id={user.id})'
            self.stdout.write(self.style.WARNING(user_status))

            # Generate summaries for the past N completed weeks
            for week_offset in range(weeks_back):
                week_start = most_recent_completed_week_monday - timedelta(weeks=week_offset)
                week_end = week_start + timedelta(days=6)  # Sunday

                try:
                    # Calculate the summary
                    summary_data = calculate_user_weekly_summary(user, week_start, week_end)

                    # Store or update in database
                    summary, created = WeeklySummary.objects.update_or_create(
                        user=user,
                        week_start_date=week_start,
                        defaults={
                            'week_end_date': week_end,
                            'summary_data': summary_data,
                        }
                    )

                    status = '✅ Created' if created else '🔄 Updated'
                    week_label = f"{week_start.strftime('%b %d')} - {week_end.strftime('%b %d, %Y')}"
                    self.stdout.write(
                        f'  {status}: Week of {week_label}'
                    )

                    if created:
                        summaries_created += 1
                    else:
                        summaries_updated += 1

                except Exception as e:
                    week_label = f"{week_start.strftime('%b %d')} - {week_end.strftime('%b %d, %Y')}"
                    self.stdout.write(
                        self.style.ERROR(f'  ❌ Error for week of {week_label}: {str(e)}')
                    )
                    errors += 1

        # Summary output
        self.stdout.write('\n' + '='*60)
        self.stdout.write(self.style.SUCCESS('✨ Summary Generation Complete'))
        self.stdout.write('='*60)
        self.stdout.write(f'📝 Summaries Created: {summaries_created}')
        self.stdout.write(f'🔄 Summaries Updated: {summaries_updated}')
        if errors:
            self.stdout.write(self.style.ERROR(f'❌ Errors: {errors}'))
        self.stdout.write('='*60)
