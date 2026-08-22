"""Core data types shared by every loglens module.

This module is complete. It contains no stubs and should not need editing.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


class LogParseError(ValueError):
    """Raised when a log line cannot be parsed into a :class:`LogEvent`."""


class QueryError(ValueError):
    """Raised when a filter expression is malformed or cannot be evaluated."""


@dataclass(frozen=True, slots=True)
class LogEvent:
    """One request recorded in an access log.

    ``ts`` is always timezone-aware and normalised to UTC.
    ``path`` never carries a query string.
    """

    ts: datetime
    session_id: str
    method: str
    path: str
    status: int
    duration_ms: float
    bytes_sent: int


@dataclass(frozen=True, slots=True)
class IngestResult:
    """The outcome of parsing a batch of raw log lines.

    ``errors`` holds ``(line_number, message)`` pairs for lines that failed to
    parse. ``skipped`` counts blank and comment lines, which are not errors.
    """

    events: tuple[LogEvent, ...]
    errors: tuple[tuple[int, str], ...]
    skipped: int


@dataclass(frozen=True, slots=True)
class SessionSummary:
    """Aggregate statistics for one session id."""

    session_id: str
    started_at: datetime
    ended_at: datetime
    duration_s: float
    request_count: int
    error_count: int
    distinct_paths: int


@dataclass(frozen=True, slots=True)
class Clause:
    """One ``field op value`` term of a filter expression."""

    field: str
    op: str
    value: str


@dataclass(frozen=True, slots=True)
class Query:
    """A conjunction of clauses. An empty clause tuple matches everything."""

    clauses: tuple[Clause, ...]
