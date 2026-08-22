"""Mints hash-chained checkpoints of verified-coherent states.

A checkpoint is (compressed intent, workdir snapshot), linked to its parent by hash. Two invariants
carry the design:

**Minted only after a passing verification** — so checkpoints are last-known-good by construction
rather than by inspection.

**Confirmed only once the NEXT window also passes** — and only confirmed checkpoints are valid
rollback targets. Review proved this is load-bearing rather than belt-and-braces: rolling back to
the *latest* checkpoint means the discarded range contains only warn/breach windows, which admitted
no learnings, so the retained-knowledge set would be empty by construction and the non-amnesic
mechanism a no-op. It independently fixes a latent bug in which the supervisor restores a snapshot
minted *after* the injection landed — rolling back into the corruption.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.contracts import (
    Checkpoint,
    IntentDigest,
    Snapshot,
    checkpoint_hash,
    genesis_parent_hash,
)

COMPRESS_SYSTEM = """You compress an agent's working state into a compact intent digest.

Return JSON only:
{
  "objective": "<one sentence: what the agent is trying to achieve>",
  "constraints": [<every hard constraint, copied VERBATIM from the spec, plus any accumulated>],
  "done_criteria": [<how completion is judged>],
  "key_decisions": [<choices already made that later steps depend on>],
  "open_subgoals": [<what remains>]
}

Total under 200 tokens. Constraints must be verbatim — this digest becomes the authoritative
objective the agent is re-anchored to after a rollback, and a paraphrased constraint is a lost one.
"""


class Checkpointer:
    def __init__(self, provider: Any, runs_dir: Path, model: str | None = None) -> None:
        self.provider = provider
        self.runs_dir = Path(runs_dir)
        self.model = model
        self.chain: list[Checkpoint] = []

    def genesis(self, task_spec: str) -> str:
        return genesis_parent_hash(task_spec)

    def compress_intent(
        self,
        task_spec: str,
        recent_events: list[dict[str, Any]],
        fallback: IntentDigest | None = None,
    ) -> IntentDigest:
        """One provider call, temperature 0. Falls back to the previous digest on failure —
        a checkpoint with a stale-but-valid intent beats no checkpoint at all."""
        transcript = "\n".join(
            f"[{e.get('seq')}] {e.get('type')}: {json.dumps(e.get('payload', {}))[:200]}"
            for e in recent_events[-40:]
        )
        messages = [
            {"role": "system", "content": COMPRESS_SYSTEM},
            {"role": "user", "content": f"TASK SPEC:\n{task_spec}\n\nRECENT EVENTS:\n{transcript}"},
        ]
        try:
            data = self.provider.complete_json(messages, model=self.model)
            return IntentDigest(
                objective=str(data.get("objective", ""))[:400],
                constraints=[str(x) for x in (data.get("constraints") or [])][:8],
                done_criteria=[str(x) for x in (data.get("done_criteria") or [])][:6],
                key_decisions=[str(x) for x in (data.get("key_decisions") or [])][:6],
                open_subgoals=[str(x) for x in (data.get("open_subgoals") or [])][:6],
            )
        except Exception:
            if fallback is not None:
                return fallback
            return IntentDigest(
                objective=task_spec.strip().splitlines()[0][:400] if task_spec else ""
            )

    def mint(
        self,
        run_id: str,
        seq_range: tuple[int, int],
        intent: IntentDigest,
        snapshot: Snapshot,
        ledger_head: str | None = None,
    ) -> Checkpoint:
        """Link a new checkpoint to the chain. Callers invoke this ONLY after a passing window."""
        parent = self.chain[-1].hash if self.chain else genesis_parent_hash(intent.objective)
        checkpoint_id = f"ckpt-{len(self.chain) + 1:02d}"
        digest = checkpoint_hash(parent, intent.model_dump(), snapshot.file_hashes, list(seq_range))
        checkpoint = Checkpoint(
            id=checkpoint_id,
            run_id=run_id,
            seq_range=list(seq_range),
            intent_digest=intent,
            snapshot=snapshot,
            parent_hash=parent,
            hash=digest,
            verified=True,
            confirmed=False,
            ledger_head=ledger_head,
        )
        self.chain.append(checkpoint)
        return checkpoint

    def confirm_previous_excluding(self, exclude_id: str) -> Checkpoint | None:
        """Confirm the newest unconfirmed checkpoint other than ``exclude_id``.

        Called when a window passes: that pass is the evidence the PRECEDING checkpoint was sound,
        so it becomes a valid rollback target. The checkpoint just minted is not yet confirmed —
        nothing has corroborated it.
        """
        for index in range(len(self.chain) - 1, -1, -1):
            checkpoint = self.chain[index]
            if checkpoint.confirmed or checkpoint.id == exclude_id:
                continue
            confirmed = checkpoint.model_copy(update={"confirmed": True})
            self.chain[index] = confirmed
            return confirmed
        return None

    def latest_confirmed(self) -> Checkpoint | None:
        """The rollback target: the newest confirmed checkpoint whose chain still validates."""
        for checkpoint in reversed(self.chain):
            if not checkpoint.confirmed:
                continue
            prefix = self.chain[: self.chain.index(checkpoint) + 1]
            if integrity_check(prefix):
                return checkpoint
        return None

    def snapshot_dir(self, run_id: str, checkpoint_id: str) -> Path:
        return self.runs_dir / run_id / "snapshots" / checkpoint_id


def integrity_check(chain: list[Checkpoint]) -> bool:
    """Walk from genesis recomputing every hash. Any tampered link breaks the walk."""
    parent: str | None = None
    for checkpoint in chain:
        if parent is not None and checkpoint.parent_hash != parent:
            return False
        expected = checkpoint_hash(
            checkpoint.parent_hash,
            checkpoint.intent_digest.model_dump(),
            checkpoint.snapshot.file_hashes,
            list(checkpoint.seq_range),
        )
        if expected != checkpoint.hash:
            return False
        parent = checkpoint.hash
    return True
