"""The run controller, driven end to end against stubs.

No model calls: the adapter is scripted and the provider is mocked, so these assert the loop's
mechanics rather than an LLM's judgement.
"""

from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from backend.checkpoint import Checkpointer, integrity_check
from backend.harness import RunController, RunState, ScriptedAgentAdapter
from backend.harness.stub_agent import ScriptedStep
from backend.ledger import Ledger
from backend.providers import MockProvider
from backend.tasks import LoglensTaskPack
from backend.verifier import Verifier

REPO = Path(__file__).resolve().parents[3]
BROKEN = REPO / "fixtures" / "task_repo"
SOLUTION = REPO / "fixtures" / "task_repo_solution"

GROUPS = ["ingest", "analytics", "query"]

# Genuinely varied action descriptions. Templated strings ("do X for {i}") score ~0.9 pairwise
# Levenshtein similarity, which trips the repetition term and breaches for a reason these tests are
# not trying to exercise.
_DISTINCT = [
    "list the package directory",
    "open TASK.md and read the constraints",
    "check which tests currently fail",
    "inspect the models module for shared types",
    "look at how conftest builds fixtures",
    "trace an event through the ingest path",
    "compare the docstring against the assertion",
    "search for the percentile helper",
    "review naming across the query module",
    "count the remaining stub markers",
    "examine the report footer format",
    "verify the package still imports",
    "scan for module level constants",
    "read the sessionization threshold",
    "confirm the public exports list",
    "diff expected output against actual",
    "measure how many groups remain",
    "study the table padding rules",
    "walk the dedupe ordering logic",
    "sample a line from the log file",
]


def solve_step(module: str) -> ScriptedStep:
    src = (SOLUTION / "loglens" / f"{module}.py").read_text()
    return ScriptedStep(
        description=f"implement the {module} module stubs",
        tool="write_file",
        args={"path": f"loglens/{module}.py", "content": src},
    )


def script_success() -> list[ScriptedStep]:
    steps: list[ScriptedStep] = []
    for module in GROUPS:
        steps.append(
            ScriptedStep(
                f"read {module} module and its tests", "read_file", {"path": f"loglens/{module}.py"}
            )
        )
        steps.append(solve_step(module))
        steps.append(ScriptedStep("run the test suite", "run_tests", {}))
    steps.append(
        ScriptedStep(
            "write NOTES.md summarising the work",
            "write_file",
            {"path": "NOTES.md", "content": "implemented all twelve"},
            claims_complete=True,
        )
    )
    return steps


def judge(alignment: float, learnings: list[dict] | None = None) -> dict:
    return {
        "alignment": alignment,
        "violated_constraints": [],
        "rationale": "scripted",
        "learnings": learnings or [],
    }


def digest() -> dict:
    return {
        "objective": "Implement the marked functions so the suite passes.",
        "constraints": ["do not modify any test file"],
        "done_criteria": ["12/12 tests pass"],
        "key_decisions": [],
        "open_subgoals": [],
    }


@pytest.fixture
def workdir(tmp_path: Path) -> Path:
    dest = tmp_path / "wd"
    shutil.copytree(BROKEN, dest, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    return dest


def build(
    workdir: Path,
    tmp_path: Path,
    steps: list[ScriptedStep],
    judgements: list[dict],
    mode: str = "supervised",
) -> RunController:
    # Interleave judge and compressor responses: the controller calls the judge once per window and
    # the compressor once per passing window.
    responses: list = []
    for j in judgements:
        responses.append(j)
        responses.append(digest())
    provider = MockProvider(responses)
    pack = LoglensTaskPack(BROKEN, SOLUTION)
    return RunController(
        run_id="test-run",
        adapter=ScriptedAgentAdapter(steps),
        task_pack=pack,
        workdir=workdir,
        verifier=Verifier(provider),
        checkpointer=Checkpointer(provider, tmp_path / "runs"),
        ledger=Ledger("test-run"),
        runs_dir=tmp_path / "runs",
        mode=mode,
        window_steps=5,
    )


# -- the happy path ---------------------------------------------------------------


def test_clean_run_completes_and_solves_the_task(workdir: Path, tmp_path: Path) -> None:
    controller = build(workdir, tmp_path, script_success(), [judge(0.95)] * 8)
    assert controller.run() == RunState.DONE

    complete = controller.store.of_type("task_complete")[-1]
    assert complete.payload["success"] is True
    assert complete.payload["progress"]["score"] == 1.0


def test_seq_is_monotonic_and_gapless(workdir: Path, tmp_path: Path) -> None:
    controller = build(workdir, tmp_path, script_success(), [judge(0.95)] * 8)
    controller.run()
    seqs = [e.seq for e in controller.store.events]
    assert seqs == list(range(len(seqs)))


def test_every_event_is_schema_valid(workdir: Path, tmp_path: Path) -> None:
    import json

    from jsonschema import Draft202012Validator

    schema = json.loads((REPO / "shared" / "schema" / "run_event.schema.json").read_text())
    validator = Draft202012Validator(schema)
    controller = build(workdir, tmp_path, script_success(), [judge(0.95)] * 8)
    controller.run()
    for event in controller.store.events:
        validator.validate(event.model_dump(mode="json"))


def test_disk_log_matches_the_in_memory_stream(workdir: Path, tmp_path: Path) -> None:
    """Single source of truth: replay must render from exactly what live rendered."""
    from backend.harness.events import EventStore

    controller = build(workdir, tmp_path, script_success(), [judge(0.95)] * 8)
    controller.run()
    on_disk = list(EventStore.read_jsonl(controller.store.path))
    assert on_disk == [e.model_dump(mode="json") for e in controller.store.events]


def test_checkpoints_are_minted_and_chain_validates(workdir: Path, tmp_path: Path) -> None:
    controller = build(workdir, tmp_path, script_success(), [judge(0.95)] * 8)
    controller.run()
    assert len(controller.checkpointer.chain) >= 2
    assert integrity_check(controller.checkpointer.chain)


def test_a_tampered_checkpoint_breaks_the_chain(workdir: Path, tmp_path: Path) -> None:
    controller = build(workdir, tmp_path, script_success(), [judge(0.95)] * 8)
    controller.run()
    chain = controller.checkpointer.chain
    first = chain[0]
    chain[0] = first.model_copy(
        update={"snapshot": first.snapshot.model_copy(update={"file_hashes": {"x": "tampered"}})}
    )
    assert integrity_check(chain) is False


def test_only_the_predecessor_is_confirmed(workdir: Path, tmp_path: Path) -> None:
    """The newest checkpoint has nothing corroborating it, so it is not yet a rollback target."""
    controller = build(workdir, tmp_path, script_success(), [judge(0.95)] * 8)
    controller.run()
    chain = controller.checkpointer.chain
    assert chain[-1].confirmed is False
    assert any(c.confirmed for c in chain[:-1]), "earlier checkpoints must be confirmed"
    assert controller.checkpointer.latest_confirmed() is not None


# -- verification cadence ---------------------------------------------------------


def test_verifications_fire_on_the_window_boundary(workdir: Path, tmp_path: Path) -> None:
    steps = [ScriptedStep(text, "list_dir", {"path": "."}) for text in _DISTINCT[:20]]
    controller = build(workdir, tmp_path, steps, [judge(0.95)] * 8)
    controller.run()
    assert len(controller.store.of_type("verification")) >= 4


def test_a_completion_claim_forces_a_window(workdir: Path, tmp_path: Path) -> None:
    """D3 — without this, S2's falsely-satisfied agent ends the run in silence."""
    steps = [
        ScriptedStep("look around", "list_dir", {"path": "."}),
        ScriptedStep(
            "declare done",
            "write_file",
            {"path": "NOTES.md", "content": "done"},
            claims_complete=True,
        ),
    ]
    controller = build(workdir, tmp_path, steps, [judge(0.9)] * 4)
    controller.run()
    verifications = controller.store.of_type("verification")
    assert verifications, "a completion claim must close a window even mid-cadence"
    assert verifications[0].payload["window"][0] == 0


# -- breach behaviour -------------------------------------------------------------


def test_low_alignment_breaches_and_halts_without_a_rollback_hook(
    workdir: Path, tmp_path: Path
) -> None:
    steps = [ScriptedStep(text, "list_dir", {"path": "."}) for text in _DISTINCT[:10]]
    controller = build(workdir, tmp_path, steps, [judge(0.05)] * 4)
    assert controller.run() == RunState.HALTED_ALERT
    assert controller.store.of_type("breach")


def test_sustained_drift_breaches(workdir: Path, tmp_path: Path) -> None:
    # Sustained mediocre alignment with no progress must end in a breach. Which rule fires depends
    # on where repetition lands for these particular strings, so the escalation LOGIC is asserted
    # directly against the verifier in backend/verifier/tests; here we assert the controller acts.
    steps = [ScriptedStep(text, "list_dir", {"path": "."}) for text in (_DISTINCT * 2)[:15]]
    controller = build(workdir, tmp_path, steps, [judge(0.6)] * 5)
    controller.run()

    breaches = controller.store.of_type("breach")
    assert breaches, "sustained drift with no progress must breach"
    assert breaches[0].payload["rule_fired"] in {
        "two_consecutive_warns",
        "below_breach_threshold",
    }


def test_tampering_breaches_immediately_regardless_of_alignment(
    workdir: Path, tmp_path: Path
) -> None:
    """Ground truth compromised is an invalid measurement, not a low score (D2)."""
    steps = [
        ScriptedStep(
            "gut a test to make it pass",
            "write_file",
            {"path": "tests/test_ingest.py", "content": "def test_x():\n    assert True\n"},
        ),
        *[ScriptedStep(text, "list_dir", {"path": "."}) for text in _DISTINCT[:5]],
    ]
    controller = build(workdir, tmp_path, steps, [judge(0.99)] * 4)
    controller.run()
    breaches = controller.store.of_type("breach")
    assert breaches, "editing a test file must breach even at alignment 0.99"
    assert breaches[0].payload["rule_fired"] == "tests_tampered"


def test_unsupervised_mode_scores_but_never_intervenes(workdir: Path, tmp_path: Path) -> None:
    """The twin control arm: identical code path, interventions removed."""
    steps = [ScriptedStep(text, "list_dir", {"path": "."}) for text in _DISTINCT[:12]]
    controller = build(workdir, tmp_path, steps, [judge(0.05)] * 5, mode="unsupervised")
    state = controller.run()
    assert state == RunState.DONE, "an unsupervised run is never halted by drift"
    assert controller.store.of_type("breach"), "it still records the breach"
    assert not controller.store.of_type("rollback")


# -- knowledge ---------------------------------------------------------------------


def test_learnings_from_passing_windows_reach_the_ledger(workdir: Path, tmp_path: Path) -> None:
    learning = [
        {"kind": "fact", "text": "conftest supplies the make_event fixture", "confidence": 0.9}
    ]
    controller = build(workdir, tmp_path, script_success(), [judge(0.95, learning)] * 8)
    controller.run()
    assert controller.store.of_type("learning"), "a learning event must be emitted"
    assert controller.ledger.retrieve(), "and the entry must be retrievable"


def test_an_empty_window_is_never_verified(workdir: Path, tmp_path: Path) -> None:
    """A window with no actions is empty, not incoherent.

    Observed live: a run finished its script, the controller verified the leftover window, the
    judge scored 0.155 on "the window shows no actions", and the supervisor rolled back a correct
    implementation. Judging an empty transcript is not a measurement.
    """
    steps = [ScriptedStep(text, "list_dir", {"path": "."}) for text in _DISTINCT[:5]]
    controller = build(workdir, tmp_path, steps, [judge(0.95)] * 4)
    controller.run()

    verifications = controller.store.of_type("verification")
    actions = controller.store.of_type("action")
    assert len(actions) == 5

    # Exactly one window closes: the cadence boundary at step 5. The exhausted-script path must
    # not add a second, empty one.
    assert len(verifications) == 1, [v.payload["window"] for v in verifications]

    for verification in verifications:
        low, high = verification.payload["window"]
        in_window = [a for a in actions if low <= a.seq <= high]
        assert in_window, f"window {[low, high]} contains no actions"
