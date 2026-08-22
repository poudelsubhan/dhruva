#!/usr/bin/env python
"""Measure eviction precision over a run's event log.

The claim "rollback without amnesia" is only worth anything if eviction is *precise*: it must drop
what the corruption touched and keep everything else. This scores that against the naive policy it
replaces.

Three policies over the same log, so the comparison is exact rather than approximate:

  keep-all   retain every learning. Maximal knowledge, but contaminated beliefs survive.
  positional evict everything minted inside the discarded seq range. This is the obvious policy,
             and it is what "rollback" means if you do not track provenance.
  provenance what Dhruva does: evict only what traces to a poisoned observation or the injection,
             or inherits from something already evicted.

The number that matters is how much *clean* knowledge the positional policy destroys, because that
is the amnesia the design exists to prevent. Ground truth is the fixture's own `poisoned` flag, so
this is measured rather than judged.

    uv run python scripts/measure_retention.py fixtures/mock/breach.jsonl
    uv run python scripts/measure_retention.py --scenario s2
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def load(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def measure(events: list[dict]) -> dict[str, object] | None:
    rollbacks = [e for e in events if e["type"] == "rollback"]
    if not rollbacks:
        return None
    rollback = rollbacks[0]
    low, high = rollback["payload"]["discarded_range"]

    poison = {
        e["seq"] for e in events if e["type"] == "observation" and e["payload"].get("poisoned")
    }
    poison |= {e["seq"] for e in events if e["type"] == "injection"}
    first_poison = min(poison) if poison else None

    learnings = [e for e in events if e["type"] == "learning"]
    audit = next((e for e in events if e["type"] == "ledger_audit"), None)

    # Ground truth: a learning is contaminated iff it was first minted after the corruption landed
    # AND cites it. Both facts come from the log, not from a model.
    def contaminated(learning: dict) -> bool:
        sources = set(learning["payload"]["source_seqs"])
        if not sources & poison:
            return False
        return first_poison is not None and learning["seq"] >= first_poison

    truth = {e["payload"]["entry_id"]: contaminated(e) for e in learnings}
    total = len(truth)
    dirty = sum(truth.values())
    clean = total - dirty

    keep_all_kept, keep_all_dirty_kept = total, dirty

    positional_evicted = {e["payload"]["entry_id"] for e in learnings if low <= e["seq"] <= high}
    positional_clean_lost = sum(
        1 for entry_id, is_dirty in truth.items() if entry_id in positional_evicted and not is_dirty
    )
    positional_dirty_kept = sum(
        1 for entry_id, is_dirty in truth.items() if entry_id not in positional_evicted and is_dirty
    )

    provenance_evicted = (
        {row["entry_id"] for row in audit["payload"]["evicted"]} if audit else set()
    )
    provenance_clean_lost = sum(
        1 for entry_id, is_dirty in truth.items() if entry_id in provenance_evicted and not is_dirty
    )
    provenance_dirty_kept = sum(
        1 for entry_id, is_dirty in truth.items() if entry_id not in provenance_evicted and is_dirty
    )

    return {
        "learnings": total,
        "clean": clean,
        "contaminated": dirty,
        "discarded_range": [low, high],
        "policies": {
            "keep-all": {
                "kept": keep_all_kept,
                "clean_lost": 0,
                "contaminated_kept": keep_all_dirty_kept,
            },
            "positional": {
                "kept": total - len(positional_evicted),
                "clean_lost": positional_clean_lost,
                "contaminated_kept": positional_dirty_kept,
            },
            "provenance": {
                "kept": total - len(provenance_evicted),
                "clean_lost": provenance_clean_lost,
                "contaminated_kept": provenance_dirty_kept,
            },
        },
    }


def run_scenario(scenario: str) -> list[dict]:
    """Run the scenario and read the log IT reports.

    Globbing the temp dir and taking the last match sorts lexicographically rather than by time, so
    it silently measures whichever old run happens to sort highest.
    """
    proc = subprocess.run(
        [sys.executable, "scripts/demo_scenario.py", "--scenario", scenario],
        capture_output=True,
        text=True,
        check=True,
        cwd=Path(__file__).resolve().parent.parent,
    )
    for line in proc.stdout.splitlines():
        if "log:" in line:
            return load(Path(line.split("log:", 1)[1].strip()))
    raise SystemExit("the run did not report a log path")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("log", nargs="?", type=Path)
    ap.add_argument("--scenario", choices=["s1", "s2", "s3"])
    args = ap.parse_args()

    events = run_scenario(args.scenario) if args.scenario else load(args.log)
    result = measure(events)
    if result is None:
        print("no rollback in this log — nothing to measure")
        return 0

    policies = result["policies"]  # type: ignore[index]
    print(
        f"\nlearnings: {result['learnings']}  clean: {result['clean']}  "
        f"contaminated: {result['contaminated']}  discarded: {result['discarded_range']}\n"
    )
    print(f"  {'policy':<12} {'kept':>5} {'clean lost':>11} {'contaminated kept':>18}")
    print(f"  {'-' * 12} {'-' * 5} {'-' * 11} {'-' * 18}")
    for name in ("keep-all", "positional", "provenance"):
        row = policies[name]  # type: ignore[index]
        print(
            f"  {name:<12} {row['kept']:>5} {row['clean_lost']:>11} {row['contaminated_kept']:>18}"
        )

    positional = policies["positional"]  # type: ignore[index]
    provenance = policies["provenance"]  # type: ignore[index]
    saved = positional["clean_lost"] - provenance["clean_lost"]
    print(
        f"\n  Provenance-based eviction preserved {saved} clean learning(s) that positional "
        f"eviction would have destroyed,"
    )
    print(
        f"  while keeping {provenance['contaminated_kept']} contaminated belief(s) "
        f"(keep-all would keep {policies['keep-all']['contaminated_kept']}).\n"  # type: ignore[index]
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
