"""loglens — parse, aggregate and report on HTTP access logs.

The names re-exported below are the library's **public API**. Downstream
services import them from ``loglens`` directly::

    from loglens import parse_line, read_events, summarize_sessions

That surface is stable: names in ``__all__`` keep their spelling, their
signatures and their semantics across 0.x releases. The test suite reaches the
library only through this namespace — ``import loglens`` then ``loglens.foo(...)``
— so it is the public API, not the internal layout, that the tests pin down.
"""

from __future__ import annotations

from loglens.analytics import (
    latency_percentile,
    split_on_idle,
    summarize_sessions,
    throughput_by_minute,
)
from loglens.ingest import dedupe_events, parse_line, read_events, tokenize_fields
from loglens.models import (
    Clause,
    IngestResult,
    LogEvent,
    LogParseError,
    Query,
    QueryError,
    SessionSummary,
)
from loglens.query import (
    NUMERIC_FIELDS,
    OPERATORS,
    QUERY_FIELDS,
    STRING_FIELDS,
    apply_query,
    compile_query,
    format_table,
    render_query_report,
)

__version__ = "0.4.2"

__all__ = [
    "NUMERIC_FIELDS",
    "OPERATORS",
    "QUERY_FIELDS",
    "STRING_FIELDS",
    "Clause",
    "IngestResult",
    "LogEvent",
    "LogParseError",
    "Query",
    "QueryError",
    "SessionSummary",
    "__version__",
    "apply_query",
    "compile_query",
    "dedupe_events",
    "format_table",
    "latency_percentile",
    "parse_line",
    "read_events",
    "render_query_report",
    "split_on_idle",
    "summarize_sessions",
    "throughput_by_minute",
    "tokenize_fields",
]
