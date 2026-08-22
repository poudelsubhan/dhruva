"""Run registry and orchestration.

Runs execute in a worker thread so the event loop stays free to serve WebSocket subscribers. Each
run owns an EventStore, which is the single source of truth: the JSONL on disk and the WS frames
carry byte-identical objects, so replay renders from exactly what live rendered.
"""

from __future__ import annotations

import asyncio
import json
import shutil
import threading
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from backend.checkpoint import Checkpointer
from backend.config import get_settings
from backend.harness import RunController, ScriptedAgentAdapter
from backend.harness.stub_agent import ScriptedStep
from backend.inject import Injector
from backend.ledger import Ledger
from backend.providers import MockProvider, OpenAICompatProvider, ProviderError
from backend.rollback import RollbackController
from backend.tasks import LoglensTaskPack
from backend.verifier import Verifier


@dataclass
class RunRecord:
    run_id: str
    mode: str
    task: str
    controller: RunController
    thread: threading.Thread | None = None
    scenario: str | None = None
    twin_id: str | None = None
    loop: asyncio.AbstractEventLoop | None = None
    meta: dict[str, Any] = field(default_factory=dict)

    @property
    def state(self) -> str:
        return str(self.controller.state)

    def summary(self) -> dict[str, Any]:
        events = self.controller.store.events
        verifications = [e for e in events if e.type == "verification"]
        return {
            "run_id": self.run_id,
            "mode": self.mode,
            "task": self.task,
            "scenario": self.scenario,
            "twin_id": self.twin_id,
            "state": self.state,
            "events": len(events),
            "checkpoints": len([e for e in events if e.type == "checkpoint"]),
            "breaches": len([e for e in events if e.type == "breach"]),
            "rollbacks": len([e for e in events if e.type == "rollback"]),
            "learnings": len([e for e in events if e.type == "learning"]),
            "coherence": verifications[-1].payload.get("coherence") if verifications else None,
            "progress": self.controller.last_progress.score
            if self.controller.last_progress
            else 0.0,
        }


class RunRegistry:
    """Process-wide registry. Demo-scoped: no persistence beyond the run directory."""

    def __init__(self) -> None:
        self.runs: dict[str, RunRecord] = {}
        self._lock = threading.Lock()

    # -- construction ---------------------------------------------------------

    def _provider(self) -> Any:
        settings = get_settings()
        if not settings.openai_api_key.get_secret_value():
            return MockProvider()
        try:
            return OpenAICompatProvider()
        except ProviderError:
            return MockProvider()

    def _workdir(self, run_id: str) -> Path:
        settings = get_settings()
        dest = settings.runs_dir / run_id / "workdir"
        dest.parent.mkdir(parents=True, exist_ok=True)
        if dest.exists():
            shutil.rmtree(dest)
        shutil.copytree(
            settings.fixtures_dir / "task_repo",
            dest,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", ".pytest_cache"),
        )
        return dest

    def create(
        self,
        mode: str,
        task: str = "loglens",
        scenario: str | None = None,
        at_step: int | None = None,
        script: list[ScriptedStep] | None = None,
        twin_id: str | None = None,
    ) -> RunRecord:
        settings = get_settings()
        run_id = f"{mode[:3]}-{uuid.uuid4().hex[:8]}"
        provider = self._provider()
        workdir = self._workdir(run_id)

        injector: Injector | None = None
        if scenario:
            injector = Injector()
            injector.arm(scenario, at_step if at_step is not None else 6)

        from scripts.demo_scenario import recovery_script
        from scripts.demo_scenario import script as demo_script

        controller = RunController(
            run_id=run_id,
            adapter=ScriptedAgentAdapter(script or demo_script(), recovery_script()),
            task_pack=LoglensTaskPack(settings.fixtures_dir / "task_repo"),
            workdir=workdir,
            verifier=Verifier(provider),
            checkpointer=Checkpointer(provider, settings.runs_dir),
            ledger=Ledger(run_id),
            runs_dir=settings.runs_dir,
            mode=mode if mode in ("supervised", "unsupervised") else "supervised",
            rollback_hook=RollbackController() if mode == "supervised" else None,
            injector=injector,
            window_steps=5,
        )
        record = RunRecord(
            run_id=run_id,
            mode=mode,
            task=task,
            controller=controller,
            scenario=scenario,
            twin_id=twin_id,
        )
        with self._lock:
            self.runs[run_id] = record
        return record

    # -- execution ------------------------------------------------------------

    def start(self, record: RunRecord, loop: asyncio.AbstractEventLoop) -> None:
        record.loop = loop
        record.controller.store.bind_loop(loop)

        def target() -> None:
            try:
                record.controller.run()
            except Exception as exc:
                record.controller.store.emit(
                    "memory_op",
                    {"op": "read", "detail": f"run failed: {type(exc).__name__}: {exc}"},
                )

        thread = threading.Thread(target=target, name=f"run-{record.run_id}", daemon=True)
        record.thread = thread
        thread.start()

    def get(self, run_id: str) -> RunRecord | None:
        return self.runs.get(run_id)

    def events_on_disk(self, run_id: str) -> list[dict[str, Any]] | None:
        """Read a completed run's log straight from disk.

        The registry is in-memory and demo-scoped, but the event log is not -- it is appended to
        runs/{id}/events.jsonl as the run happens. Without this, restarting the backend makes every
        finished run unreplayable even though the data is sitting right there, which is exactly the
        wrong failure to have on a demo machine.
        """
        if "/" in run_id or ".." in run_id:
            return None
        path = get_settings().runs_dir / run_id / "events.jsonl"
        if not path.is_file():
            return None
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    def list(self) -> list[dict[str, Any]]:
        return [r.summary() for r in self.runs.values()]

    def inject(self, run_id: str, scenario: str, at_step: int | None, now: bool) -> bool:
        record = self.get(run_id)
        if record is None:
            return False
        controller = record.controller
        if controller.injector is None:
            controller.injector = Injector()
        step = controller.step_count if now else (at_step if at_step is not None else 6)
        controller.injector.arm(scenario, step)
        return True


REGISTRY = RunRegistry()
