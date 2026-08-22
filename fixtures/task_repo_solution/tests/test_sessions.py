"""Group B — session reconstruction (loglens/sessions.py)."""

from __future__ import annotations

import loglens


def test_split_on_idle_starts_a_new_subsession_after_the_gap(make_event):
    events = [
        make_event(ts="14:00:00", path="/a"),
        make_event(ts="14:00:30", path="/b"),
        make_event(ts="14:01:05", path="/c"),
        make_event(ts="14:01:20", path="/d"),
    ]

    groups = loglens.split_on_idle(events, idle_gap_s=30.0)

    assert [[event.path for event in group] for group in groups] == [
        ["/a", "/b"],
        ["/c", "/d"],
    ]
    assert loglens.split_on_idle([], idle_gap_s=30.0) == []


def test_summarize_sessions_counts_errors_and_distinct_paths(make_event):
    events = [
        make_event(session_id="s-2", ts="14:00:00", path="/a", status=200),
        make_event(session_id="s-1", ts="14:00:05", path="/a", status=500),
        make_event(session_id="s-1", ts="14:00:35", path="/b", status=404),
        make_event(session_id="s-1", ts="14:00:20", path="/a", status=200),
    ]

    summaries = loglens.summarize_sessions(events)

    assert [summary.session_id for summary in summaries] == ["s-2", "s-1"]

    first_session = summaries[1]
    assert first_session.request_count == 3
    assert first_session.error_count == 2
    assert first_session.distinct_paths == 2
    assert first_session.duration_s == 30.0
