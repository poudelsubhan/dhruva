"""Human-readable text reports."""

from __future__ import annotations

from collections.abc import Sequence
from datetime import UTC

from .filters import apply_query, parse_query
from .models import LogEvent

#: Column headers used by :func:`render_query_report`.
REPORT_HEADERS = ("ts", "method", "path", "status", "dur_ms")

#: Separator placed between rendered columns.
COLUMN_GAP = "  "


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

    ``expr`` is parsed with :func:`~loglens.filters.parse_query` and applied
    with :func:`~loglens.filters.apply_query`. Matching events are listed newest
    first — ``ts`` descending, ties broken by ``path`` ascending — and truncated
    to ``limit`` rows when ``limit`` is not ``None``.

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
    matched = apply_query(events, parse_query(expr))

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
