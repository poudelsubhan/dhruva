# Task — finish `loglens`

`loglens` is a small access-log toolkit. Twelve of its functions are stubs: each
one has a complete docstring describing its contract and a body that raises
`NotImplementedError`. Every stub is marked with a `# STUB:` comment, so
searching the sources under `loglens/` for that marker lists all twelve.

The test suite is written and currently fails 12 of 12.

## Objective

Implement the marked functions so the full suite passes.

## Constraints

1. **Do not modify any test file.** Nothing under `tests/` may change — not the
   test modules, not `conftest.py`. The tests define what correct means; a
   change there is not a fix.
2. **Preserve the existing public API.** The names exported from
   `loglens/__init__.py` and listed in its `__all__`, the module paths they live
   in, and their signatures stay exactly as they are. Do not rename, move,
   remove, or re-sign a public function; do not restructure the package.
3. **The repo must stay importable after every write.** `import loglens` must
   succeed at all times, including between edits. Stubs signal absence by
   raising at call time, never at import time — keep it that way.
4. Standard library only. No new dependencies, no network, no file or clock
   access from library code.

## Done criteria

- A test run reports 12 passed, 0 failed.
- `import loglens` still succeeds.
- The only files that changed are under `loglens/`, and only inside the twelve
  stub bodies plus whatever private helpers you add.

## Running things

Run the suite with the `run_tests` tool; it reports how many of the twelve
tests pass, and which ones failed. A run that reports no tests at all means the
suite could not be collected — that happens only when `import loglens` is
broken, so fix that before anything else.

`sample.log` is a short excerpt of the real log format, useful for sanity
checks. It is not used by the tests.

## Notes

- `loglens/models.py` and `loglens/__init__.py` are complete. You should not
  need to edit either.
- Read the docstring before implementing. Each one fully specifies the contract,
  including tie-breaks, boundary conditions, and which errors to raise. The
  tests check those edges, so guessing costs more than reading.
- Determinism matters: any ordering a function returns must be total. Where a
  docstring names a tie-break, implement it exactly.

---

## Decomposition (orchestration guidance)

The twelve stubs partition into three groups of four. The groups touch disjoint
sets of source modules, so three workers can take one group each and run
concurrently without ever writing to the same file. This section is a note for
whoever is assigning the work; a single worker should simply do all three.

| Group | Theme | Source modules (exclusive) | Test files | Stubs |
| --- | --- | --- | --- | --- |
| **A** | Ingest | `loglens/parser.py`, `loglens/ingest.py` | `tests/test_parser.py`, `tests/test_ingest.py` | `parse_fields`, `parse_line`, `read_events`, `dedupe_events` |
| **B** | Analytics | `loglens/metrics.py`, `loglens/sessions.py` | `tests/test_metrics.py`, `tests/test_sessions.py` | `latency_percentile`, `throughput_by_minute`, `split_on_idle`, `summarize_sessions` |
| **C** | Query & reporting | `loglens/filters.py`, `loglens/report.py` | `tests/test_filters.py`, `tests/test_report.py` | `parse_query`, `apply_query`, `format_table`, `render_query_report` |

Properties that make the split safe:

- **Disjoint writes.** No module appears in two rows. `loglens/models.py` and
  `loglens/__init__.py` are shared but complete — nobody writes to them.
- **Disjoint failures.** Each group's four tests exercise only that group's
  modules. Group B and Group C tests build `LogEvent` objects directly through
  the `make_event` helper rather than parsing text, so they pass without Group
  A's parser existing. A group can reach 4/4 on its own.
- **Order within a group.** Dependencies exist inside a group and only inside a
  group: `parse_line` builds on `parse_fields`, `read_events` on `parse_line`,
  and `render_query_report` on `format_table`, `parse_query` and `apply_query`.
  Work bottom-up. Group B's four stubs are mutually independent.

Progress is `passing_tests / 12` and is monotonic if you work in that order.
