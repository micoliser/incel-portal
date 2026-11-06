from django.core.management.base import BaseCommand
from accounts.models import ServiceApiKey


class Command(BaseCommand):
    help = "Generate a new Service API Key for external application access."

    def add_arguments(self, parser):
        parser.add_argument(
            '--name',
            type=str,
            required=True,
            help='Descriptive name of the external application or service.',
        )

    def handle(self, *args, **options):
        name = options['name'].strip()
        if not name:
            self.stderr.write(self.style.ERROR("Name cannot be empty."))
            return

        instance, raw_key = ServiceApiKey.generate_key(name=name)

        self.stdout.write(self.style.SUCCESS(f"Successfully generated Service API Key for: '{name}'"))
        self.stdout.write(f"Key ID: {instance.id}")
        self.stdout.write(f"Prefix: {instance.prefix}")
        self.stdout.write(self.style.WARNING("=" * 60))
        self.stdout.write(self.style.SUCCESS(f"BEARER TOKEN: {raw_key}"))
        self.stdout.write(self.style.WARNING("=" * 60))
        self.stdout.write(self.style.NOTICE("Store this key securely. You will not be able to see it again!"))

