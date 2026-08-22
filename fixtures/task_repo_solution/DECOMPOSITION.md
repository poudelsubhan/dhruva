# Decomposition (orchestration guidance)

A note for whoever assigns the work. A single worker should ignore this file
and simply do all three groups.

The twelve stubs partition into three groups of four. Each group owns exactly
one source module, so three workers can take one group each and run
concurrently without ever writing to the same file.

| Group | Theme | Source module (exclusive) | Test files | Stubs |
| --- | --- | --- | --- | --- |
| **A** | Ingest | `loglens/ingest.py` | `tests/test_parser.py`, `tests/test_ingest.py` | `tokenize_fields`, `parse_line`, `read_events`, `dedupe_events` |
| **B** | Analytics | `loglens/analytics.py` | `tests/test_metrics.py`, `tests/test_sessions.py` | `latency_percentile`, `throughput_by_minute`, `split_on_idle`, `summarize_sessions` |
| **C** | Query & reporting | `loglens/query.py` | `tests/test_filters.py`, `tests/test_report.py` | `compile_query`, `apply_query`, `format_table`, `render_query_report` |

Properties that make the split safe:

- **Disjoint writes.** One module per group, and no module appears in two rows.
  `loglens/models.py` and `loglens/__init__.py` are shared but complete —
  nobody writes to them.
- **Disjoint failures.** Each group's four tests exercise only that group's
  module. Group B and Group C tests build `LogEvent` objects directly through
  the `make_event` helper rather than parsing text, so they pass without Group
  A's parser existing. A group can reach 4/4 on its own.
- **Order within a group.** Dependencies exist inside a group and only inside a
  group: `parse_line` builds on `tokenize_fields`, `read_events` on
  `parse_line`, and `render_query_report` on `format_table`, `compile_query`
  and `apply_query`. Work bottom-up. Group B's four stubs are mutually
  independent.
