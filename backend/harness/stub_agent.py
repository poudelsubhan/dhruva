"""A scripted AgentAdapter.

Drives the controller from a fixture step-list so every harness test is deterministic and free.
It implements the same seam the real agent does, including the pre-flight hook:
``step(execute=False)`` returns the proposed next step without acting.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ScriptedStep:
    description: str
    tool: str
    args: dict[str, Any] = field(default_factory=dict)
    claims_complete: bool = False


@dataclass
class StubStepResult:
    step: int
    description: str
    tool: str
    args: dict[str, Any]
    result: Any = None
    executed: bool = True


@dataclass
class StubHandle:
    steps: list[ScriptedStep]
    cursor: int = 0
    messages: list[dict[str, Any]] = field(default_factory=list)


class ScriptedAgentAdapter:
    """``AgentAdapter`` over a fixed step list."""

    def __init__(self, steps: list[ScriptedStep]) -> None:
        self.steps = steps
        self.injected: list[list[dict[str, Any]]] = []
        self.context_writes = 0

    def init(self, task_spec: str) -> StubHandle:
        return StubHandle(
            steps=list(self.steps),
            messages=[{"role": "system", "content": task_spec}],
        )

    def step(self, handle: StubHandle, execute: bool = True) -> StubStepResult | None:
        if handle.cursor >= len(handle.steps):
            return None
        scripted = handle.steps[handle.cursor]
        result = StubStepResult(
            step=handle.cursor + 1,
            description=scripted.description,
            tool=scripted.tool,
            args=dict(scripted.args),
            executed=execute,
        )
        if execute:
            handle.cursor += 1
        return result

    def inject_messages(self, handle: StubHandle, msgs: list[dict[str, Any]]) -> None:
        handle.messages.extend(msgs)
        self.injected.append(list(msgs))

    def get_context(self, handle: StubHandle) -> list[dict[str, Any]]:
        return list(handle.messages)

    def set_context(self, handle: StubHandle, msgs: list[dict[str, Any]]) -> None:
        handle.messages = list(msgs)
        self.context_writes += 1

    def rewind_to(self, handle: StubHandle, cursor: int) -> None:
        """Test hook: put the script back so a rollback can redo discarded work."""
        handle.cursor = max(0, cursor)
