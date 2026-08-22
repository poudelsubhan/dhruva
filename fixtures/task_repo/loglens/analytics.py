"""Aggregate analytics: latency, throughput, and session reconstruction.

Everything here operates on an already-parsed sequence of
:class:`~loglens.models.LogEvent` records; nothing in this module reads text.
"""

from __future__ import annotations

from collections.abc import Sequence

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
    # STUB: implement this function. See the docstring above and tests/test_metrics.py.
    raise NotImplementedError("loglens.analytics.latency_percentile is not implemented")


def throughput_by_minute(events: Sequence[LogEvent]) -> dict[str, int]:
    """Count events per UTC minute, filling quiet minutes with zero.

    Keys are UTC minute buckets formatted ``'YYYY-MM-DDTHH:MMZ'``. The result
    spans every minute from the earliest to the latest event inclusive, so
    minutes with no traffic appear with a count of ``0``. Keys are inserted in
    ascending chronological order.

    An empty ``events`` sequence returns an empty dict.
    """
    # STUB: implement this function. See the docstring above and tests/test_metrics.py.
    raise NotImplementedError("loglens.analytics.throughput_by_minute is not implemented")


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
    # STUB: implement this function. See the docstring above and tests/test_sessions.py.
    raise NotImplementedError("loglens.analytics.split_on_idle is not implemented")


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
    # STUB: implement this function. See the docstring above and tests/test_sessions.py.
    raise NotImplementedError("loglens.analytics.summarize_sessions is not implemented")
