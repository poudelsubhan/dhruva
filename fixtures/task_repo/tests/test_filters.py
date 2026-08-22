"""Group C — the filter language (loglens/query.py)."""

from __future__ import annotations

import loglens
import pytest


def test_compile_query_reads_clauses_and_rejects_unknown_fields():
    query = loglens.compile_query('status>=400 AND path~/api/ AND method="GET"')

    assert [(clause.field, clause.op, clause.value) for clause in query.clauses] == [
        ("status", ">=", "400"),
        ("path", "~", "/api/"),
        ("method", "=", "GET"),
    ]
    assert loglens.compile_query("").clauses == ()

    with pytest.raises(loglens.QueryError):
        loglens.compile_query("referrer=google")

    with pytest.raises(loglens.QueryError):
        loglens.compile_query("status")


def test_apply_query_combines_numeric_and_substring_clauses(make_event):
    events = [
        make_event(path="/api/orders", status=500),
        make_event(path="/api/orders", status=200),
        make_event(path="/static/app.js", status=503),
        make_event(path="/API/users", status=404),
    ]

    matched = loglens.apply_query(events, loglens.compile_query("status>=400 AND path~/api/"))

    assert [(event.path, event.status) for event in matched] == [
        ("/api/orders", 500),
        ("/API/users", 404),
    ]
    assert len(loglens.apply_query(events, loglens.compile_query(""))) == 4

    with pytest.raises(loglens.QueryError):
        loglens.apply_query(events, loglens.compile_query("method>GET"))
