"""Group A — batch ingestion (loglens/ingest.py)."""

from __future__ import annotations

import loglens
import pytest

RAW_LINES = [
    "# access log 2026-08-22",
    "",
    "ts=2026-08-22T14:00:00Z session=s-1 method=GET path=/a status=200 dur_ms=10 bytes=100",
    "this line is not logfmt",
    "ts=2026-08-22T14:00:05Z session=s-1 method=GET path=/b status=500 dur_ms=20 bytes=200",
]


def test_read_events_skips_comments_and_records_errors():
    result = loglens.read_events(RAW_LINES)

    assert [event.path for event in result.events] == ["/a", "/b"]
    assert result.skipped == 2
    assert [lineno for lineno, _ in result.errors] == [4]

    with pytest.raises(loglens.LogParseError):
        loglens.read_events(RAW_LINES, strict=True)


def test_dedupe_events_keeps_first_occurrence_and_sorts_by_time(make_event):
    later = make_event(session_id="s-2", ts="14:00:10", path="/a", status=200)
    earlier = make_event(session_id="s-1", ts="14:00:00", path="/b", status=200)
    duplicate_of_later = make_event(session_id="s-2", ts="14:00:10", path="/a", status=500)
    same_instant = make_event(session_id="s-1", ts="14:00:10", path="/c", status=200)

    result = loglens.dedupe_events([later, earlier, duplicate_of_later, same_instant])

    assert [(event.session_id, event.path) for event in result] == [
        ("s-1", "/b"),
        ("s-1", "/c"),
        ("s-2", "/a"),
    ]
    assert result[2].status == 200
