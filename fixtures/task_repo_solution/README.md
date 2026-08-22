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
| `loglens/parser.py` | logfmt tokenising and line → `LogEvent` coercion |
| `loglens/ingest.py` | batch reads over many lines; deduplication and ordering |
| `loglens/metrics.py` | latency percentiles, per-minute throughput |
| `loglens/sessions.py` | idle-gap session splitting, per-session summaries |
| `loglens/filters.py` | the `status>=400 AND path~/api/` filter language |
| `loglens/report.py` | fixed-width text tables and the query report |

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
The submodule layout underneath is part of the contract too, since `__init__.py`
names it.

## Tests

```
pytest -q
```
