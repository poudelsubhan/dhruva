"""Group B — latency and throughput metrics (loglens/analytics.py)."""

from __future__ import annotations

import loglens
import pytest


def test_latency_percentile_interpolates_between_samples(make_event):
    events = [make_event(duration_ms=value) for value in (30.0, 10.0, 40.0, 20.0)]

    assert loglens.latency_percentile(events, 0) == 10.0
    assert loglens.latency_percentile(events, 25) == 17.5
    assert loglens.latency_percentile(events, 50) == 25.0
    assert loglens.latency_percentile(events, 100) == 40.0

    with pytest.raises(ValueError):
        loglens.latency_percentile([], 50)

    with pytest.raises(ValueError):
        loglens.latency_percentile(events, 101)


def test_throughput_by_minute_fills_quiet_minutes_with_zero(make_event):
    events = [
        make_event(ts="14:00:10"),
        make_event(ts="14:00:59"),
        make_event(ts="14:03:00"),
    ]

    assert loglens.throughput_by_minute(events) == {
        "2026-08-22T14:00Z": 2,
        "2026-08-22T14:01Z": 0,
        "2026-08-22T14:02Z": 0,
        "2026-08-22T14:03Z": 1,
    }
    assert list(loglens.throughput_by_minute(events)) == [
        "2026-08-22T14:00Z",
        "2026-08-22T14:01Z",
        "2026-08-22T14:02Z",
        "2026-08-22T14:03Z",
    ]
    assert loglens.throughput_by_minute([]) == {}
