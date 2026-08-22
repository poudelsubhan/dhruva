"""Batch ingestion: turn raw log lines into a clean, ordered event set."""

from __future__ import annotations

from collections.abc import Iterable, Sequence

from .models import IngestResult, LogEvent, LogParseError
from .parser import parse_line


def read_events(lines: Iterable[str], *, strict: bool = False) -> IngestResult:
    """Parse an iterable of raw log lines into an :class:`IngestResult`.

    Blank lines and lines whose first non-space character is ``#`` are skipped
    and counted in ``IngestResult.skipped``. Every other line is handed to
    :func:`~loglens.parser.parse_line` after stripping surrounding whitespace.

    Args:
        lines: raw lines, in file order.
        strict: when ``False`` (the default) a :class:`LogParseError` is
            recorded as ``(line_number, str(error))`` in ``IngestResult.errors``
            and ingestion continues. When ``True`` the error propagates.

    Line numbers are 1-based over the input iterable and count skipped lines,
    so they match what an editor shows. Parsed events keep input order.
    """
    events: list[LogEvent] = []
    errors: list[tuple[int, str]] = []
    skipped = 0

    for lineno, raw in enumerate(lines, start=1):
        stripped = raw.strip()
        if not stripped or stripped.startswith("#"):
            skipped += 1
            continue
        try:
            events.append(parse_line(stripped))
        except LogParseError as exc:
            if strict:
                raise
            errors.append((lineno, str(exc)))

    return IngestResult(events=tuple(events), errors=tuple(errors), skipped=skipped)


def dedupe_events(events: Sequence[LogEvent]) -> list[LogEvent]:
    """Drop duplicate events and return the rest in a total, stable order.

    Two events are duplicates when ``(session_id, ts, method, path)`` match.
    The first occurrence in input order wins; later duplicates are discarded
    even if their other fields differ.

    The returned list is sorted by ``ts``, then ``session_id``, then ``path``.
    That is a total order over the fixture data, so the output does not depend
    on input order beyond which duplicate was kept.
    """
    seen: set[tuple[object, ...]] = set()
    unique: list[LogEvent] = []

    for event in events:
        key = (event.session_id, event.ts, event.method, event.path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(event)

    unique.sort(key=lambda event: (event.ts, event.session_id, event.path))
    return unique
