from django.apps import AppConfig


class EmailsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'emails'
    verbose_name = 'Email Notifications'

    def ready(self):
        """Import signals when app is ready."""
        import emails.signals  # noqa
