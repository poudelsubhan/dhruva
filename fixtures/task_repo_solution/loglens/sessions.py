"""Session reconstruction: idle-gap splitting and per-session summaries."""

from __future__ import annotations

from collections.abc import Sequence
from itertools import pairwise

from .models import LogEvent, SessionSummary


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
