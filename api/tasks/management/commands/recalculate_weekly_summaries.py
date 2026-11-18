"""Recalculate stored weekly summaries for recent finished weeks.

Use after a change to how summaries are calculated, so past weeks use the new
figures and week-over-week comparisons line up. Sends no emails.

    python manage.py recalculate_weekly_summaries --weeks 4
"""

from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from tasks import tasks as task_jobs
from tasks.models import WeeklySummary
from tasks.services import calculate_user_weekly_summary, calculate_weekly_comparison


class Command(BaseCommand):
    help = 'Recalculate weekly summaries and comparisons for the last N finished weeks (no emails).'

    def add_arguments(self, parser):
        parser.add_argument('--weeks', type=int, default=4, help='Finished weeks to recalculate (default 4).')

    def handle(self, *args, **options):
        weeks = options['weeks']
        if weeks < 1 or weeks > 52:
            raise CommandError('--weeks must be between 1 and 52.')

        today = timezone.localdate()
        last_finished_monday = today - timedelta(days=today.weekday() + 7)
        # Oldest first, so each week's comparison uses the already recalculated week before it.
        week_starts = [last_finished_monday - timedelta(weeks=n) for n in reversed(range(weeks))]
        users = list(User.objects.filter(is_active=True))

        for week_start in week_starts:
            week_end = week_start + timedelta(days=6)
            updated = errors = 0
            for user in users:
                try:
                    data = calculate_user_weekly_summary(user, week_start, week_end)
                    previous = WeeklySummary.objects.filter(
                        user=user, week_start_date=week_start - timedelta(days=7),
                    ).first()
                    WeeklySummary.objects.update_or_create(
                        user=user,
                        week_start_date=week_start,
                        defaults={
                            'week_end_date': week_end,
                            'summary_data': data,
                            'previous_week_summary': previous,
                            'comparison_metrics': calculate_weekly_comparison(
                                data, previous.summary_data if previous else None,
                            ),
                        },
                    )
                    updated += 1
                except Exception as exc:  # one bad user must not stop the rest
                    errors += 1
                    self.stderr.write(f'  {user.username}, week of {week_start}: {exc}')
            self.stdout.write(f'Week of {week_start}: {updated} summaries recalculated, {errors} errors.')

        result = task_jobs.cache_organization_summaries()
        self.stdout.write(f"Organization summaries refreshed: {result['cached']} weeks.")
        self.stdout.write(self.style.SUCCESS('Done. No emails were sent.'))
