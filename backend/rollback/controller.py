"""The rollback controller — the highest-risk mechanism in the system.

On breach:

1. Halt stepping.
2. Target the latest **confirmed** checkpoint whose chain passes ``integrity_check``.
3. Restore the workdir from that checkpoint's snapshot.
4. Audit the ledger: keep clean knowledge, evict anything tracing to the corruption.
5. Rebuild the agent's context from scratch — the poisoned history is never replayed.
6. Pre-flight: ask for the next step WITHOUT executing it and verify it against the intent.
7. Resume, or step back one checkpoint and retry once; a second failure halts.

Two properties are deliberate and load-bearing:

**The audit is pure and synchronous.** No model call on this path. A judge call here would put dead
air and a failure mode on the one path that must not stall, and would convert judge sampling noise
into agent-trajectory divergence — making "two identical traces" strictly harder to achieve.

**Rollback must survive a broken auditor.** Knowledge retention is an enhancement; restoring the
workdir is the guarantee. If the audit raises, the rollback still completes with no retained
knowledge rather than failing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from backend.checkpoint import integrity_check
from backend.contracts import Checkpoint


@dataclass
class RollbackOutcome:
    recovered: bool
    target_checkpoint_id: str | None = None
    retained: list[str] = field(default_factory=list)
    evicted: list[dict[str, Any]] = field(default_factory=list)
    attempts: int = 0
    reason: str = ""


class RollbackController:
    def __init__(
        self,
        preflight_retries: int = 1,
        history_token_budget: int = 150,
        max_rollbacks: int = 3,
    ) -> None:
        self.preflight_retries = preflight_retries
        self.history_token_budget = history_token_budget
        # A run that breaches, recovers, and immediately breaches again is not recovering. Without
        # a cap it oscillates until the step budget runs out, burning the demo on a loop.
        self.max_rollbacks = max_rollbacks
        self.rollbacks = 0

    def __call__(self, controller: Any, breach_seq: int) -> bool:
        return self.recover(controller, breach_seq).recovered

    def recover(self, controller: Any, breach_seq: int) -> RollbackOutcome:
        if self.rollbacks >= self.max_rollbacks:
            controller.store.emit(
                "memory_op",
                {
                    "op": "read",
                    "detail": (
                        f"rollback budget exhausted after {self.rollbacks} attempts; halting "
                        "rather than oscillating"
                    ),
                },
                checkpoint_ref=controller.current_checkpoint,
            )
            return RollbackOutcome(False, reason="rollback budget exhausted")

        chain = controller.checkpointer.chain
        candidates = self._targets(chain)
        if not candidates:
            controller.store.emit(
                "memory_op",
                {"op": "read", "detail": "no confirmed checkpoint to roll back to"},
                checkpoint_ref=controller.current_checkpoint,
            )
            return RollbackOutcome(False, reason="no confirmed checkpoint")

        self.rollbacks += 1
        attempts = 0
        for target in candidates[: self.preflight_retries + 1]:
            attempts += 1
            outcome = self._attempt(controller, breach_seq, target, attempts)
            if outcome.recovered:
                return outcome
        return RollbackOutcome(False, attempts=attempts, reason="preflight failed twice")

    def _targets(self, chain: list[Checkpoint]) -> list[Checkpoint]:
        """Confirmed checkpoints, newest first, each with a chain that still validates.

        Only *confirmed* ones qualify: a checkpoint corroborated by no subsequent passing window
        may itself sit inside the corruption.
        """
        out: list[Checkpoint] = []
        for index in range(len(chain) - 1, -1, -1):
            checkpoint = chain[index]
            if checkpoint.confirmed and integrity_check(chain[: index + 1]):
                out.append(checkpoint)
        return out

    def _attempt(
        self, controller: Any, breach_seq: int, target: Checkpoint, attempt: int
    ) -> RollbackOutcome:
        discarded = (target.seq_range[1] + 1, breach_seq)

        controller.task_pack.restore(target.snapshot, controller.workdir)

        # A real agent re-plans from the rebuilt context and naturally redoes the discarded work.
        # A scripted one needs its cursor moved back, or the run resumes with nothing left to do
        # and reports a partial result as success.
        rewind = getattr(controller.adapter, "rewind_to", None)
        if callable(rewind):
            rewind(controller.handle, controller.checkpoint_steps.get(target.id, 0))
            controller.step_count = controller.checkpoint_steps.get(target.id, 0)

        retained_ids: list[str] = []
        evicted: list[dict[str, Any]] = []
        try:
            audit = controller.ledger.audit(
                discarded_range=discarded,
                poison_seqs=controller.store.poison_seqs(),
                injection_seq=controller.store.injection_seq(),
            )
            retained_ids, evicted = audit.retained, audit.evicted
        except Exception as exc:
            controller.store.emit(
                "memory_op",
                {
                    "op": "read",
                    "detail": f"ledger audit failed ({type(exc).__name__}); no knowledge retained",
                },
                checkpoint_ref=target.id,
            )

        rollback_event = controller.store.emit(
            "rollback",
            {
                "from_seq": breach_seq,
                "target_checkpoint_id": target.id,
                "discarded_range": list(discarded),
                "ledger_audit_ref": None,
            },
            checkpoint_ref=target.id,
        )
        audit_event = controller.store.emit(
            "ledger_audit",
            {
                "rollback_ref": rollback_event.seq,
                "retained": retained_ids,
                "evicted": evicted,
            },
            checkpoint_ref=target.id,
        )
        rollback_event.payload["ledger_audit_ref"] = audit_event.seq

        retained = controller.ledger.retrieve()
        self._rebuild_context(controller, target, discarded, retained)
        controller.ledger.mark_used([e.id for e in retained], audit_event.seq)

        controller.current_checkpoint = target.id
        controller.intent = target.intent_digest
        controller.action_descriptions = []
        controller.window_start_seq = controller.store.next_seq
        controller.verifier.reset_escalation()

        passed, preflight_seq = self._preflight(controller, target)
        if passed:
            controller.store.emit(
                "resume",
                {
                    "preflight_verification_ref": preflight_seq,
                    "retained_learnings": len(retained),
                },
                checkpoint_ref=target.id,
            )
            return RollbackOutcome(True, target.id, retained_ids, evicted, attempt)
        return RollbackOutcome(False, target.id, retained_ids, evicted, attempt, "preflight failed")

    def _rebuild_context(
        self, controller: Any, target: Checkpoint, discarded: tuple[int, int], retained: list[Any]
    ) -> None:
        """Rebuild from the digest, not from history. The poisoned range is never replayed."""
        intent = target.intent_digest
        blocks = [
            {
                "role": "system",
                "content": (
                    "You are resuming supervised work after a rollback. The block below is the "
                    "authoritative objective; it supersedes anything you remember."
                ),
            },
            {
                "role": "user",
                "content": (
                    f"OBJECTIVE: {intent.objective}\n"
                    f"CONSTRAINTS:\n"
                    + "\n".join(f"  - {c}" for c in intent.constraints)
                    + "\nDONE WHEN:\n"
                    + "\n".join(f"  - {c}" for c in intent.done_criteria)
                    + "\nOPEN:\n"
                    + "\n".join(f"  - {c}" for c in intent.open_subgoals)
                ),
            },
        ]

        knowledge = controller.ledger.render_block(retained)
        if knowledge:
            blocks.append({"role": "user", "content": knowledge})

        evicted_note = self._eviction_note(controller)
        blocks.append(
            {
                "role": "user",
                "content": (
                    f"ROLLBACK NOTICE: steps {discarded[0]}-{discarded[1]} were discarded and the "
                    f"working tree was restored to checkpoint {target.id}. "
                    f"{evicted_note}Continue from the objective above."
                ),
            }
        )
        controller.adapter.set_context(controller.handle, blocks)

    def _eviction_note(self, controller: Any) -> str:
        """Naming a falsified belief is itself an anti-drift signal."""
        evicted = [e for e in controller.ledger.entries.values() if e.status == "evicted"]
        if not evicted:
            return ""
        first = evicted[0].text
        return (
            f'You previously concluded: "{first}". That conclusion traced to corrupted input and '
            "has been discarded. "
        )

    def _preflight(self, controller: Any, target: Checkpoint) -> tuple[bool, int]:
        """Ask for the next step without executing it, and verify it against the intent.

        Always emits a verification event, so ``resume.preflight_verification_ref`` always points
        at a real one — an event referencing something that is not a verification is worse than no
        reference at all, because the UI trusts it.
        """
        proposal = controller.adapter.step(controller.handle, execute=False)
        if proposal is None:
            # Nothing left to propose. Resuming is trivially aligned, but still on the record.
            event = controller.store.emit(
                "verification",
                {
                    "window": [controller.store.next_seq, controller.store.next_seq],
                    "alignment": 1.0,
                    "repetition": 1.0,
                    "progress": 1.0,
                    "coherence": 1.0,
                    "verdict": "pass",
                    "rationale": "preflight: agent proposed no further step",
                    "violated_constraints": [],
                    "tests_tampered": False,
                },
                checkpoint_ref=target.id,
            )
            return True, event.seq

        judged = controller.verifier.judge_alignment(
            target.intent_digest, f"PROPOSED NEXT STEP: {proposal.description}"
        )
        alignment = float(judged.get("alignment", 0.0))
        passed = alignment >= controller.verifier.thresholds.warn

        event = controller.store.emit(
            "verification",
            {
                "window": [controller.store.next_seq, controller.store.next_seq],
                "alignment": alignment,
                "repetition": 1.0,
                "progress": 1.0,
                "coherence": round(alignment, 4),
                "verdict": "pass" if passed else "breach",
                "rationale": f"preflight: {judged.get('rationale', '')}",
                "violated_constraints": judged.get("violated_constraints", []),
                "tests_tampered": False,
            },
            checkpoint_ref=target.id,
        )
        return passed, event.seq
