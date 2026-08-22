"""Line-level parsing of the logfmt access-log format.

A log line is a sequence of ``key=value`` tokens, for example::

    ts=2026-08-22T14:03:11Z session=s-8f21 method=GET path="/api/orders?page=2" \
status=200 dur_ms=143.5 bytes=2048
"""

from __future__ import annotations

from datetime import UTC, datetime

from .models import LogEvent, LogParseError

#: Keys every well-formed access-log line must carry.
REQUIRED_KEYS = ("ts", "session", "method", "path", "status", "dur_ms", "bytes")


def parse_fields(line: str) -> dict[str, str]:
    """Split one logfmt line into its key/value pairs.

    Tokens are separated by one or more spaces. A value may be double-quoted,
    in which case it may contain spaces, ``=`` characters, and the escape
    sequences ``\\"`` and ``\\\\``. An unquoted value runs to the next space.
    Keys are bare words and must be non-empty. Where a key repeats, the last
    occurrence wins.

    Raises:
        LogParseError: if a token contains no ``=``, if a key is empty, or if a
            quoted value is never closed.
    """
    fields: dict[str, str] = {}
    index = 0
    length = len(line)

    while index < length:
        if line[index].isspace():
            index += 1
            continue

        key_start = index
        while index < length and line[index] != "=" and not line[index].isspace():
            index += 1
        key = line[key_start:index]

        if index >= length or line[index] != "=":
            raise LogParseError(f"token {key!r} is not a key=value pair")
        if not key:
            raise LogParseError("empty key in log line")
        index += 1

        if index < length and line[index] == '"':
            index += 1
            chunks: list[str] = []
            closed = False
            while index < length:
                char = line[index]
                if char == "\\" and index + 1 < length:
                    chunks.append(line[index + 1])
                    index += 2
                    continue
                if char == '"':
                    index += 1
                    closed = True
                    break
                chunks.append(char)
                index += 1
            if not closed:
                raise LogParseError(f"unterminated quoted value for key {key!r}")
            fields[key] = "".join(chunks)
        else:
            value_start = index
            while index < length and not line[index].isspace():
                index += 1
            fields[key] = line[value_start:index]

    return fields


def parse_line(line: str) -> LogEvent:
    """Parse one access-log line into a :class:`~loglens.models.LogEvent`.

    Every key in :data:`REQUIRED_KEYS` must be present; unknown extra keys are
    ignored. Values are normalised as follows:

    ``ts``
        ISO-8601 with an explicit UTC offset (a trailing ``Z`` is accepted),
        converted to UTC. A timestamp without an offset is an error.
    ``method``
        Upper-cased.
    ``path``
        The query string — everything from the first ``?`` onward — is dropped.
    ``status`` / ``bytes``
        Coerced with ``int``.
    ``dur_ms``
        Coerced with ``float``.

    Raises:
        LogParseError: if a required key is missing or a value cannot be
            coerced. The message must name the offending key.
    """
    fields = parse_fields(line)

    for key in REQUIRED_KEYS:
        if key not in fields:
            raise LogParseError(f"missing required key {key!r}")

    raw_ts = fields["ts"]
    try:
        stamp = datetime.fromisoformat(raw_ts)
    except ValueError as exc:
        raise LogParseError(f"bad value for key 'ts': {raw_ts!r}") from exc
    if stamp.tzinfo is None:
        raise LogParseError(f"bad value for key 'ts': {raw_ts!r} has no UTC offset")

    numbers: dict[str, int | float] = {}
    for key, coerce in (("status", int), ("dur_ms", float), ("bytes", int)):
        try:
            numbers[key] = coerce(fields[key])
        except ValueError as exc:
            raise LogParseError(f"bad value for key {key!r}: {fields[key]!r}") from exc

    return LogEvent(
        ts=stamp.astimezone(UTC),
        session_id=fields["session"],
        method=fields["method"].upper(),
        path=fields["path"].split("?", 1)[0],
        status=int(numbers["status"]),
        duration_ms=float(numbers["dur_ms"]),
        bytes_sent=int(numbers["bytes"]),
    )
