"""Recurring schedules: when the next runs are, and their deadlines."""

from __future__ import annotations

from datetime import datetime, timedelta
from datetime import timezone as datetime_timezone
from typing import Iterable
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone

from ..models import (
    RecurringSchedule,
)


def _schedule_timezone(schedule: RecurringSchedule) -> ZoneInfo:
    try:
        return ZoneInfo(schedule.timezone or 'UTC')
    except ZoneInfoNotFoundError:
        return ZoneInfo('UTC')


def _normalize_time_strings(values: Iterable[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()

    for raw_value in values:
        value = str(raw_value).strip()
        if not value:
            continue

        parsed = datetime.strptime(value, '%H:%M').time()
        normalized_value = parsed.strftime('%H:%M')
        if normalized_value in seen:
            continue

        seen.add(normalized_value)
        normalized.append(normalized_value)

    return normalized


def _normalize_weekdays(values: Iterable[int]) -> list[int]:
    normalized: list[int] = []
    seen: set[int] = set()

    for raw_value in values:
        value = int(raw_value)
        if value < 0 or value > 6 or value in seen:
            continue

        seen.add(value)
        normalized.append(value)

    return normalized


def iter_schedule_occurrences(
    schedule: RecurringSchedule,
    *,
    start_after: datetime,
    end_at: datetime,
):
    tz = _schedule_timezone(schedule)
    start_local = start_after.astimezone(tz)
    end_local = end_at.astimezone(tz)
    anchor_date = schedule.start_at.astimezone(tz).date()
    candidate_date = max(anchor_date, start_local.date())
    times = _normalize_time_strings(schedule.times or []) or ['00:00']
    weekdays = _normalize_weekdays(schedule.weekdays or [])

    while candidate_date <= end_local.date():
        days_since_anchor = (candidate_date - anchor_date).days

        if schedule.frequency == 'daily':
            is_weekend = candidate_date.weekday() >= 5
            if not getattr(schedule, 'include_weekends', False) and is_weekend:
                eligible = False
            else:
                eligible = days_since_anchor >= 0 and days_since_anchor % schedule.interval == 0
        else:
            eligible = (
                days_since_anchor >= 0
                and (days_since_anchor // 7) % schedule.interval == 0
                and candidate_date.weekday() in weekdays
            )

        if eligible:
            for time_value in times:
                parsed_time = datetime.strptime(time_value, '%H:%M').time()
                candidate_local = datetime.combine(candidate_date, parsed_time, tzinfo=tz)
                if start_local < candidate_local <= end_local:
                    yield candidate_local.astimezone(datetime_timezone.utc)

        candidate_date = candidate_date + timedelta(days=1)


def get_next_occurrence_after(
    schedule: RecurringSchedule,
    after_dt: datetime,
) -> datetime | None:
    horizon = after_dt + timedelta(days=370)
    for occurrence in iter_schedule_occurrences(
        schedule,
        start_after=after_dt,
        end_at=horizon,
    ):
        return occurrence
    return None


def calculate_next_run_at(
    schedule: RecurringSchedule,
    *,
    reference: datetime | None = None,
) -> datetime | None:
    reference_dt = reference or timezone.now()
    return get_next_occurrence_after(schedule, reference_dt - timedelta(microseconds=1))


def build_deadline_for_occurrence(
    schedule: RecurringSchedule,
    scheduled_for: datetime,
) -> datetime:
    return scheduled_for + timedelta(minutes=schedule.deadline_offset_minutes)
