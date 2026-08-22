"""Accumulated knowledge, separated from work state.

Dhruva's rollback restores a checkpointed *workdir*. Left alone, that also destroys everything the
agent legitimately learned in the discarded range — it re-derives the same facts and often re-walks
the same dead ends. So knowledge lives here instead: append-only, taint-tracked, and reverted by
provenance rather than by position.

Three rules carry the design, each one a correction found by review:

**Admission mirrors the checkpoint invariant** — learnings are admitted from passing windows, so
knowledge is last-known-good by construction. With one carve-out: ``failed_approach`` is admitted
from ANY verdict at halved confidence. Naive pass-only admission is anti-correlated with value,
because a window verdicts incoherent precisely when "this approach fails" is true and most worth
keeping; the deepest dead ends, worth the most recovery steps, were the ones guaranteed to be lost.

**Taint is deterministic** — no judge call. A model call on the rollback path would put dead air and
a failure mode on the highest-risk mechanism, and would convert judge noise into agent-trajectory
divergence, making criterion 8's "identical traces twice" strictly harder.

**Entry ids cover immutable fields only** — ``status`` and ``confidence`` mutate, so hashing them
would re-key an entry the moment it was evicted.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, cast

from rapidfuzz.distance import Levenshtein

from backend.contracts import LedgerEntry, ledger_entry_id, normalize_text
from backend.verifier.thresholds import Thresholds, load_thresholds


@dataclass
class TaintAudit:
    """Result of one rollback's audit. Becomes the ``ledger_audit`` event."""

    retained: list[str] = field(default_factory=list)
    evicted: list[dict[str, Any]] = field(default_factory=list)

    @property
    def counts(self) -> tuple[int, int]:
        return len(self.retained), len(self.evicted)


def taint_score(
    entry: LedgerEntry,
    poison_seqs: set[int],
    injection_seq: int | None,
    evicted_ids: set[int] | set[str],
    weights: dict[str, float],
) -> tuple[float, str]:
    """Deterministic taint. Returns (score, dominant reason).

    struct — the entry cites a poisoned observation or the injection itself
    time   — how much of its evidence postdates the injection
    dep    — it builds on something already evicted
    """
    struct = 1.0 if set(entry.source_seqs) & poison_seqs else 0.0

    if injection_seq is None:
        time = 0.0  # never undefined: a breach does not require a preceding injection
    else:
        after = [s for s in entry.source_seqs if s >= injection_seq]
        time = len(after) / max(1, len(entry.source_seqs))

    dep = 1.0 if (entry.supersedes and entry.supersedes in evicted_ids) else 0.0

    # Provenance is certainty, not evidence to be weighed. An entry that cites a poisoned
    # observation, or that builds on something already evicted, IS contaminated — inheriting a
    # falsehood makes you false. Both saturate the score so the transitive closure actually closes.
    if struct or dep:
        return 1.0, ("poisoned_source" if struct else "superseded_evicted")

    # Position alone is deliberately NOT enough to evict: `time` maxes at its own weight, which is
    # below the cutoff. A learning minted after the injection but sourced from clean observations is
    # genuine knowledge, and discarding it is precisely the amnesia this design exists to prevent.
    score = weights["struct"] * struct + weights["time"] * time + weights["dep"] * dep
    return round(score, 4), "post_injection_window"


class Ledger:
    """Append-only store of learnings for one run."""

    def __init__(self, run_id: str, thresholds: Thresholds | None = None) -> None:
        self.run_id = run_id
        self.thresholds = thresholds or load_thresholds()
        self.entries: dict[str, LedgerEntry] = {}
        self._order: list[str] = []
        self._staged: list[tuple[dict[str, Any], int, list[int]]] = []

    # -- admission ------------------------------------------------------------

    @property
    def _cfg(self) -> dict[str, Any]:
        return self.thresholds.ledger

    def admit(
        self,
        candidates: list[dict[str, Any]],
        verdict: str,
        minted_at_seq: int,
        source_seqs: list[int],
        checkpoint_ref: str | None = None,
    ) -> list[LedgerEntry]:
        """Admit a window's candidate learnings under the verdict rule.

        pass  -> admit, and flush anything staged by a preceding warn
        warn  -> stage (a warn is not yet evidence the window was wrong)
        breach-> discard, EXCEPT failed_approach, which is the most valuable thing a bad window
                 produces and is admitted at halved confidence
        """
        admitted: list[LedgerEntry] = []
        factor = float(self._cfg.get("failed_approach_confidence_factor", 0.5))

        if verdict == "pass":
            for cand, seq, srcs in self._staged:
                admitted.extend(self._insert(cand, seq, srcs, checkpoint_ref, "warn", 1.0))
            self._staged.clear()
            for cand in candidates:
                admitted.extend(
                    self._insert(cand, minted_at_seq, source_seqs, checkpoint_ref, "pass", 1.0)
                )
            return admitted

        if verdict == "warn":
            for cand in candidates:
                if cand.get("kind") == "failed_approach":
                    admitted.extend(
                        self._insert(
                            cand, minted_at_seq, source_seqs, checkpoint_ref, "warn", factor
                        )
                    )
                else:
                    self._staged.append((cand, minted_at_seq, list(source_seqs)))
            return admitted

        # breach
        self._staged.clear()
        for cand in candidates:
            if cand.get("kind") == "failed_approach":
                admitted.extend(
                    self._insert(cand, minted_at_seq, source_seqs, checkpoint_ref, "breach", factor)
                )
        return admitted

    def _insert(
        self,
        cand: dict[str, Any],
        minted_at_seq: int,
        source_seqs: list[int],
        checkpoint_ref: str | None,
        verdict: str,
        confidence_factor: float,
    ) -> list[LedgerEntry]:
        text = str(cand.get("text", "")).strip()
        if not text:
            return []
        kind = cand.get("kind", "fact")
        confidence = max(0.0, min(1.0, float(cand.get("confidence", 0.6)) * confidence_factor))

        duplicate = self._find_near_duplicate(text)
        if duplicate is not None:
            merged = sorted(set(duplicate.source_seqs) | set(source_seqs))
            self.entries[duplicate.id] = duplicate.model_copy(
                update={
                    "source_seqs": merged,
                    "confidence": min(1.0, round(duplicate.confidence + 0.05, 4)),
                }
            )
            return []

        entry = LedgerEntry(
            id=ledger_entry_id(self.run_id, minted_at_seq, kind, text),
            run_id=self.run_id,
            kind=kind,
            text=text[:240],
            confidence=round(confidence, 4),
            source_seqs=sorted(set(source_seqs)) or [minted_at_seq],
            minted_at_seq=minted_at_seq,
            checkpoint_ref=checkpoint_ref,
            admitted_from_verdict=cast("Literal['pass', 'warn', 'breach']", verdict),
        )
        if entry.id in self.entries:
            return []
        self.entries[entry.id] = entry
        self._order.append(entry.id)
        return [entry]

    def _find_near_duplicate(self, text: str) -> LedgerEntry | None:
        threshold = float(self._cfg.get("dedupe_similarity", 0.85))
        needle = normalize_text(text)
        for entry in self.entries.values():
            if entry.status == "evicted":
                continue
            if Levenshtein.normalized_similarity(needle, normalize_text(entry.text)) >= threshold:
                return entry
        return None

    # -- taint ----------------------------------------------------------------

    def audit(
        self,
        discarded_range: tuple[int, int],
        poison_seqs: set[int],
        injection_seq: int | None,
    ) -> TaintAudit:
        """Partition knowledge into retained and evicted. Pure, synchronous, no I/O.

        Runs to a fixed point so eviction propagates along the supersession chain. The chain is
        acyclic by construction (an entry can only supersede one minted before it), so this
        terminates in at most len(entries) passes.
        """
        weights = self._cfg.get("taint_weights", {"struct": 0.6, "time": 0.25, "dep": 0.15})
        cutoff = float(self._cfg.get("evict_at", 0.5))
        low, high = discarded_range

        audit = TaintAudit()
        evicted_ids: set[str] = set()

        changed = True
        while changed:
            changed = False
            for entry_id in self._order:
                entry = self.entries[entry_id]
                if entry.status == "evicted" or entry_id in evicted_ids:
                    continue
                in_range = low <= entry.minted_at_seq <= high
                touches_poison = bool(set(entry.source_seqs) & poison_seqs)
                builds_on_evicted = bool(entry.supersedes and entry.supersedes in evicted_ids)
                if not (in_range or touches_poison or builds_on_evicted):
                    continue
                score, reason = taint_score(entry, poison_seqs, injection_seq, evicted_ids, weights)
                if score >= cutoff:
                    evicted_ids.add(entry_id)
                    self.entries[entry_id] = entry.model_copy(
                        update={"status": "evicted", "status_reason": reason}
                    )
                    audit.evicted.append(
                        {"entry_id": entry_id, "reason": reason, "taint_score": score}
                    )
                    changed = True

        audit.retained = [eid for eid in self._order if self.entries[eid].status == "clean"]
        return audit

    # -- retrieval ------------------------------------------------------------

    def retrieve(
        self, budget_tokens: int | None = None, limit: int | None = None
    ) -> list[LedgerEntry]:
        """Clean entries ranked by confidence x recency x use, capped by a token budget."""
        budget = budget_tokens or int(self._cfg.get("retrieval_token_budget", 250))
        cap = limit or int(self._cfg.get("max_retrieved", 8))
        clean = [self.entries[e] for e in self._order if self.entries[e].status == "clean"]
        if not clean:
            return []
        newest = max(e.minted_at_seq for e in clean) or 1

        def rank(e: LedgerEntry) -> float:
            recency = (e.minted_at_seq + 1) / (newest + 1)
            return e.confidence * (0.5 + 0.5 * recency) * (1 + 0.1 * len(e.uses))

        ordered = sorted(clean, key=rank, reverse=True)
        chosen: list[LedgerEntry] = []
        spent = 0
        for entry in ordered:
            cost = max(1, len(entry.text) // 4)  # ~4 chars/token
            if len(chosen) >= cap or spent + cost > budget:
                break
            chosen.append(entry)
            spent += cost
        return chosen

    def render_block(self, entries: list[LedgerEntry] | None = None) -> str:
        """The retained-knowledge block injected into a reconstructed context."""
        rows = entries if entries is not None else self.retrieve()
        if not rows:
            return ""
        lines = ["VERIFIED KNOWLEDGE (carried across the rollback, independently confirmed):"]
        lines += [f"- [{e.kind}] {e.text}" for e in rows]
        return "\n".join(lines)

    def mark_used(self, entry_ids: list[str], at_seq: int, agent_id: str | None = None) -> None:
        for eid in entry_ids:
            entry = self.entries.get(eid)
            if entry is not None:
                uses = [*entry.uses, {"agent_id": agent_id, "at_seq": at_seq}]
                self.entries[eid] = entry.model_copy(update={"uses": uses})

    # -- persistence ----------------------------------------------------------

    def to_jsonl(self) -> str:
        return "".join(
            json.dumps(self.entries[e].model_dump(mode="json"), sort_keys=True) + "\n"
            for e in self._order
        )

    def write(self, path: Path) -> None:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        Path(path).write_text(self.to_jsonl())

    def export_for_task_pack(self) -> list[LedgerEntry]:
        """Clean entries eligible to seed a future run."""
        return [
            self.entries[e]
            for e in self._order
            if self.entries[e].status == "clean" and self.entries[e].scope == "task_pack"
        ]

    def seed_from(self, path: Path) -> int:
        """Seed from a prior run's ledger, decaying confidence so stale knowledge fades.

        Nothing tainted crosses a run boundary: only ``clean`` rows are written out, and they are
        re-scored here rather than trusted at full strength.
        """
        target = Path(path)
        if not target.is_file():
            return 0
        decay = float(self._cfg.get("cross_run_decay", 0.8))
        seeded = 0
        for line in target.read_text().splitlines():
            if not line.strip():
                continue
            raw = json.loads(line)
            if raw.get("status") != "clean":
                continue
            raw["confidence"] = round(float(raw.get("confidence", 0.6)) * decay, 4)
            raw["run_id"] = self.run_id
            raw["scope"] = "task_pack"
            entry = LedgerEntry.model_validate(raw)
            if entry.id not in self.entries:
                self.entries[entry.id] = entry
                self._order.append(entry.id)
                seeded += 1
        return seeded
