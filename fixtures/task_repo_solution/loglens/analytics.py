"""Aggregate analytics: latency, throughput, and session reconstruction.

Everything here operates on an already-parsed sequence of
:class:`~loglens.models.LogEvent` records; nothing in this module reads text.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import UTC, timedelta
from itertools import pairwise

from .models import LogEvent, SessionSummary


def latency_percentile(events: Sequence[LogEvent], pct: float) -> float:
    """Linear-interpolated percentile of ``duration_ms``.

    Sort the durations ascending. With ``n`` samples the fractional rank is::

        rank = pct / 100 * (n - 1)

    The result interpolates linearly between the samples at ``floor(rank)`` and
    ``ceil(rank)``. ``pct=0`` therefore returns the minimum and ``pct=100`` the
    maximum.

    Raises:
        ValueError: if ``events`` is empty or ``pct`` falls outside ``[0, 100]``.
    """
    if not 0.0 <= pct <= 100.0:
        raise ValueError(f"pct must lie in [0, 100], got {pct!r}")

    samples = sorted(event.duration_ms for event in events)
    if not samples:
        raise ValueError("latency_percentile() needs at least one event")

    rank = pct / 100.0 * (len(samples) - 1)
    low = math.floor(rank)
    high = math.ceil(rank)
    if low == high:
        return float(samples[low])
    return float(samples[low] + (samples[high] - samples[low]) * (rank - low))


def throughput_by_minute(events: Sequence[LogEvent]) -> dict[str, int]:
    """Count events per UTC minute, filling quiet minutes with zero.

    Keys are UTC minute buckets formatted ``'YYYY-MM-DDTHH:MMZ'``. The result
    spans every minute from the earliest to the latest event inclusive, so
    minutes with no traffic appear with a count of ``0``. Keys are inserted in
    ascending chronological order.

    An empty ``events`` sequence returns an empty dict.
    """
    minutes = sorted(event.ts.astimezone(UTC).replace(second=0, microsecond=0) for event in events)
    if not minutes:
        return {}

    counts: dict[str, int] = {}
    cursor = minutes[0]
    last = minutes[-1]
    while cursor <= last:
        counts[cursor.strftime("%Y-%m-%dT%H:%MZ")] = 0
        cursor += timedelta(minutes=1)

    for minute in minutes:
        counts[minute.strftime("%Y-%m-%dT%H:%MZ")] += 1

    return counts


def split_on_idle(events: Sequence[LogEvent], idle_gap_s: float) -> list[list[LogEvent]]:
    """Split one session's events into sub-sessions wherever the user went idle.

    Events are sorted by ``ts`` (ties broken by ``path``) first, so the caller
    need not pre-sort. A new sub-session begins whenever the gap from the
    previous event is *strictly greater* than ``idle_gap_s`` — a gap of exactly
    ``idle_gap_s`` keeps the events together.

    Returns a list of non-empty lists in chronological order; an empty input
    returns ``[]``.

    Raises:
        ValueError: if ``idle_gap_s`` is negative.
    """
    if idle_gap_s < 0:
        raise ValueError(f"idle_gap_s must not be negative, got {idle_gap_s!r}")

    ordered = sorted(events, key=lambda event: (event.ts, event.path))
    if not ordered:
        return []

    groups: list[list[LogEvent]] = [[ordered[0]]]
    for previous, current in pairwise(ordered):
        if (current.ts - previous.ts).total_seconds() > idle_gap_s:
            groups.append([current])
        else:
            groups[-1].append(current)
    return groups


def summarize_sessions(events: Sequence[LogEvent]) -> list[SessionSummary]:
    """Build one :class:`SessionSummary` per distinct ``session_id``.

    Each summary carries:

    ``started_at`` / ``ended_at``
        The earliest and latest ``ts`` seen for that session.
    ``duration_s``
        ``ended_at - started_at`` in seconds, as a float.
    ``request_count``
        How many events the session contains.
    ``error_count``
        How many of them have ``status >= 400``.
    ``distinct_paths``
        How many distinct ``path`` values the session touched.

    Summaries are sorted by ``started_at``, then ``session_id``.
    """
    buckets: dict[str, list[LogEvent]] = {}
    for event in events:
        buckets.setdefault(event.session_id, []).append(event)

    summaries: list[SessionSummary] = []
    for session_id, session_events in buckets.items():
        stamps = [event.ts for event in session_events]
        started_at = min(stamps)
        ended_at = max(stamps)
        summaries.append(
            SessionSummary(
                session_id=session_id,
                started_at=started_at,
                ended_at=ended_at,
                duration_s=(ended_at - started_at).total_seconds(),
                request_count=len(session_events),
                error_count=sum(1 for event in session_events if event.status >= 400),
                distinct_paths=len({event.path for event in session_events}),
            )
        )

    summaries.sort(key=lambda summary: (summary.started_at, summary.session_id))
    return summaries
