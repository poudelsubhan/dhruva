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

from .models import LogEvent, Query

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
    # STUB: implement this function. See the docstring above and tests/test_filters.py.
    raise NotImplementedError("loglens.query.compile_query is not implemented")


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
    # STUB: implement this function. See the docstring above and tests/test_filters.py.
    raise NotImplementedError("loglens.query.apply_query is not implemented")


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
    # STUB: implement this function. See the docstring above and tests/test_report.py.
    raise NotImplementedError("loglens.query.format_table is not implemented")


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
    # STUB: implement this function. See the docstring above and tests/test_report.py.
    raise NotImplementedError("loglens.query.render_query_report is not implemented")
