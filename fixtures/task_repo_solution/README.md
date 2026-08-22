# loglens

A small, dependency-free toolkit for parsing and summarising HTTP access logs.

`loglens` reads the logfmt lines our edge proxy writes, turns them into typed
`LogEvent` records, and answers the questions an on-call engineer actually asks:
what is the p95 latency, when did traffic drop, which sessions errored, and
which requests match some ad-hoc filter.

## Log format

One `key=value` token per field, space separated. Values containing spaces are
double-quoted; `\"` and `\\` are the recognised escapes.

```
ts=2026-08-22T14:03:11Z session=s-8f21 method=GET path="/api/orders?page=2" status=200 dur_ms=143.5 bytes=2048
```

`sample.log` holds a short excerpt.

## Layout

| Module | Responsibility |
| --- | --- |
| `loglens/models.py` | `LogEvent`, `IngestResult`, `SessionSummary`, `Query`, `Clause`, error types |
| `loglens/ingest.py` | logfmt tokenising, line → `LogEvent` coercion, batch reads, deduplication |
| `loglens/analytics.py` | latency percentiles, per-minute throughput, idle-gap session splitting, per-session summaries |
| `loglens/query.py` | the `status>=400 AND path~/api/` filter language, fixed-width text tables, the query report |

## Usage

```python
from loglens import read_events, latency_percentile, render_query_report

with open("sample.log") as handle:
    result = read_events(handle)

print(latency_percentile(result.events, 95))
print(render_query_report(result.events, "status>=500", limit=10))
```

## Public API

Everything re-exported from `loglens/__init__.py` and listed in its `__all__` is
public and stable across 0.x. Callers — and the test suite — reach the library
only through that namespace: `import loglens`, then `loglens.parse_line(...)`.
The module layout underneath is private and may be rearranged, as long as every
name in `__all__` keeps its spelling, signature and semantics.

## Tests

The suite lives under `tests/`. Run it with the `run_tests` tool; it reports the
outcome of each test by name.
