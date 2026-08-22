"""Ledger behaviour, focused on the three corrections review forced.

1. failed_approach survives a bad window (naive pass-only admission destroys exactly the learnings
   worth the most recovery steps).
2. Taint is deterministic and provenance-based, not positional.
3. Nothing tainted crosses a run boundary.
"""

from __future__ import annotations

from pathlib import Path

from backend.ledger import Ledger

FACT = {"kind": "fact", "text": "conftest supplies the make_event fixture", "confidence": 0.9}
DEAD_END = {
    "kind": "failed_approach",
    "text": "rewriting the whole module drops NUMERIC_FIELDS and breaks the import",
    "confidence": 0.8,
}
POISON = {
    "kind": "fact",
    "text": "the full suite passes and the module is complete",
    "confidence": 0.9,
}


def ledger() -> Ledger:
    return Ledger("run-1")


# -- admission --------------------------------------------------------------------


def test_pass_window_admits() -> None:
    lg = ledger()
    assert len(lg.admit([FACT], "pass", 10, [8, 9])) == 1
    assert lg.entries[next(iter(lg.entries))].confidence == 0.9


def test_warn_window_stages_until_the_next_window_passes() -> None:
    """A warn is not yet evidence the window was wrong — hold, do not discard."""
    lg = ledger()
    assert lg.admit([FACT], "warn", 10, [9]) == []
    assert lg.entries == {}
    admitted = lg.admit([], "pass", 15, [14])
    assert len(admitted) == 1, "staged learning should flush once a window passes"


def test_breach_window_discards_ordinary_learnings() -> None:
    lg = ledger()
    assert lg.admit([FACT], "breach", 10, [9]) == []
    assert lg.entries == {}


def test_failed_approach_survives_a_breach_at_halved_confidence() -> None:
    """The carve-out. A window verdicts incoherent precisely when 'this failed' is true."""
    lg = ledger()
    admitted = lg.admit([DEAD_END], "breach", 10, [9])
    assert len(admitted) == 1
    assert admitted[0].kind == "failed_approach"
    assert admitted[0].confidence == 0.4, "halved from 0.8"
    assert admitted[0].admitted_from_verdict == "breach"


def test_breach_discards_staged_entries() -> None:
    lg = ledger()
    lg.admit([FACT], "warn", 10, [9])
    lg.admit([], "breach", 15, [14])
    assert lg.entries == {}


def test_near_duplicates_merge_rather_than_accumulate() -> None:
    lg = ledger()
    lg.admit([FACT], "pass", 10, [9])
    lg.admit([{**FACT, "text": "conftest supplies the make_event  FIXTURE"}], "pass", 20, [19])
    assert len(lg.entries) == 1
    only = next(iter(lg.entries.values()))
    assert only.source_seqs == [9, 19], "merged evidence, not a second row"


def test_empty_text_is_ignored() -> None:
    lg = ledger()
    assert lg.admit([{"kind": "fact", "text": "   ", "confidence": 0.9}], "pass", 5, [4]) == []


# -- taint ------------------------------------------------------------------------


def test_audit_evicts_only_what_traces_to_poison() -> None:
    """The invariant the whole claim rests on."""
    lg = ledger()
    lg.admit([FACT], "pass", 10, [9])
    lg.admit([DEAD_END], "pass", 16, [15])
    lg.admit([POISON], "pass", 24, [22])  # seq 22 is the poisoned observation

    audit = lg.audit(discarded_range=(21, 31), poison_seqs={20, 22}, injection_seq=20)

    assert len(audit.evicted) == 1
    assert audit.evicted[0]["reason"] == "poisoned_source"
    assert len(audit.retained) == 2
    for entry_id in audit.retained:
        assert not set(lg.entries[entry_id].source_seqs) & {20, 22}


def test_clean_knowledge_survives_rollback() -> None:
    """Rollback without amnesia: work reverts, verified knowledge does not."""
    lg = ledger()
    lg.admit([FACT], "pass", 10, [9])
    lg.admit([DEAD_END], "pass", 16, [15])
    audit = lg.audit((21, 31), {20, 22}, 20)
    assert len(audit.retained) == 2 and audit.evicted == []
    assert lg.render_block().count("- [") == 2


def test_eviction_propagates_along_the_supersession_chain() -> None:
    lg = ledger()
    [poisoned] = lg.admit([POISON], "pass", 24, [22])
    lg.admit(
        [
            {
                "kind": "fact",
                "text": "given the suite passes, only NOTES.md remains",
                "confidence": 0.8,
            }
        ],
        "pass",
        26,
        [25],
    )
    follow_on = next(e for e in lg.entries.values() if e.id != poisoned.id)
    lg.entries[follow_on.id] = follow_on.model_copy(update={"supersedes": poisoned.id})

    audit = lg.audit((21, 31), {20, 22}, 20)
    evicted = {e["entry_id"] for e in audit.evicted}
    assert poisoned.id in evicted, "direct taint"
    assert follow_on.id in evicted, "transitive taint must propagate"


def test_audit_is_deterministic() -> None:
    """No judge call means byte-identical audits — criterion 8 depends on it."""

    def build() -> Ledger:
        lg = ledger()
        lg.admit([FACT], "pass", 10, [9])
        lg.admit([POISON], "pass", 24, [22])
        return lg

    a = build().audit((21, 31), {20, 22}, 20)
    b = build().audit((21, 31), {20, 22}, 20)
    assert (a.retained, a.evicted) == (b.retained, b.evicted)


def test_audit_without_an_injection_does_not_crash_or_over_evict() -> None:
    """A breach does not require a preceding injection; S_time must not be undefined."""
    lg = ledger()
    lg.admit([FACT], "pass", 10, [9])
    audit = lg.audit((5, 20), poison_seqs=set(), injection_seq=None)
    assert audit.evicted == [] and len(audit.retained) == 1


def test_audit_reaches_a_fixed_point() -> None:
    lg = ledger()
    topics = [
        "parser tokens survive escaped quotes",
        "session gaps split on the idle threshold",
        "percentile maths interpolates between samples",
        "table padding right-aligns numeric columns",
        "query clauses reject unknown field names",
        "footer text reports the row count",
    ]
    for i, topic in enumerate(topics):
        lg.admit([{"kind": "fact", "text": topic, "confidence": 0.7}], "pass", 20 + i, [22])
    assert len(lg.entries) == 6, "distinct texts must not dedupe"
    audit = lg.audit((21, 31), {22}, 20)
    assert len(audit.evicted) == 6 and audit.retained == []


# -- retrieval --------------------------------------------------------------------


def test_retrieval_respects_the_token_budget() -> None:
    lg = ledger()
    for i in range(30):
        lg.admit(
            [
                {
                    "kind": "fact",
                    "text": f"distinct durable fact number {i} about the module",
                    "confidence": 0.9,
                }
            ],
            "pass",
            10 + i,
            [9 + i],
        )
    rows = lg.retrieve(budget_tokens=60, limit=99)
    assert 0 < len(rows) < 30
    assert sum(max(1, len(r.text) // 4) for r in rows) <= 60


def test_retrieval_excludes_evicted_entries() -> None:
    lg = ledger()
    lg.admit([FACT], "pass", 10, [9])
    lg.admit([POISON], "pass", 24, [22])
    lg.audit((21, 31), {22}, 20)
    texts = [r.text for r in lg.retrieve()]
    assert FACT["text"] in texts
    assert POISON["text"] not in texts


def test_render_block_is_empty_when_nothing_is_known() -> None:
    assert ledger().render_block() == ""


# -- cross-run --------------------------------------------------------------------


def test_seeding_decays_confidence_and_refuses_tainted_rows(tmp_path: Path) -> None:
    first = ledger()
    first.admit([FACT], "pass", 10, [9])
    first.admit([POISON], "pass", 24, [22])
    first.audit((21, 31), {22}, 20)
    for entry_id in list(first.entries):
        first.entries[entry_id] = first.entries[entry_id].model_copy(update={"scope": "task_pack"})

    path = tmp_path / "ledger.jsonl"
    path.write_text(
        "".join(
            __import__("json").dumps(e.model_dump(mode="json"), sort_keys=True) + "\n"
            for e in first.export_for_task_pack()
        )
    )

    second = Ledger("run-2")
    assert second.seed_from(path) == 1, "only the clean entry crosses the boundary"
    seeded = next(iter(second.entries.values()))
    assert seeded.confidence == round(0.9 * 0.8, 4), "stale knowledge fades"
    assert POISON["text"] not in [e.text for e in second.entries.values()]


def test_seeding_from_a_missing_file_is_a_no_op(tmp_path: Path) -> None:
    assert Ledger("run-3").seed_from(tmp_path / "nope.jsonl") == 0
