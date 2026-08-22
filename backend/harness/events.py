"""Append-only event log.

The JSONL line on disk and the WebSocket frame are the same object — one source of truth for live
and replay, which is what lets the replay view reuse the live render path exactly.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from backend.contracts import RunEvent, canonical_json


class EventStore:
    """Owns seq assignment for one run. Nothing else may allocate a seq."""

    def __init__(self, run_id: str, runs_dir: Path, clock: Any = None) -> None:
        self.run_id = run_id
        self.dir = Path(runs_dir) / run_id
        self.dir.mkdir(parents=True, exist_ok=True)
        self.path = self.dir / "events.jsonl"
        self.events: list[RunEvent] = []
        self._subscribers: list[asyncio.Queue[RunEvent]] = []
        self._clock = clock or (lambda: datetime.now(UTC).isoformat().replace("+00:00", "Z"))
        self._seq = 0

    def emit(
        self,
        etype: str,
        payload: dict[str, Any],
        checkpoint_ref: str | None = None,
        agent_id: str | None = None,
        swarm_id: str | None = None,
    ) -> RunEvent:
        event = RunEvent(
            run_id=self.run_id,
            seq=self._seq,
            ts=self._clock(),
            type=etype,  # type: ignore[arg-type]
            payload=payload,
            checkpoint_ref=checkpoint_ref,
            agent_id=agent_id,
            swarm_id=swarm_id,
        )
        self._seq += 1
        self.events.append(event)
        with self.path.open("a") as handle:
            handle.write(canonical_json(event.model_dump(mode="json")) + "\n")
        for queue in list(self._subscribers):
            queue.put_nowait(event)
        return event

    @property
    def next_seq(self) -> int:
        return self._seq

    def subscribe(self) -> asyncio.Queue[RunEvent]:
        queue: asyncio.Queue[RunEvent] = asyncio.Queue()
        self._subscribers.append(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[RunEvent]) -> None:
        if queue in self._subscribers:
            self._subscribers.remove(queue)

    def of_type(self, *types: str) -> list[RunEvent]:
        return [e for e in self.events if e.type in types]

    def poison_seqs(self) -> set[int]:
        """Ground-truth provenance for the taint audit: poisoned observations and injections.

        Never inferred — the fixture marks poisoned output explicitly, so eviction is exact.
        """
        return {
            e.seq
            for e in self.events
            if (e.type == "observation" and e.payload.get("poisoned")) or e.type == "injection"
        }

    def injection_seq(self) -> int | None:
        injections = self.of_type("injection")
        return injections[0].seq if injections else None

    @staticmethod
    def read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
        for line in Path(path).read_text().splitlines():
            if line.strip():
                yield json.loads(line)
