"""The JSON Schema is canonical; the pydantic models mirror it.

These tests exist to make silent drift impossible: every model is round-tripped through the
schema, and the enums are compared element-wise.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

from backend.contracts import (
    EVENT_TYPES,
    Checkpoint,
    IntentDigest,
    LedgerEntry,
    RunEvent,
    Snapshot,
    canonical_json,
    checkpoint_hash,
    genesis_parent_hash,
    ledger_entry_id,
    normalize_text,
)

SCHEMA_DIR = Path(__file__).resolve().parents[3] / "shared" / "schema"


def _validator(name: str) -> Draft202012Validator:
    schema = json.loads((SCHEMA_DIR / name).read_text())
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


EVENT = _validator("run_event.schema.json")
CHECKPOINT = _validator("checkpoint.schema.json")
LEDGER = _validator("ledger_entry.schema.json")


def _event(**kw) -> dict:
    base = {
        "run_id": "run-1",
        "seq": 0,
        "ts": "2026-08-22T19:00:00Z",
        "type": "task_start",
        "payload": {"task": "loglens", "mode": "supervised", "spec_hash": "ab" * 32},
    }
    base.update(kw)
    return base


# --- enum parity -----------------------------------------------------------------


def test_event_type_enum_matches_schema_exactly() -> None:
    schema = json.loads((SCHEMA_DIR / "run_event.schema.json").read_text())
    assert list(EVENT_TYPES) == schema["$defs"]["EventType"]["enum"]


def test_learning_kind_enum_matches_across_both_schemas() -> None:
    ev = json.loads((SCHEMA_DIR / "run_event.schema.json").read_text())
    le = json.loads((SCHEMA_DIR / "ledger_entry.schema.json").read_text())
    assert ev["$defs"]["LearningKind"]["enum"] == le["properties"]["kind"]["enum"]


# --- round trips -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("etype", "payload"),
    [
        (
            "action",
            {"step": 1, "description": "read module", "tool": "read_file", "args_digest": "d"},
        ),
        ("observation", {"tool": "run_tests", "result_digest": "d", "poisoned": False}),
        ("memory_op", {"op": "compact", "detail": "context compacted"}),
        (
            "verification",
            {
                "window": [1, 5],
                "alignment": 0.9,
                "repetition": 1.0,
                "progress": 1.0,
                "coherence": 0.94,
                "verdict": "pass",
                "rationale": "on task",
            },
        ),
        ("breach", {"verification_ref": 12, "rule_fired": "two_consecutive_warns"}),
        (
            "rollback",
            {"from_seq": 30, "target_checkpoint_id": "ckpt-2", "discarded_range": [16, 30]},
        ),
        ("resume", {"preflight_verification_ref": 31, "retained_learnings": 4}),
        ("injection", {"scenario": "s2", "at_step": 9}),
        (
            "learning",
            {
                "entry_id": "0" * 16,
                "kind": "failed_approach",
                "text": "rewriting the whole file drops module constants",
                "confidence": 0.5,
                "source_seqs": [11, 12],
            },
        ),
        (
            "ledger_audit",
            {
                "rollback_ref": 30,
                "retained": ["a" * 16],
                "evicted": [
                    {"entry_id": "b" * 16, "reason": "poisoned_source", "taint_score": 0.85}
                ],
            },
        ),
    ],
)
def test_payload_validates_in_schema_and_model(etype: str, payload: dict) -> None:
    raw = _event(type=etype, payload=payload, seq=5)
    EVENT.validate(raw)
    assert RunEvent.model_validate(raw).typed_payload() is not None


def test_pydantic_dump_revalidates_against_schema() -> None:
    """A model serialized by pydantic must satisfy the canonical schema."""
    raw = _event(type="observation", payload={"tool": "t", "result_digest": "d", "poisoned": True})
    EVENT.validate(RunEvent.model_validate(raw).model_dump(mode="json"))


def test_checkpoint_round_trips() -> None:
    digest = IntentDigest(objective="make the suite pass", constraints=["do not edit tests"])
    snap = Snapshot(file_hashes={"loglens/ingest.py": "aa"}, files_ref="runs/r/snap/c1")
    parent = genesis_parent_hash("spec")
    ckpt = Checkpoint(
        id="ckpt-1",
        run_id="run-1",
        seq_range=[0, 10],
        intent_digest=digest,
        snapshot=snap,
        parent_hash=parent,
        hash=checkpoint_hash(parent, digest.model_dump(), snap.file_hashes, [0, 10]),
    )
    CHECKPOINT.validate(ckpt.model_dump(mode="json"))


def test_ledger_entry_round_trips() -> None:
    entry = LedgerEntry(
        id=ledger_entry_id("run-1", 12, "fact", "conftest supplies the fixture"),
        run_id="run-1",
        kind="fact",
        text="conftest supplies the fixture",
        confidence=0.8,
        source_seqs=[11, 12],
        minted_at_seq=12,
    )
    LEDGER.validate(entry.model_dump(mode="json"))


# --- schema actually rejects things ----------------------------------------------


def test_unknown_event_type_is_rejected() -> None:
    with pytest.raises(ValidationError):
        EVENT.validate(_event(type="not_a_real_type"))


def test_wrong_payload_for_type_is_rejected() -> None:
    """The discriminated allOf must bite, not just pass everything through."""
    with pytest.raises(ValidationError):
        EVENT.validate(_event(type="breach", payload={"nonsense": 1}))


def test_coherence_out_of_range_is_rejected() -> None:
    bad = _event(
        type="verification",
        payload={
            "window": [1, 5],
            "alignment": 0.9,
            "repetition": 1.0,
            "progress": 1.0,
            "coherence": 1.4,
            "verdict": "pass",
            "rationale": "x",
        },
    )
    with pytest.raises(ValidationError):
        EVENT.validate(bad)


def test_extra_envelope_field_is_rejected() -> None:
    with pytest.raises(ValidationError):
        EVENT.validate(_event(surprise="field"))


# --- hashing invariants ----------------------------------------------------------


def test_canonical_json_is_order_independent() -> None:
    assert canonical_json({"b": 1, "a": 2}) == canonical_json({"a": 2, "b": 1})
    assert " " not in canonical_json({"a": 1, "b": [1, 2]})


def test_ledger_id_ignores_case_and_whitespace_but_not_content() -> None:
    a = ledger_entry_id("r", 1, "fact", "The  Harness IMPORTS from conftest")
    b = ledger_entry_id("r", 1, "fact", "the harness imports from conftest")
    c = ledger_entry_id("r", 1, "fact", "the harness imports from setup.py")
    assert a == b and a != c
    assert normalize_text("A  B ") == "a b"


def test_ledger_id_is_stable_under_status_change() -> None:
    """Status mutates over an entry's life; the id must not, or taint would re-key entries."""
    entry = LedgerEntry(
        id=ledger_entry_id("r", 3, "fact", "x marks the spot"),
        run_id="r",
        kind="fact",
        text="x marks the spot",
        confidence=0.9,
        source_seqs=[3],
        minted_at_seq=3,
    )
    before = entry.id
    evicted = entry.model_copy(update={"status": "evicted", "confidence": 0.1})
    assert evicted.id == before
    assert ledger_entry_id("r", 3, "fact", "x marks the spot") == before


def test_checkpoint_hash_excludes_ledger_head() -> None:
    """A later eviction moves the ledger head; it must not invalidate the chain."""
    digest = {"objective": "o"}
    files = {"a.py": "ff"}
    parent = genesis_parent_hash("spec")
    assert checkpoint_hash(parent, digest, files, [0, 5]) == checkpoint_hash(
        parent, digest, files, [0, 5]
    )
    assert checkpoint_hash(parent, digest, files, [0, 5]) != checkpoint_hash(
        parent, digest, {"a.py": "ee"}, [0, 5]
    )


def test_chain_detects_a_tampered_link() -> None:
    genesis = genesis_parent_hash("spec")
    h1 = checkpoint_hash(genesis, {"objective": "o"}, {"a.py": "1"}, [0, 5])
    h2 = checkpoint_hash(h1, {"objective": "o"}, {"a.py": "2"}, [6, 10])
    tampered = checkpoint_hash(genesis, {"objective": "o"}, {"a.py": "MUTATED"}, [0, 5])
    assert checkpoint_hash(tampered, {"objective": "o"}, {"a.py": "2"}, [6, 10]) != h2
