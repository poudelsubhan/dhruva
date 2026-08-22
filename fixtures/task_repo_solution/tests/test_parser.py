"""Group A — logfmt line parsing (loglens/parser.py)."""

from __future__ import annotations

from datetime import UTC, datetime

import loglens
import pytest


def test_parse_fields_handles_quoted_values_and_escapes():
    line = r'ts=2026-08-22T14:03:11Z path="/api/orders?q=a b" note="say \"hi\"" status=200'

    assert loglens.parse_fields(line) == {
        "ts": "2026-08-22T14:03:11Z",
        "path": "/api/orders?q=a b",
        "note": 'say "hi"',
        "status": "200",
    }

    with pytest.raises(loglens.LogParseError):
        loglens.parse_fields('ts=2026-08-22T14:03:11Z path="/never-closed')

    with pytest.raises(loglens.LogParseError):
        loglens.parse_fields("this line is not logfmt")


def test_parse_line_normalizes_method_path_and_timestamp():
    line = (
        "ts=2026-08-22T14:03:11+02:00 session=s-8f21 method=get "
        'path="/api/orders?page=2" status=200 dur_ms=143.5 bytes=2048 region=eu-west-1'
    )

    event = loglens.parse_line(line)

    assert event.ts == datetime(2026, 8, 22, 12, 3, 11, tzinfo=UTC)
    assert event.session_id == "s-8f21"
    assert event.method == "GET"
    assert event.path == "/api/orders"
    assert event.status == 200
    assert event.duration_ms == 143.5
    assert event.bytes_sent == 2048

    with pytest.raises(loglens.LogParseError, match="dur_ms"):
        loglens.parse_line(
            "ts=2026-08-22T14:03:11Z session=s-1 method=GET path=/a status=200 dur_ms=fast bytes=10"
        )

    with pytest.raises(loglens.LogParseError, match="bytes"):
        loglens.parse_line(
            "ts=2026-08-22T14:03:11Z session=s-1 method=GET path=/a status=200 dur_ms=1.0"
        )
