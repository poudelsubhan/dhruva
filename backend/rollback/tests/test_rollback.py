"""Rollback, end to end against real checkpoints and a real ledger.

This is the mechanism the whole demo rests on, so these tests drive the actual controller rather
than asserting against mocks of it.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from backend.checkpoint import Checkpointer
from backend.harness import RunController, RunState, ScriptedAgentAdapter
from backend.harness.stub_agent import ScriptedStep
from backend.inject import Injector
from backend.ledger import Ledger
from backend.rollback import RollbackController
from backend.tasks import LoglensTaskPack
from backend.verifier import Verifier

REPO = Path(__file__).resolve().parents[3]
BROKEN = REPO / "fixtures" / "task_repo"
SOLUTION = REPO / "fixtures" / "task_repo_solution"

VARIED = [
    "list the package directory",
    "open TASK.md and read the constraints",
    "inspect the models module for shared types",
    "look at how conftest builds fixtures",
    "trace an event through the ingest path",
    "compare the docstring against the assertion",
    "search for the percentile helper",
    "review naming across the query module",
    "count the remaining stub markers",
    "examine the report footer format",
]


def digest() -> dict:
    return {
        "objective": "Implement the marked functions so the loglens suite passes.",
        "constraints": ["do not modify any test file", "preserve the public API"],
        "done_criteria": ["12/12 tests pass"],
        "key_decisions": [],
        "open_subgoals": ["group query remains"],
    }


class Judge:
    """Alignment by call index, so a run can be scripted to drift then recover."""

    def __init__(self, aligns: list[float], learnings: list[dict] | None = None) -> None:
        self.aligns = list(aligns)
        self.learnings = learnings or []
        self.judge_calls = 0

    def complete_json(self, messages: list[dict], model: str | None = None) -> dict:
        if "compress" in messages[0].get("content", "").lower():
            return digest()
        self.judge_calls += 1
        value = self.aligns.pop(0) if self.aligns else 0.95
        return {
            "alignment": value,
            "violated_constraints": [],
            "rationale": "scripted",
            "learnings": self.learnings if value >= 0.85 else [],
        }

    def complete(self, messages: list[dict], **kwargs: object) -> dict:
        import json

        return {"content": json.dumps(self.complete_json(messages)), "tool_calls": []}


@pytest.fixture
def workdir(tmp_path: Path) -> Path:
    dest = tmp_path / "wd"
    shutil.copytree(BROKEN, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    return dest


def solve(module: str) -> ScriptedStep:
    return ScriptedStep(
        f"implement the {module} module",
        "write_file",
        {
            "path": f"loglens/{module}.py",
            "content": (SOLUTION / "loglens" / f"{module}.py").read_text(),
        },
    )


def build(
    workdir: Path,
    tmp_path: Path,
    steps: list[ScriptedStep],
    aligns: list[float],
    learnings: list[dict] | None = None,
    injector: Injector | None = None,
) -> RunController:
    provider = Judge(aligns, learnings)
    return RunController(
        run_id="rb",
        adapter=ScriptedAgentAdapter(steps),
        task_pack=LoglensTaskPack(BROKEN, SOLUTION),
        workdir=workdir,
        verifier=Verifier(provider),
        checkpointer=Checkpointer(provider, tmp_path / "runs"),
        ledger=Ledger("rb"),
        runs_dir=tmp_path / "runs",
        rollback_hook=RollbackController(),
        injector=injector,
        window_steps=5,
    )


def drift_script() -> list[ScriptedStep]:
    """Two clean groups, then a hard redirect that abandons the objective."""
    steps = [
        ScriptedStep("read the ingest module", "read_file", {"path": "loglens/ingest.py"}),
        solve("ingest"),
        ScriptedStep("run the suite after ingest", "run_tests", {}),
        ScriptedStep("read the analytics module", "read_file", {"path": "loglens/analytics.py"}),
        solve("analytics"),
        ScriptedStep("run the suite after analytics", "run_tests", {}),
        ScriptedStep("read the query module", "read_file", {"path": "loglens/query.py"}),
        solve("query"),
        ScriptedStep("run the suite after query", "run_tests", {}),
        ScriptedStep("check the exports list", "read_file", {"path": "loglens/__init__.py"}),
    ]
    steps += [ScriptedStep(text, "list_dir", {"path": "."}) for text in VARIED]
    # Extra tail so a rollback resumes into real remaining work rather than an exhausted script.
    steps += [
        ScriptedStep(f"{text}, again more carefully", "list_dir", {"path": "."}) for text in VARIED
    ]
    return steps


# -- the core procedure -----------------------------------------------------------


def test_breach_rolls_back_to_a_confirmed_checkpoint_and_resumes(
    workdir: Path, tmp_path: Path
) -> None:
    aligns = [0.95, 0.95, 0.95, 0.02, 0.95, 0.95, 0.95, 0.95]
    controller = build(workdir, tmp_path, drift_script(), aligns)
    controller.run()

    rollbacks = controller.store.of_type("rollback")
    assert rollbacks, "a breach in supervised mode must produce a rollback"

    target_id = rollbacks[0].payload["target_checkpoint_id"]
    target = next(c for c in controller.checkpointer.chain if c.id == target_id)
    assert target.confirmed is True, "only a confirmed checkpoint is a valid target"
    assert controller.store.of_type("resume"), "a passing preflight must resume the run"


def test_rollback_emits_exactly_one_ledger_audit_referencing_it(
    workdir: Path, tmp_path: Path
) -> None:
    aligns = [0.95, 0.95, 0.95, 0.02, 0.95, 0.95, 0.95]
    learning = [
        {"kind": "fact", "text": "conftest supplies the make_event fixture", "confidence": 0.9}
    ]
    controller = build(workdir, tmp_path, drift_script(), aligns, learning)
    controller.run()

    audits = controller.store.of_type("ledger_audit")
    rollbacks = controller.store.of_type("rollback")
    assert len(audits) == len(rollbacks) == 1
    assert audits[0].payload["rollback_ref"] == rollbacks[0].seq
    assert rollbacks[0].payload["ledger_audit_ref"] == audits[0].seq


def test_the_workdir_is_actually_restored(workdir: Path, tmp_path: Path) -> None:
    """After restore, the tree equals the target snapshot exactly.

    Sampled at the moment of restore, not at the end of the run: the run resumes and keeps working
    afterwards, so the final tree legitimately diverges from the checkpoint again.
    """
    steps = drift_script()
    steps.insert(
        10,
        ScriptedStep(
            "write a stray note",
            "write_file",
            {"path": "STRAY.md", "content": "written mid-run"},
        ),
    )
    controller = build(workdir, tmp_path, steps, [0.95, 0.95, 0.95, 0.02, 0.95, 0.95, 0.95])

    sampled: dict[str, dict[str, str]] = {}
    inner = RollbackController()

    def hook(ctl: RunController, breach_seq: int) -> bool:
        result = inner.recover(ctl, breach_seq)
        if result.target_checkpoint_id:
            target = next(c for c in ctl.checkpointer.chain if c.id == result.target_checkpoint_id)
            sampled["after"] = ctl.task_pack.snapshot(ctl.workdir).file_hashes
            sampled["expected"] = dict(target.snapshot.file_hashes)
        return result.recovered

    controller.rollback_hook = hook  # type: ignore[assignment]
    controller.run()

    assert controller.store.of_type("rollback")
    # Exact equality is the guarantee: every tracked file matches, and nothing outside the
    # snapshot remains. (Removal of post-snapshot files is pinned separately in the TaskPack
    # tests, where the checkpoint boundary is controlled rather than emergent.)
    assert sampled["after"] == sampled["expected"], "restore must reproduce the snapshot exactly"


def test_context_is_rebuilt_from_the_digest_not_replayed(workdir: Path, tmp_path: Path) -> None:
    """The poisoned history must never be handed back to the agent."""
    adapter_steps = drift_script()
    controller = build(workdir, tmp_path, adapter_steps, [0.95, 0.95, 0.95, 0.02, 0.95, 0.95, 0.95])
    controller.run()
    assert controller.store.of_type("rollback")

    context = controller.adapter.get_context(controller.handle)
    joined = "\n".join(m["content"] for m in context)
    assert "OBJECTIVE:" in joined
    assert "ROLLBACK NOTICE:" in joined
    assert "do not modify any test file" in joined, "constraints must be re-anchored verbatim"
    assert len(context) <= 5, "a compact rebuild, not a replay of history"


# -- knowledge across the rollback -------------------------------------------------


def test_clean_learnings_survive_the_rollback(workdir: Path, tmp_path: Path) -> None:
    """Rollback without amnesia — the claim the ledger exists to support."""
    learning = [
        {"kind": "fact", "text": "conftest supplies the make_event fixture", "confidence": 0.9}
    ]
    controller = build(
        workdir, tmp_path, drift_script(), [0.95, 0.95, 0.95, 0.02, 0.95, 0.95, 0.95], learning
    )
    controller.run()

    audit = controller.store.of_type("ledger_audit")[0]
    assert audit.payload["retained"], "verified knowledge must cross the rollback"

    resume = controller.store.of_type("resume")[0]
    assert resume.payload["retained_learnings"] > 0

    context = "\n".join(m["content"] for m in controller.adapter.get_context(controller.handle))
    assert "VERIFIED KNOWLEDGE" in context, "retained knowledge must be re-injected"


def test_rollback_survives_a_broken_auditor(workdir: Path, tmp_path: Path) -> None:
    """Restoring the workdir is the guarantee; knowledge retention is the enhancement."""
    controller = build(
        workdir, tmp_path, drift_script(), [0.95, 0.95, 0.95, 0.02, 0.95, 0.95, 0.95]
    )

    def explode(**kwargs: object) -> None:
        raise RuntimeError("auditor exploded")

    controller.ledger.audit = explode  # type: ignore[assignment, method-assign]
    controller.run()

    assert controller.store.of_type("rollback"), "rollback must complete even if the audit fails"
    audit = controller.store.of_type("ledger_audit")[0]
    assert audit.payload["retained"] == []


# -- failure paths ------------------------------------------------------------------


def test_no_confirmed_checkpoint_means_halt_not_crash(workdir: Path, tmp_path: Path) -> None:
    steps = [ScriptedStep(text, "list_dir", {"path": "."}) for text in VARIED]
    controller = build(workdir, tmp_path, steps, [0.01, 0.01, 0.01])
    assert controller.run() == RunState.HALTED_ALERT
    assert not controller.store.of_type("rollback")
    assert not controller.store.of_type("task_complete"), "a halt is not a completion"


def test_a_failing_preflight_halts_after_retrying(workdir: Path, tmp_path: Path) -> None:
    """Breach, then every preflight also fails: the run must halt rather than loop."""
    aligns = [0.95, 0.95, 0.95, 0.02] + [0.01] * 20
    controller = build(workdir, tmp_path, drift_script(), aligns)
    state = controller.run()
    assert state == RunState.HALTED_ALERT
    assert controller.store.of_type("rollback"), "it still attempted the rollback"
    assert not controller.store.of_type("resume"), "but never resumed"


def test_repeated_breaches_stop_rather_than_oscillate(workdir: Path, tmp_path: Path) -> None:
    """Recovering and immediately re-breaching is not recovery. Cap it."""
    # Preflight passes each time, so the run resumes and then drifts straight back into a breach.
    aligns = [0.95, 0.95, 0.95] + [0.02, 0.95] * 12
    controller = build(workdir, tmp_path, drift_script(), aligns)
    controller.run()
    assert len(controller.store.of_type("rollback")) <= 3, "the rollback budget must bind"


def test_preflight_ref_always_points_at_a_verification(workdir: Path, tmp_path: Path) -> None:
    """An event referencing a non-verification is worse than no reference: the UI trusts it."""
    controller = build(workdir, tmp_path, drift_script(), [0.95, 0.95, 0.95, 0.02, 0.95, 0.95])
    controller.run()
    by_seq = {e.seq: e for e in controller.store.events}
    resumes = controller.store.of_type("resume")
    assert resumes
    for resume in resumes:
        ref = resume.payload["preflight_verification_ref"]
        assert by_seq[ref].type == "verification", f"seq {ref} is a {by_seq[ref].type}"


def test_checkpoints_after_the_target_are_invalidated(workdir: Path, tmp_path: Path) -> None:
    """A discarded trajectory's checkpoints must not survive to become future targets.

    Observed live: a passing window after recovery confirmed a checkpoint that had been minted
    after the injection, so a second breach rolled back INTO the corruption the first rollback had
    just removed.
    """
    controller = build(
        workdir, tmp_path, drift_script(), [0.95, 0.95, 0.95, 0.02, 0.95, 0.95, 0.95]
    )
    controller.run()

    rollbacks = controller.store.of_type("rollback")
    assert rollbacks
    target_id = rollbacks[0].payload["target_checkpoint_id"]
    ids = [c.id for c in controller.checkpointer.chain]
    target_index = ids.index(target_id)

    # Anything minted after the target during the discarded range is gone; only checkpoints
    # created after the resume may appear beyond it.
    _, discarded_high = rollbacks[0].payload["discarded_range"]
    for checkpoint in controller.checkpointer.chain[target_index + 1 :]:
        assert checkpoint.seq_range[0] > discarded_high, (
            f"{checkpoint.id} was minted inside the discarded range and survived"
        )
