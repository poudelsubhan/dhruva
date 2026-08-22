"""Shared test helpers.

Everything here is fixed data — no clock reads, no randomness, no I/O — so the
suite is byte-for-byte reproducible.

The suite reaches the library only through the ``loglens`` package namespace, so
every test exercises the public API as a caller would see it.
"""

from __future__ import annotations

from datetime import UTC, datetime

import loglens
import pytest

#: Every timestamp in the suite falls on this date, in UTC.
LOG_DATE = (2026, 8, 22)


def at(clock: str) -> datetime:
    """Return ``'HH:MM:SS'`` on the fixture date as an aware UTC datetime."""
    hour, minute, second = (int(part) for part in clock.split(":"))
    return datetime(*LOG_DATE, hour, minute, second, tzinfo=UTC)


def build_event(
    *,
    ts: str | datetime = "14:00:00",
    session_id: str = "s-1",
    method: str = "GET",
    path: str = "/api/orders",
    status: int = 200,
    duration_ms: float = 10.0,
    bytes_sent: int = 1024,
) -> loglens.LogEvent:
    """Build a LogEvent, overriding only the fields a test cares about."""
    return loglens.LogEvent(
        ts=at(ts) if isinstance(ts, str) else ts,
        session_id=session_id,
        method=method,
        path=path,
        status=status,
        duration_ms=duration_ms,
        bytes_sent=bytes_sent,
    )


@pytest.fixture
def make_event():
    """Expose :func:`build_event` to tests."""
    return build_event
