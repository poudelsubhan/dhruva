#!/usr/bin/env python
"""Phase 4 phase-open procedure: calibrate the verifier thresholds, then freeze them.

The plan is explicit about this and it is easy to skip: run clean supervised runs, record the
coherence distribution, and set the thresholds a margin BELOW what clean work actually produces.
Thresholds guessed a priori are the difference between a demo that survives and one that breaches
on a correct agent in front of an audience.

    uv run python scripts/calibrate.py --runs 3          # report only
    uv run python scripts/calibrate.py --runs 3 --write  # report and update thresholds.yaml

Reads the coherence of every window from clean (injection-free) runs. Reports the observed minimum
and what the plan's rule would set:  breach = min - 0.10,  warn = min - 0.05.
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

REPO = Path(__file__).resolve().parent.parent


def clean_run_coherences(index: int) -> list[float]:
    """One clean supervised run, offline and deterministic. Returns its window coherences."""
    from backend.checkpoint import Checkpointer
    from backend.harness import RunController, ScriptedAgentAdapter
    from backend.ledger import Ledger
    from backend.rollback import RollbackController
    from backend.tasks import LoglensTaskPack
    from backend.verifier import Verifier
    from scripts.demo_scenario import ScriptedJudge, recovery_script
    from scripts.demo_scenario import script as demo_script

    tmp = Path(tempfile.mkdtemp(prefix=f"dhruva-cal-{index}-"))
    workdir = tmp / "wd"
    shutil.copytree(
        REPO / "fixtures" / "task_repo",
        workdir,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
    )
    # drift_after far beyond the run: no injection, no drift. A clean baseline.
    provider = ScriptedJudge(drift_after=999)
    controller = RunController(
        run_id=f"cal-{index}",
        adapter=ScriptedAgentAdapter(demo_script(), recovery_script()),
        task_pack=LoglensTaskPack(REPO / "fixtures" / "task_repo"),
        workdir=workdir,
        verifier=Verifier(provider),
        checkpointer=Checkpointer(provider, tmp / "runs"),
        ledger=Ledger(f"cal-{index}"),
        runs_dir=tmp / "runs",
        rollback_hook=RollbackController(),
        injector=None,
        window_steps=5,
    )
    controller.run()
    return [
        e.payload["coherence"]
        for e in controller.store.of_type("verification")
        # Pre-flight verifications are synthetic 1.0s and would inflate the floor.
        if not str(e.payload.get("rationale", "")).startswith("preflight")
    ]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--write", action="store_true", help="update config/thresholds.yaml")
    args = ap.parse_args()

    all_scores: list[float] = []
    for i in range(args.runs):
        scores = clean_run_coherences(i)
        all_scores.extend(scores)
        rendered = ", ".join(f"{s:.3f}" for s in scores)
        print(f"  clean run {i + 1}: {len(scores)} windows  [{rendered}]")

    if not all_scores:
        print("no windows scored — cannot calibrate")
        return 1

    low = min(all_scores)
    high = max(all_scores)
    mean = sum(all_scores) / len(all_scores)
    breach = round(low - 0.10, 3)
    warn = round(low - 0.05, 3)

    print(f"\n  windows: {len(all_scores)}   min {low:.3f}   mean {mean:.3f}   max {high:.3f}")
    print(f"  rule: breach = min - 0.10 = {breach:.3f}   warn = min - 0.05 = {warn:.3f}")

    config = REPO / "config" / "thresholds.yaml"
    text = config.read_text()
    current_breach = float(text.split("breach:")[1].split("\n")[0])
    current_warn = float(text.split("warn:")[1].split("\n")[0])
    print(f"  current: breach {current_breach:.3f}   warn {current_warn:.3f}")

    margin = low - current_warn
    if margin < 0:
        print(
            f"\n  *** WARNING: the warn threshold ({current_warn}) sits ABOVE the clean minimum "
            f"({low:.3f}). A correct run will warn. ***"
        )
    else:
        print(f"\n  clean minimum clears the warn threshold by {margin:.3f}")

    if args.write:
        text = text.replace(f"breach: {current_breach}", f"breach: {breach}")
        text = text.replace(f"warn: {current_warn}", f"warn: {warn}")
        config.write_text(text)
        print(f"\n  wrote config/thresholds.yaml: breach {breach}, warn {warn}")
    else:
        print("\n  (report only — pass --write to update config/thresholds.yaml)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
