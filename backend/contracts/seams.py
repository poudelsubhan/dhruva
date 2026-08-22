"""The three adapter seams.

These are the only places a day-of mandate should require code. Everything above them —
harness, verifier, checkpointer, ledger, rollback — binds to these Protocols and never to a
concrete implementation.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from backend.contracts.models import ProgressResult, Snapshot


class ToolDef(Protocol):
    """A tool the wrapped agent may call."""

    name: str
    description: str
    parameters: dict[str, Any]


class StepResult(Protocol):
    """One agent step. ``executed`` is False for a pre-flight proposal."""

    step: int
    description: str
    tool: str
    args: dict[str, Any]
    result: Any | None
    executed: bool


@runtime_checkable
class AgentAdapter(Protocol):
    """Seam 1 — the wrapped agent loop.

    ``step(execute=False)`` is the pre-flight hook: it returns the agent's proposed next step
    WITHOUT acting, so the rollback controller can verify intent alignment before resuming.
    """

    def init(self, task_spec: str) -> Any: ...

    def step(self, handle: Any, execute: bool = True) -> StepResult: ...

    def inject_messages(self, handle: Any, msgs: list[dict[str, Any]]) -> None: ...

    def get_context(self, handle: Any) -> list[dict[str, Any]]: ...

    def set_context(self, handle: Any, msgs: list[dict[str, Any]]) -> None: ...


@runtime_checkable
class ModelProvider(Protocol):
    """Seam 2 — model access.

    One OpenAI-compatible client against OpenRouter covers both vendors, so the plan's
    mixed-provider property (agent and judge on different providers) holds by construction:
    agent = anthropic/claude-sonnet-5, judge = openai/gpt-5-mini.
    """

    def complete(
        self,
        messages: list[dict[str, Any]],
        tools: list[ToolDef] | None = None,
        temperature: float = 0.0,
        json_mode: bool = False,
        model: str | None = None,
    ) -> dict[str, Any]: ...


@runtime_checkable
class TaskPack(Protocol):
    """Seam 3 — the demo task.

    ``progress`` returns a record rather than a float (v3/D2): the score is computed by running
    the suite, and scenario S3's corruption IS an edit to the suite, so the pack must report
    whether its own ground truth was tampered with.
    """

    spec: str
    fixtures_dir: Path
    tools: list[ToolDef]

    def snapshot(self, workdir: Path) -> Snapshot: ...

    def restore(self, snapshot: Snapshot, workdir: Path) -> None: ...

    def progress(self, workdir: Path) -> ProgressResult: ...
