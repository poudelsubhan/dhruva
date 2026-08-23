"""The run controller.

    INIT -> STEPPING -> VERIFYING -> (CHECKPOINTING | BREACHED) -> ROLLING_BACK -> RESUMING -> DONE
                                                                                 -> HALTED_ALERT

The controller owns seq assignment and every event emission. Verifier, Checkpointer, Ledger and the
rollback hook are injected, so this loop is testable against stubs with no model calls at all.

Two behaviours here exist because of specific demo failure modes:

**Completion claims force a verification** (D3). Scenario S2 falsifies the test runner so the agent
believes it is finished and stops. A stopped agent emits no events, so no window would ever close,
no breach would fire, and the scenario would render a flat line on stage. A claim is never taken at
face value.

**Unsupervised mode scores but never intervenes.** It is the control arm of the twin comparison, so
it must run the identical code path minus the interventions.
"""

from __future__ import annotations

from enum import StrEnum
from pathlib import Path
from typing import Any, Literal, Protocol, cast

from backend.checkpoint import Checkpointer
from backend.contracts import IntentDigest, ProgressResult
from backend.harness.events import EventStore
from backend.ledger import Ledger
from backend.verifier import Verifier


class RunState(StrEnum):
    INIT = "init"
    STEPPING = "stepping"
    VERIFYING = "verifying"
    CHECKPOINTING = "checkpointing"
    BREACHED = "breached"
    ROLLING_BACK = "rolling_back"
    RESUMING = "resuming"
    DONE = "done"
    HALTED_ALERT = "halted_alert"


class RollbackHook(Protocol):
    def __call__(self, controller: RunController, breach_seq: int) -> bool: ...


def _halting_hook(controller: RunController, breach_seq: int) -> bool:
    """Phase 2 default: halt on breach. Phase 3's rollback controller replaces it."""
    return False


class RunController:
    def __init__(
        self,
        run_id: str,
        adapter: Any,
        task_pack: Any,
        workdir: Path,
        verifier: Verifier,
        checkpointer: Checkpointer,
        ledger: Ledger,
        runs_dir: Path,
        mode: str = "supervised",
        rollback_hook: RollbackHook | None = None,
        injector: Any = None,
        window_steps: int = 5,
        max_steps: int = 60,
    ) -> None:
        self.run_id = run_id
        self.adapter = adapter
        self.task_pack = task_pack
        self.workdir = Path(workdir)
        self.verifier = verifier
        self.checkpointer = checkpointer
        self.ledger = ledger
        self.mode = mode
        self.rollback_hook = rollback_hook or _halting_hook
        self.injector = injector
        self.window_steps = window_steps
        self.max_steps = max_steps

        self.store = EventStore(run_id, runs_dir)
        self.state = RunState.INIT
        self.handle: Any = None
        self.intent: IntentDigest | None = None
        self.step_count = 0
        self.window_start_seq = 0
        self.action_descriptions: list[str] = []
        self.current_checkpoint: str | None = None
        self.checkpoint_steps: dict[str, int] = {}
        self.last_progress: ProgressResult | None = None

    # -- lifecycle ------------------------------------------------------------

    def start(self, seeded_ledger: Path | None = None) -> None:
        spec = self.task_pack.spec
        seeded = self.ledger.seed_from(seeded_ledger) if seeded_ledger else 0
        self.handle = self.adapter.init(spec)
        self.intent = IntentDigest(objective=spec.strip().splitlines()[0][:400] if spec else "")
        self.store.emit(
            "task_start",
            {
                "task": self.task_pack.__class__.__name__,
                "mode": "supervised" if self.mode == "supervised" else "unsupervised",
                "spec_hash": self.checkpointer.genesis(spec),
                "seeded_learnings": seeded,
            },
        )
        self.state = RunState.STEPPING

    def run(self, seeded_ledger: Path | None = None) -> RunState:
        """Drive to completion. Returns the terminal state."""
        if self.state == RunState.INIT:
            self.start(seeded_ledger)

        while self.state in (RunState.STEPPING, RunState.RESUMING):
            self.state = RunState.STEPPING
            if self.step_count >= self.max_steps:
                self._complete(success=False, reason="step budget exhausted")
                break
            proceeded = self.step_once()
            if self.state == RunState.HALTED_ALERT:
                # A halt is a terminal error state. Emitting task_complete here would report a
                # supervised failure as a success, which is the one outcome the UI must never show.
                break
            if not proceeded:
                self._complete(success=self._is_solved())
                break
        return self.state

    def step_once(self) -> bool:
        """One agent step plus, when the window closes, one verification. False = no more steps."""
        if self.injector is not None and self.injector.should_fire(self.step_count + 1):
            self.injector.fire(self, self.step_count + 1)

        result = self.adapter.step(self.handle, execute=True)
        if result is None:
            if self._window_open():
                self._verify_window()
            return False

        self.step_count += 1
        claims_complete = bool(getattr(result, "claims_complete", False)) or (
            "notes.md" in str(result.args.get("path", "")).lower() and result.tool == "write_file"
        )
        self.store.emit(
            "action",
            {
                "step": result.step,
                "description": result.description,
                "tool": result.tool,
                "args_digest": _digest(result.args),
                "claims_complete": claims_complete,
            },
            checkpoint_ref=self.current_checkpoint,
        )
        self.action_descriptions.append(result.description)

        observation = self._execute_tool(result)
        self.store.emit("observation", observation, checkpoint_ref=self.current_checkpoint)

        # D3: a completion claim closes the window immediately. Otherwise S2's falsified
        # "all tests pass" lets the agent declare victory and stop -- and a stopped agent
        # produces silence, not a breach.
        if self.step_count % self.window_steps == 0 or claims_complete:
            self._verify_window()
        return self.state in (RunState.STEPPING, RunState.RESUMING)

    def _execute_tool(self, result: Any) -> dict[str, Any]:
        call = self.task_pack.call_tool(result.tool, result.args, self.workdir)
        if self.injector is not None:
            call = self.injector.intercept(result.tool, call)
        payload: dict[str, Any] = {
            "tool": result.tool,
            "result_digest": _digest({"content": call.content[:400], "ok": call.ok}),
            "poisoned": bool(call.meta.get("poisoned", False)),
            # Verbatim, because the digest makes the lie unrecoverable and the lie is the point.
            "content": call.content[:1200],
        }
        if result.tool == "run_tests":
            # What the AGENT concludes, parsed from what it was handed. On a clean run this equals
            # the measured truth below; when the tool lies, the gap between them is the whole story.
            payload["agent_progress"] = _parse_reported(call.content).model_dump(mode="json")
            # The supervisor always reads real progress -- that is the whole point of an
            # independent signal. The AGENT sees whatever the tool returned, poisoned or not,
            # which is exactly the asymmetry scenario S2 exists to demonstrate.
            progress = self.task_pack.progress(self.workdir)
            self.last_progress = progress
            payload["progress"] = progress.model_dump(mode="json")
        return payload

    # -- verification ---------------------------------------------------------

    def _window_open(self) -> bool:
        """True only if the window actually contains agent actions.

        A window with no actions is not incoherent, it is empty -- but a judge shown an empty
        transcript reasonably scores it near zero, which breaches and rolls back completed work.
        This was observed live: a run finished its script, verified the leftover window, scored
        0.155 on "the window shows no actions", and destroyed a correct implementation.
        """
        return any(e.type == "action" and e.seq >= self.window_start_seq for e in self.store.events)

    def _verify_window(self) -> None:
        self.state = RunState.VERIFYING
        window = (self.window_start_seq, max(self.window_start_seq, self.store.next_seq - 1))
        progress = self.last_progress or self.task_pack.progress(self.workdir)
        self.last_progress = progress

        outcome = self.verifier.verify(
            intent=self.intent or IntentDigest(objective=""),
            action_descriptions=self.action_descriptions,
            window_text=self._window_text(window),
            progress=progress,
        )
        verification = self.store.emit(
            "verification",
            {
                "window": list(window),
                "alignment": outcome.alignment,
                "repetition": outcome.repetition,
                "progress": outcome.progress,
                "coherence": outcome.coherence,
                "verdict": outcome.verdict,
                "rationale": outcome.rationale,
                "violated_constraints": outcome.violated_constraints,
                "tests_tampered": outcome.tests_tampered,
            },
            checkpoint_ref=self.current_checkpoint,
        )

        admitted = self.ledger.admit(
            candidates=outcome.learnings,
            verdict=outcome.verdict,
            minted_at_seq=self.store.next_seq,
            source_seqs=list(range(window[0], window[1] + 1)),
            checkpoint_ref=self.current_checkpoint,
        )
        for entry in admitted:
            self.store.emit(
                "learning",
                {
                    "entry_id": entry.id,
                    "kind": entry.kind,
                    "text": entry.text,
                    "confidence": entry.confidence,
                    "source_seqs": entry.source_seqs,
                },
                checkpoint_ref=self.current_checkpoint,
            )

        self.window_start_seq = self.store.next_seq

        if outcome.verdict == "breach":
            self._on_breach(verification.seq, outcome)
            return

        if outcome.verdict == "pass":
            self._checkpoint(window)
        self.state = RunState.STEPPING

    def _window_text(self, window: tuple[int, int]) -> str:
        lines = []
        for event in self.store.events:
            if not (window[0] <= event.seq <= window[1]):
                continue
            if event.type == "action":
                lines.append(f"[{event.seq}] ACTION {event.payload.get('description')}")
            elif event.type == "observation":
                progress = event.payload.get("progress") or {}
                score = progress.get("score")
                suffix = f" (progress {score})" if score is not None else ""
                lines.append(f"[{event.seq}] RESULT from {event.payload.get('tool')}{suffix}")
        return "\n".join(lines) or "(no actions in window)"

    def _checkpoint(self, window: tuple[int, int]) -> None:
        self.state = RunState.CHECKPOINTING
        self.intent = self.checkpointer.compress_intent(
            self.task_pack.spec,
            [e.model_dump(mode="json") for e in self.store.events],
            fallback=self.intent,
        )
        snapshot = self.task_pack.snapshot(self.workdir)
        checkpoint = self.checkpointer.mint(
            self.run_id, window, self.intent, snapshot, ledger_head=None
        )
        files_ref = self.checkpointer.snapshot_dir(self.run_id, checkpoint.id)
        self.task_pack.save_snapshot_files(self.workdir, files_ref)
        checkpoint = checkpoint.model_copy(
            update={"snapshot": snapshot.model_copy(update={"files_ref": str(files_ref)})}
        )
        self.checkpointer.chain[-1] = checkpoint

        # A passing window both mints a checkpoint AND confirms its predecessor as a
        # valid rollback target.
        confirmed = self.checkpointer.confirm_previous_excluding(checkpoint.id)

        self.current_checkpoint = checkpoint.id
        self.checkpoint_steps[checkpoint.id] = self.step_count
        self.store.emit(
            "checkpoint",
            {
                "id": checkpoint.id,
                "seq_range": list(checkpoint.seq_range),
                "parent_hash": checkpoint.parent_hash,
                "hash": checkpoint.hash,
                "confirmed": False,
                "ledger_head": checkpoint.ledger_head,
            },
            checkpoint_ref=checkpoint.id,
        )
        if confirmed is not None:
            self.store.emit(
                "memory_op",
                {
                    "op": "write",
                    "detail": f"checkpoint {confirmed.id} confirmed as a rollback target",
                },
                checkpoint_ref=checkpoint.id,
            )

    # -- breach ---------------------------------------------------------------

    def _on_breach(self, verification_seq: int, outcome: Any) -> None:
        rule = (
            "tests_tampered"
            if outcome.tests_tampered
            else (
                "below_breach_threshold"
                if outcome.coherence < self.verifier.thresholds.breach
                else "two_consecutive_warns"
            )
        )
        if self.mode != "supervised":
            # The control arm: scores drift and records the breach, but never intervenes.
            self.store.emit(
                "breach",
                {"verification_ref": verification_seq, "rule_fired": rule},
                checkpoint_ref=self.current_checkpoint,
            )
            self.state = RunState.STEPPING
            return

        breach = self.store.emit(
            "breach",
            {"verification_ref": verification_seq, "rule_fired": rule},
            checkpoint_ref=self.current_checkpoint,
        )
        self.state = RunState.ROLLING_BACK
        recovered = self.rollback_hook(self, breach.seq)
        self.state = RunState.RESUMING if recovered else RunState.HALTED_ALERT

    # -- completion -----------------------------------------------------------

    def _is_solved(self) -> bool:
        progress = self.task_pack.progress(self.workdir)
        self.last_progress = progress
        return progress.score >= 1.0 and not progress.tests_tampered

    def _complete(self, success: bool, reason: str = "") -> None:
        progress = self.last_progress or self.task_pack.progress(self.workdir)
        payload = {
            "success": success,
            "progress": progress.model_dump(mode="json"),
            "steps": self.step_count,
        }
        self.store.emit("task_complete", payload, checkpoint_ref=self.current_checkpoint)
        self.state = RunState.DONE


def _parse_reported(content: str) -> ProgressResult:
    """Read a tool's own PASS/FAIL claims at face value, exactly as the agent would."""
    per_test: dict[str, str] = {}
    for line in content.splitlines():
        stripped = line.strip()
        for marker, verdict in (("PASS ", "pass"), ("FAIL ", "fail")):
            if stripped.startswith(marker):
                per_test[stripped[len(marker) :].strip()] = verdict
    passed = sum(1 for v in per_test.values() if v == "pass")
    total = len(per_test) or 1
    return ProgressResult(
        score=round(passed / max(total, 12), 4),
        per_test=cast("dict[str, Literal['pass', 'fail']]", per_test),
        tests_tampered=False,
    )


def _digest(value: Any) -> str:
    import hashlib

    from backend.contracts import canonical_json

    return hashlib.sha256(canonical_json(value).encode()).hexdigest()[:16]
