"""Business opening hours.

THE FILE TO EDIT when the hours change.

A config module rather than a settings table, on purpose: these change once a
year, they are the same for everyone, and a table would mean a screen to edit
it, a migration and a cache. When per-branch hours or holiday closures are
needed, that is the point at which this earns a table.

The timezone comes from settings.business_timezone, so the dashboard and the
agent cannot disagree about what "local time" means for this workspace.

Informational only. Nothing is blocked outside these hours.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time
from zoneinfo import ZoneInfo

from app.core.config import settings


def _timezone() -> ZoneInfo:
    return ZoneInfo(settings.business_timezone)


# Monday = 0 ... Sunday = 6, matching datetime.weekday().
# None means closed all day.
SCHEDULE: dict[int, tuple[time, time] | None] = {
    0: (time(9, 0), time(21, 0)),   # Monday
    1: (time(9, 0), time(21, 0)),   # Tuesday
    2: (time(9, 0), time(21, 0)),   # Wednesday
    3: (time(9, 0), time(21, 0)),   # Thursday
    4: (time(14, 0), time(21, 0)),  # Friday — afternoon only
    5: (time(10, 0), time(18, 0)),  # Saturday
    6: (time(9, 0), time(21, 0)),   # Sunday — a working day for this workspace
}

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                 "Saturday", "Sunday"]


@dataclass
class BusinessHoursStatus:
    is_open: bool
    timezone: str
    local_time: str
    weekday: str
    #: Today's window as "09:00-21:00", or None when closed all day.
    today_hours: str | None
    #: When the business next opens, if it is currently closed.
    next_open: str | None


def _format(window: tuple[time, time] | None) -> str | None:
    if window is None:
        return None
    opens, closes = window
    return f"{opens.strftime('%H:%M')}-{closes.strftime('%H:%M')}"


def is_open(now: datetime | None = None) -> bool:
    """Whether the business is open at `now` (default: now, in business time)."""
    tz = _timezone()
    moment = (now or datetime.now(tz)).astimezone(tz)
    window = SCHEDULE.get(moment.weekday())
    if window is None:
        return False
    opens, closes = window
    return opens <= moment.time() < closes


def status(now: datetime | None = None) -> BusinessHoursStatus:
    """Everything the dashboard indicator needs, in one call."""
    tz = _timezone()
    moment = (now or datetime.now(tz)).astimezone(tz)
    open_now = is_open(moment)

    next_open: str | None = None
    if not open_now:
        # Look ahead a week. Today still counts if it has not opened yet.
        for offset in range(8):
            day = (moment.weekday() + offset) % 7
            window = SCHEDULE.get(day)
            if window is None:
                continue
            if offset == 0 and moment.time() >= window[0]:
                continue  # already closed for today
            label = "today" if offset == 0 else (
                "tomorrow" if offset == 1 else WEEKDAY_NAMES[day]
            )
            next_open = f"{label} at {window[0].strftime('%H:%M')}"
            break

    return BusinessHoursStatus(
        is_open=open_now,
        timezone=str(tz),
        local_time=moment.strftime("%H:%M"),
        weekday=WEEKDAY_NAMES[moment.weekday()],
        today_hours=_format(SCHEDULE.get(moment.weekday())),
        next_open=next_open,
    )
