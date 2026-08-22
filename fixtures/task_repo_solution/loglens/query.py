"""The ad-hoc filter language and the text reports rendered from it.

Expressions look like::

    status>=400 AND path~/api/ AND method="GET"

A filter is compiled into a :class:`~loglens.models.Query`, applied to a
sequence of events, and — for :func:`render_query_report` — rendered as a
fixed-width table.
"""

from __future__ import annotations

import operator
from collections.abc import Sequence
from datetime import UTC

from .models import Clause, LogEvent, Query, QueryError

#: Event fields that compare numerically.
NUMERIC_FIELDS = frozenset({"status", "duration_ms", "bytes_sent"})

#: Event fields that compare as strings.
STRING_FIELDS = frozenset({"session_id", "method", "path"})

#: Every field a clause may name.
QUERY_FIELDS = NUMERIC_FIELDS | STRING_FIELDS

#: Recognised operators. Longer spellings must be matched before their prefixes.
OPERATORS = ("!=", ">=", "<=", "=", ">", "<", "~")

#: Operators valid on string fields.
STRING_OPERATORS = frozenset({"=", "!=", "~"})

#: Comparison implementations for numeric fields.
NUMERIC_COMPARISONS = {
    "=": operator.eq,
    "!=": operator.ne,
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
}

#: Column headers used by :func:`render_query_report`.
REPORT_HEADERS = ("ts", "method", "path", "status", "dur_ms")

#: Separator placed between rendered columns.
COLUMN_GAP = "  "


def compile_query(expr: str) -> Query:
    """Compile a filter expression into a :class:`Query`.

    Grammar: one or more clauses joined by the literal ``' AND '``
    (case-sensitive, one space either side). Each clause is ``field op value``
    with no spaces around the operator:

    * ``field`` — one of :data:`QUERY_FIELDS`.
    * ``op`` — one of :data:`OPERATORS`. Where two operators start at the same
      position, the longer one wins, so ``status>=400`` parses as ``>=`` and
      not as ``>``.
    * ``value`` — the rest of the clause. A pair of surrounding double quotes
      is stripped.

    An empty or whitespace-only expression yields ``Query(clauses=())``.

    This function checks *syntax* only. Whether an operator makes sense for the
    field it was applied to is decided by :func:`apply_query`.

    Raises:
        QueryError: on an unknown field, a missing or unrecognised operator, or
            an empty value.
    """
    text = expr.strip()
    if not text:
        return Query(clauses=())

    clauses: list[Clause] = []
    for raw_clause in text.split(" AND "):
        clause_text = raw_clause.strip()
        if not clause_text:
            raise QueryError(f"empty clause in query {expr!r}")

        best_at: int | None = None
        best_op: str | None = None
        for candidate in OPERATORS:
            position = clause_text.find(candidate)
            if position <= 0:
                continue
            if (
                best_at is None
                or position < best_at
                or (position == best_at and len(candidate) > len(best_op or ""))
            ):
                best_at, best_op = position, candidate

        if best_op is None or best_at is None:
            raise QueryError(f"clause {clause_text!r} has no operator")

        field_name = clause_text[:best_at]
        if field_name not in QUERY_FIELDS:
            raise QueryError(
                f"unknown field {field_name!r}; expected one of {sorted(QUERY_FIELDS)}"
            )

        value = clause_text[best_at + len(best_op) :].strip()
        if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        if not value:
            raise QueryError(f"clause {clause_text!r} has an empty value")

        clauses.append(Clause(field=field_name, op=best_op, value=value))

    return Query(clauses=tuple(clauses))


def apply_query(events: Sequence[LogEvent], query: Query) -> list[LogEvent]:
    """Return the events satisfying every clause of ``query``, in input order.

    Numeric fields (:data:`NUMERIC_FIELDS`) compare numerically: the clause
    value is coerced with ``float`` and compared using
    :data:`NUMERIC_COMPARISONS`.

    String fields (:data:`STRING_FIELDS`) accept only :data:`STRING_OPERATORS`.
    ``~`` means case-insensitive substring containment.

    A query with no clauses matches every event.

    Raises:
        QueryError: if a clause applies ``~`` or an ordering operator to a field
            that does not support it, or if a numeric clause's value is not a
            number.
    """
    return [
        event for event in events if all(_clause_matches(event, clause) for clause in query.clauses)
    ]


def _clause_matches(event: LogEvent, clause: Clause) -> bool:
    """Evaluate one clause against one event."""
    if clause.field in NUMERIC_FIELDS:
        if clause.op not in NUMERIC_COMPARISONS:
            raise QueryError(
                f"operator {clause.op!r} is not valid on numeric field {clause.field!r}"
            )
        try:
            wanted = float(clause.value)
        except ValueError as exc:
            raise QueryError(f"{clause.value!r} is not numeric for field {clause.field!r}") from exc
        return bool(NUMERIC_COMPARISONS[clause.op](float(getattr(event, clause.field)), wanted))

    if clause.op not in STRING_OPERATORS:
        raise QueryError(f"operator {clause.op!r} is not valid on string field {clause.field!r}")

    actual = str(getattr(event, clause.field))
    if clause.op == "=":
        return actual == clause.value
    if clause.op == "!=":
        return actual != clause.value
    return clause.value.lower() in actual.lower()


def format_table(headers: Sequence[str], rows: Sequence[Sequence[str]]) -> str:
    """Render a fixed-width text table.

    Each column is as wide as its widest cell, header included, and columns are
    joined by :data:`COLUMN_GAP`. A separator line of ``-`` repeated to each
    column's width sits between the header and the body.

    A column is right-aligned when it has at least one non-empty body cell and
    every non-empty body cell in it parses as a ``float``; otherwise it is
    left-aligned. The header cell follows its column's alignment.

    Trailing whitespace is stripped from every line, lines are joined with
    ``'\\n'``, and the result has no trailing newline. With no rows the output
    is just the header line and the separator line.

    Raises:
        ValueError: if any row's length differs from ``headers``.
    """
    header_cells = list(headers)
    body = [list(row) for row in rows]

    for position, row in enumerate(body):
        if len(row) != len(header_cells):
            raise ValueError(f"row {position} has {len(row)} cells, expected {len(header_cells)}")

    widths = [len(cell) for cell in header_cells]
    for row in body:
        for column, cell in enumerate(row):
            widths[column] = max(widths[column], len(cell))

    right_aligned: list[bool] = []
    for column in range(len(header_cells)):
        filled = [row[column] for row in body if row[column] != ""]
        right_aligned.append(bool(filled) and all(_is_number(cell) for cell in filled))

    def render(cells: Sequence[str]) -> str:
        padded = [
            cell.rjust(widths[column]) if right_aligned[column] else cell.ljust(widths[column])
            for column, cell in enumerate(cells)
        ]
        return COLUMN_GAP.join(padded).rstrip()

    lines = [render(header_cells), COLUMN_GAP.join("-" * width for width in widths)]
    lines.extend(render(row) for row in body)
    return "\n".join(lines)


def render_query_report(events: Sequence[LogEvent], expr: str, *, limit: int | None = None) -> str:
    """Render the events matching ``expr`` as a table with a footer.

    ``expr`` is compiled with :func:`compile_query` and applied with
    :func:`apply_query`. Matching events are listed newest first — ``ts``
    descending, ties broken by ``path`` ascending — and truncated to ``limit``
    rows when ``limit`` is not ``None``.

    Columns are :data:`REPORT_HEADERS`, rendered through :func:`format_table`:

    ``ts``
        ``'HH:MM:SS'`` in UTC.
    ``method``, ``path``
        Verbatim.
    ``status``
        Decimal integer.
    ``dur_ms``
        Fixed to one decimal place.

    The table is followed by a blank line and the footer line::

        <matched> of <total> events matched "<expr>"

    where ``<matched>`` counts matches *before* truncation and ``<total>`` is
    ``len(events)``.
    """
    matched = apply_query(events, compile_query(expr))

    ordered = sorted(matched, key=lambda event: event.path)
    ordered.sort(key=lambda event: event.ts, reverse=True)
    shown = ordered if limit is None else ordered[:limit]

    rows = [
        [
            event.ts.astimezone(UTC).strftime("%H:%M:%S"),
            event.method,
            event.path,
            str(event.status),
            f"{event.duration_ms:.1f}",
        ]
        for event in shown
    ]

    table = format_table(REPORT_HEADERS, rows)
    footer = f'{len(matched)} of {len(events)} events matched "{expr}"'
    return f"{table}\n\n{footer}"


def _is_number(text: str) -> bool:
    """Return whether ``text`` parses as a float."""
    try:
        float(text)
    except ValueError:
        return False
    return True
