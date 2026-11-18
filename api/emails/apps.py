from django.apps import AppConfig


class EmailsConfig(AppConfig):
    name = 'emails'
    verbose_name = 'Email Notifications'

    def ready(self):
        """Import signals when app is ready."""
        import emails.signals  # noqa
