"""Group C — text reporting (loglens/query.py)."""

from __future__ import annotations

import loglens
import pytest


def test_format_table_pads_columns_and_right_aligns_numbers():
    table = loglens.format_table(
        ["path", "hits", "p95_ms"],
        [["/api/orders", "12", "143.5"], ["/health", "4", "2.0"]],
    )

    assert table == (
        "path         hits  p95_ms\n"
        "-----------  ----  ------\n"
        "/api/orders    12   143.5\n"
        "/health         4     2.0"
    )

    with pytest.raises(ValueError):
        loglens.format_table(["path", "hits"], [["/api/orders"]])


def test_render_query_report_lists_newest_first_with_a_footer(make_event):
    events = [
        make_event(ts="14:00:00", method="GET", path="/api/orders", status=500, duration_ms=143.5),
        make_event(ts="14:00:20", method="POST", path="/api/orders", status=503, duration_ms=12.0),
        make_event(ts="14:00:10", method="GET", path="/health", status=200, duration_ms=1.25),
    ]

    report = loglens.render_query_report(events, "status>=500")

    assert report == (
        "ts        method  path         status  dur_ms\n"
        "--------  ------  -----------  ------  ------\n"
        "14:00:20  POST    /api/orders     503    12.0\n"
        "14:00:00  GET     /api/orders     500   143.5\n"
        "\n"
        '2 of 3 events matched "status>=500"'
    )

    truncated = loglens.render_query_report(events, "status>=500", limit=1)
    assert truncated.splitlines()[2] == "14:00:20  POST    /api/orders     503    12.0"
    assert truncated.splitlines()[-1] == '2 of 3 events matched "status>=500"'
