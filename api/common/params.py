"""Parse request parameters, turning bad input into a 400 instead of a crash."""

from __future__ import annotations

import uuid
from datetime import date, datetime

from rest_framework.exceptions import ValidationError


def _clean(source, name):
    value = source.get(name)
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def uuid_param(source, name: str) -> uuid.UUID | None:
    """A UUID from query parameters or a request body, or None when absent."""
    value = _clean(source, name)
    if value is None:
        return None
    try:
        return uuid.UUID(value)
    except ValueError:
        raise ValidationError({name: 'Must be a valid UUID.'})


def int_param(
    source,
    name: str,
    *,
    default: int | None = None,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int | None:
    """An integer, or `default` when absent. Out-of-range values are clamped."""
    value = _clean(source, name)
    if value is None:
        return default
    try:
        number = int(value)
    except ValueError:
        raise ValidationError({name: 'Must be a whole number.'})
    if minimum is not None:
        number = max(number, minimum)
    if maximum is not None:
        number = min(number, maximum)
    return number


def date_param(source, name: str, *, fmt: str = '%Y-%m-%d', label: str = 'YYYY-MM-DD') -> date | None:
    """A date in the given format, or None when absent."""
    value = _clean(source, name)
    if value is None:
        return None
    try:
        return datetime.strptime(value, fmt).date()
    except ValueError:
        raise ValidationError({name: f'Must be a date in {label} format.'})


def bool_param(params, name, default=False):
    """Read a true/false query parameter."""
    value = params.get(name)
    if value is None or value == '':
        return default
    lowered = str(value).strip().lower()
    if lowered in ('true', '1', 'yes'):
        return True
    if lowered in ('false', '0', 'no'):
        return False
    raise ValidationError({name: 'Enter true or false.'})


def datetime_param(source, name: str) -> datetime | None:
    """A date and time (ISO 8601), or None when absent. A bare date means the
    start of that day; a value without a zone is read in the server's zone."""
    from django.utils import timezone
    from django.utils.dateparse import parse_date, parse_datetime

    value = _clean(source, name)
    if value is None:
        return None
    try:
        parsed = parse_datetime(value)
        if parsed is None:
            day = parse_date(value)
            parsed = datetime(day.year, day.month, day.day) if day else None
    except ValueError:
        parsed = None
    if parsed is None:
        raise ValidationError({name: 'Must be a date and time in ISO 8601 format.'})
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed)
    return parsed


def uuid_value(value: str) -> uuid.UUID:
    return uuid.UUID(value)


def list_param(source, name: str, cast=str) -> list:
    """A comma-separated list (`?status=open,closed`), each item converted with
    `cast`. Empty when absent."""
    value = _clean(source, name)
    if value is None:
        return []
    items = []
    for raw in value.split(','):
        raw = raw.strip()
        if not raw:
            continue
        try:
            items.append(cast(raw))
        except (ValueError, TypeError):
            raise ValidationError({name: f'"{raw}" is not a valid value.'})
    return items


def choice_param(source, name: str, choices, *, default=None):
    """One of a fixed set of values, or `default` when absent."""
    value = _clean(source, name)
    if value is None:
        return default
    if value not in choices:
        raise ValidationError({name: f'Must be one of: {", ".join(sorted(choices))}.'})
    return value
