from datetime import timedelta

from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from tasks.models import WeeklySummary


class Command(BaseCommand):
    help = 'Delete weekly summaries for a specific week or the current in-progress week'

    def add_arguments(self, parser):
        parser.add_argument(
            '--week-start-date',
            type=str,
            help='Delete summaries for the week starting on this YYYY-MM-DD date',
        )
        parser.add_argument(
            '--user-id',
            type=int,
            help='Delete summaries for a specific user ID only',
        )

    def handle(self, *args, **options):
        week_start_date = options.get('week_start_date')
        user_id = options.get('user_id')

        if week_start_date:
            try:
                week_start = timezone.datetime.strptime(week_start_date, '%Y-%m-%d').date()
            except ValueError as exc:
                raise CommandError('week-start-date must be in YYYY-MM-DD format') from exc
        else:
            today = timezone.now().date()
            days_since_monday = today.weekday()
            week_start = today - timedelta(days=days_since_monday)

        queryset = WeeklySummary.objects.filter(week_start_date=week_start)

        if user_id:
            if not User.objects.filter(id=user_id).exists():
                raise CommandError(f'User with id {user_id} not found')
            queryset = queryset.filter(user_id=user_id)

        deleted_count = queryset.count()
        queryset.delete()

        self.stdout.write(
            self.style.SUCCESS(
                f'Deleted {deleted_count} weekly summary(s) for week starting {week_start.isoformat()}'
            )
        )