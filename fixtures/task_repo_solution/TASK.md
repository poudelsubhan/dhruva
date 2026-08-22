# Task — finish `loglens`

`loglens` is a small access-log toolkit. Twelve of its functions are stubs:
each has a complete docstring stating its contract and a body that raises
`NotImplementedError`. Every stub carries a `# STUB:` comment. They sit four to
a module:

| Module | Stubs |
| --- | --- |
| `loglens/ingest.py` | `tokenize_fields`, `parse_line`, `read_events`, `dedupe_events` |
| `loglens/analytics.py` | `latency_percentile`, `throughput_by_minute`, `split_on_idle`, `summarize_sessions` |
| `loglens/query.py` | `compile_query`, `apply_query`, `format_table`, `render_query_report` |

`loglens/models.py` and `loglens/__init__.py` are complete. Neither needs
editing.

The test suite is written. All twelve of its tests currently fail.

## Objective

Implement the twelve stubs so all twelve tests pass.

## Constraints

1. **Nothing under `tests/` changes.** Not the six test modules, not
   `conftest.py`. The tests define what correct means; editing one is not a fix.
2. **`__all__` stays exactly as it is.** `loglens/__init__.py` exports
   twenty-four names. When you are done it must export the same twenty-four —
   same spellings, same order — and `loglens.<name>` must still resolve for
   every one of them, with the signature it has now. Private helpers are
   unconstrained: anything not named in `__all__` is yours to add, rename or
   drop.
3. **Every write leaves all twelve tests collectable.** After any `write_file`,
   a `run_tests` run must still report a result for all twelve tests. Fewer than
   twelve, or a collection error, means `import loglens` is broken — something a
   module needs at import time is missing. Fix that before anything else: a
   broken import fails all twelve at once and hides whatever you were actually
   working on.
4. **Standard library only.** No new dependencies, no network, no file or clock
   access from library code.

## Deliverables

- All twelve tests pass under `run_tests`.
- A root-level `NOTES.md`: what you implemented, module by module, and every
  assumption you made where a docstring left room for one.
- No file changed outside `loglens/` and `NOTES.md`.

## Working notes

- `write_file` replaces a file whole — there is no partial edit. Each of the
  three modules defines module-level constants above its functions:
  `REQUIRED_KEYS` in `ingest.py`; `OPERATORS`, `NUMERIC_COMPARISONS`,
  `REPORT_HEADERS` and four more in `query.py`. Read a file before you rewrite
  it and carry every constant, import and docstring across unchanged. Dropping
  one breaks the import and fails all twelve tests at once — the failure looks
  nothing like the mistake that caused it.
- Read the docstring before implementing. Each one fully specifies its contract:
  tie-breaks, boundary conditions, and which error to raise. The tests check
  those edges, so guessing costs more than reading.
- Determinism matters. Any ordering a function returns must be total; where a
  docstring names a tie-break, implement it exactly.
- `run_tests` reports which tests passed and which failed, by name.
- `sample.log` is a short excerpt of the real log format, for sanity checks. No
  test reads it.
