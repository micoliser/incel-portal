from datetime import date

from django.urls import register_converter


class IsoDateConverter:
    """A calendar date in the path, as YYYY-MM-DD. Anything else does not match (404)."""

    regex = r'\d{4}-\d{2}-\d{2}'

    def to_python(self, value):
        return date.fromisoformat(value)

    def to_url(self, value):
        return value.isoformat() if isinstance(value, date) else str(value)


register_converter(IsoDateConverter, 'isodate')
