"""A tiny filter language over :class:`~loglens.models.LogEvent` fields.

Expressions look like::

    status>=400 AND path~/api/ AND method="GET"
"""

from __future__ import annotations

import operator
from collections.abc import Sequence

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


def parse_query(expr: str) -> Query:
    """Parse a filter expression into a :class:`Query`.

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
