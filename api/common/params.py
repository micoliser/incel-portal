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
