"""Aggregate latency and throughput metrics over a set of events."""

from __future__ import annotations

import math
from collections.abc import Sequence
from datetime import UTC, timedelta

from .models import LogEvent


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
