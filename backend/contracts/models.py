"""Pydantic mirrors of shared/schema/*.json.

The JSON Schema is canonical; these exist so Python code gets types and validation. A test
round-trips every model through the schema, so the two cannot drift silently.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field

EVENT_TYPES: tuple[str, ...] = (
    "task_start",
    "action",
    "observation",
    "memory_op",
    "verification",
    "checkpoint",
    "breach",
    "rollback",
    "resume",
    "injection",
    "task_complete",
    "learning",
    "ledger_audit",
    "swarm_checkpoint",
    "swarm_verification",
    "bulletin",
    "quarantine",
)

EventType = Literal[
    "task_start",
    "action",
    "observation",
    "memory_op",
    "verification",
    "checkpoint",
    "breach",
    "rollback",
    "resume",
    "injection",
    "task_complete",
    "learning",
    "ledger_audit",
    "swarm_checkpoint",
    "swarm_verification",
    "bulletin",
    "quarantine",
]
Verdict = Literal["pass", "warn", "breach"]
Scenario = Literal["s1", "s2", "s3"]
LearningKind = Literal["fact", "constraint", "failed_approach", "resource", "api_shape"]
Unit = Annotated[float, Field(ge=0.0, le=1.0)]
SeqRange = Annotated[list[int], Field(min_length=2, max_length=2)]


class Frozen(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ProgressResult(Frozen):
    """v3/D2 — replaces the bare float.

    ``score`` counts only the pack's canonical node ids, never pytest's summary line, and
    ``tests_tampered`` is set by hashing ``tests/`` against a shipped baseline. Scenario S3's
    corruption is an edit to the test suite, which is the very thing progress is computed from.
    """

    score: Unit
    per_test: dict[str, Literal["pass", "fail"]] = Field(default_factory=dict)
    tests_tampered: bool = False


class TaskStartPayload(Frozen):
    task: str
    mode: Literal["supervised", "unsupervised"]
    spec_hash: str
    seeded_learnings: int = 0


class ActionPayload(Frozen):
    step: int
    description: str
    tool: str
    args_digest: str
    claims_complete: bool = False
    """v3/D3: forces a verification window so a falsely-satisfied agent cannot end in silence."""


class ObservationPayload(Frozen):
    tool: str
    result_digest: str
    poisoned: bool = False
    progress: ProgressResult | None = None
    """What is ACTUALLY true — measured by the supervisor, not reported by the tool."""
    content: str | None = None
    """What the agent saw, verbatim. The lie is only recoverable from the log if it is stored."""
    agent_progress: ProgressResult | None = None
    """What the agent would conclude. Diverges from ``progress`` exactly when the tool lied."""


class MemoryOpPayload(Frozen):
    op: Literal["read", "write", "compact"]
    detail: str


class VerificationPayload(Frozen):
    window: SeqRange
    alignment: Unit
    repetition: Unit
    progress: Unit
    coherence: Unit
    verdict: Verdict
    rationale: str
    violated_constraints: list[str] = Field(default_factory=list)
    tests_tampered: bool = False


class CheckpointPayload(Frozen):
    id: str
    seq_range: SeqRange
    parent_hash: str
    hash: str
    confirmed: bool = False
    ledger_head: str | None = None


class BreachPayload(Frozen):
    verification_ref: int
    rule_fired: Literal[
        "below_breach_threshold", "two_consecutive_warns", "tests_tampered", "preflight_failed"
    ]


class RollbackPayload(Frozen):
    from_seq: int
    target_checkpoint_id: str
    discarded_range: SeqRange
    ledger_audit_ref: int | None = None


class ResumePayload(Frozen):
    preflight_verification_ref: int
    retained_learnings: int = 0


class InjectionPayload(Frozen):
    scenario: Scenario
    at_step: int
    target_agent: str | None = None


class TaskCompletePayload(Frozen):
    success: bool
    progress: ProgressResult
    steps: int = 0


class LearningPayload(Frozen):
    entry_id: str
    kind: LearningKind
    text: str = Field(max_length=240)
    confidence: Unit
    source_seqs: Annotated[list[int], Field(min_length=1)]
    supersedes: str | None = None


class EvictedEntry(Frozen):
    entry_id: str
    reason: Literal[
        "poisoned_source", "post_injection_window", "superseded_evicted", "cites_evicted"
    ]
    taint_score: Unit


class LedgerAuditPayload(Frozen):
    """Exactly one per rollback — criterion 10's evidence."""

    rollback_ref: int
    retained: list[str] = Field(default_factory=list)
    evicted: list[EvictedEntry] = Field(default_factory=list)


class QuarantinePayload(Frozen):
    entry_id: str
    reason: Literal["window_breached", "contested", "contaminated"]
    blocked_from: list[str] = Field(default_factory=list)


PAYLOAD_MODELS: dict[str, type[BaseModel]] = {
    "task_start": TaskStartPayload,
    "action": ActionPayload,
    "observation": ObservationPayload,
    "memory_op": MemoryOpPayload,
    "verification": VerificationPayload,
    "checkpoint": CheckpointPayload,
    "breach": BreachPayload,
    "rollback": RollbackPayload,
    "resume": ResumePayload,
    "injection": InjectionPayload,
    "task_complete": TaskCompletePayload,
    "learning": LearningPayload,
    "ledger_audit": LedgerAuditPayload,
    "quarantine": QuarantinePayload,
}


class RunEvent(Frozen):
    """One line of the append-only log. WS frame and JSONL line are byte-identical."""

    run_id: str
    seq: int = Field(ge=0)
    ts: str
    type: EventType
    payload: dict[str, Any]
    checkpoint_ref: str | None = None
    agent_id: str | None = None
    swarm_id: str | None = None

    def typed_payload(self) -> BaseModel | None:
        """Validate ``payload`` against the model for this event's ``type``."""
        model = PAYLOAD_MODELS.get(self.type)
        return model.model_validate(self.payload) if model else None


class IntentDigest(Frozen):
    """<=200 tokens. Rendered as the authoritative objective block on rollback."""

    objective: str
    constraints: list[str] = Field(default_factory=list)
    done_criteria: list[str] = Field(default_factory=list)
    key_decisions: list[str] = Field(default_factory=list)
    open_subgoals: list[str] = Field(default_factory=list)


class Snapshot(Frozen):
    file_hashes: dict[str, str]
    """v3/D4: excludes __pycache__/, *.pyc, .pytest_cache/ — else each test run
    adds phantom diffs to the chain."""
    files_ref: str
    scratchpad: str = ""


class Checkpoint(Frozen):
    id: str
    run_id: str
    seq_range: SeqRange
    intent_digest: IntentDigest
    snapshot: Snapshot
    parent_hash: str
    hash: str
    verified: Literal[True] = True
    confirmed: bool = False
    """v3: only confirmed checkpoints are valid rollback targets."""
    ledger_head: str | None = None
    """Reference only — never an input to ``hash``."""


class LedgerEntry(Frozen):
    id: str
    run_id: str
    agent_id: str | None = None
    kind: LearningKind
    text: str = Field(max_length=240)
    confidence: Unit
    source_seqs: Annotated[list[int], Field(min_length=1)]
    minted_at_seq: int
    checkpoint_ref: str | None = None
    status: Literal["clean", "suspect", "evicted"] = "clean"
    status_reason: str | None = None
    supersedes: str | None = None
    superseded_by: str | None = None
    uses: list[dict[str, Any]] = Field(default_factory=list)
    scope: Literal["run", "task_pack"] = "run"
    admitted_from_verdict: Verdict = "pass"
