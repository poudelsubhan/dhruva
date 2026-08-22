"""Verifier scoring and the verdict rules."""

from __future__ import annotations

from backend.contracts import IntentDigest, ProgressResult
from backend.verifier import Verifier
from backend.verifier.verify import repetition_score

INTENT = IntentDigest(objective="make the suite pass", constraints=["do not modify any test file"])


class FixedJudge:
    """Returns one alignment forever, so the composite is fully determined by the test."""

    def __init__(self, alignment: float) -> None:
        self.alignment = alignment

    def complete_json(self, messages: list[dict], model: str | None = None) -> dict:
        return {
            "alignment": self.alignment,
            "violated_constraints": [],
            "rationale": "fixed",
            "learnings": [],
        }


def progress(score: float, tampered: bool = False) -> ProgressResult:
    return ProgressResult(score=score, per_test={}, tests_tampered=tampered)


def verify(v: Verifier, descriptions: list[str], score: float, tampered: bool = False):
    return v.verify(INTENT, descriptions, "window", progress(score, tampered))


# -- repetition -------------------------------------------------------------------


def test_repetition_is_one_for_a_single_action() -> None:
    assert repetition_score(["do the thing"]) == 1.0


def test_identical_actions_score_zero() -> None:
    assert repetition_score(["run the tests"] * 4) == 0.0


def test_varied_actions_score_high() -> None:
    varied = ["read the ingest module", "write the percentile helper", "run the suite"]
    assert repetition_score(varied) > 0.5


def test_a_loop_is_caught_even_among_varied_actions() -> None:
    """The last k window includes the repeat, so the loop dominates the score."""
    actions = ["read ingest", "write analytics", "run tests", "read ingest"]
    assert repetition_score(actions, k=6) == 0.0


# -- composite --------------------------------------------------------------------


def test_a_coherent_window_passes() -> None:
    v = Verifier(FixedJudge(0.95))
    out = verify(v, ["read ingest", "write analytics", "run the suite"], 0.33)
    assert out.verdict == "pass"
    assert out.coherence > 0.8


def test_a_redirected_window_breaches() -> None:
    v = Verifier(FixedJudge(0.1))
    out = verify(v, ["rewrite the public API", "delete the old interface"], 0.0)
    assert out.verdict == "breach"
    assert out.coherence < 0.5


# -- the escalation rule ----------------------------------------------------------


def test_two_consecutive_warns_escalate_to_breach() -> None:
    """One warn is a wobble; two in a row is drift."""
    v = Verifier(FixedJudge(0.78))
    varied = ["read the ingest module", "check the failing assertions", "open the query module"]

    first = verify(v, varied, 0.0)
    assert first.verdict == "warn", f"expected warn, got {first.verdict} at C={first.coherence}"

    second = verify(v, varied, 0.0)
    assert second.verdict == "breach", "a second consecutive warn must escalate"


def test_a_pass_resets_the_warn_streak() -> None:
    v = Verifier(FixedJudge(0.78))
    varied = ["read the ingest module", "check the failing assertions", "open the query module"]
    assert verify(v, varied, 0.0).verdict == "warn"

    v.provider = FixedJudge(0.99)
    assert verify(v, varied, 0.9).verdict == "pass"

    v.provider = FixedJudge(0.78)
    assert verify(v, varied, 0.9).verdict == "warn", "streak must have reset, not escalated"


def test_tampering_breaches_regardless_of_a_perfect_score() -> None:
    """Ground truth compromised is an invalid measurement, not a low score (D2)."""
    v = Verifier(FixedJudge(1.0))
    out = verify(v, ["read ingest", "write analytics", "run the suite"], 1.0, tampered=True)
    assert out.verdict == "breach"
    assert out.tests_tampered is True
    assert "GROUND TRUTH COMPROMISED" in out.rationale


def test_rollback_resets_the_escalation_state() -> None:
    """The warn streak belongs to the trajectory that was just discarded."""
    v = Verifier(FixedJudge(0.78))
    varied = ["read the ingest module", "check the failing assertions", "open the query module"]
    assert verify(v, varied, 0.0).verdict == "warn"
    v.reset_escalation()
    assert verify(v, varied, 0.0).verdict == "warn", "not breach: the streak was cleared"


# -- resilience -------------------------------------------------------------------


class BrokenJudge:
    def complete_json(self, messages: list[dict], model: str | None = None) -> dict:
        raise RuntimeError("provider down")


def test_a_judge_failure_does_not_kill_the_run() -> None:
    """A neutral prior, not a crash and not a spurious breach."""
    v = Verifier(BrokenJudge())
    out = verify(v, ["read ingest", "write analytics"], 0.5)
    assert out.alignment == 0.5
    assert "judge unavailable" in out.rationale
