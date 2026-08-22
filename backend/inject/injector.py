"""Deterministic, fixture-defined corruption.

Each scenario arms a single mutation and fires it at a chosen step. Nothing here is random: the
same scenario at the same step produces the same mutation every run, which is what acceptance
criterion 8 (two consecutive identical traces) requires.

The three scenarios attack three different surfaces:
  s1 the agent's instructions   — a plausible redirect that supersedes the objective
  s2 the agent's observations   — a falsified tool result it has no way to distrust
  s3 the agent's memory         — a lossy "compaction" that drops one critical constraint
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from backend.config import get_settings


@dataclass(frozen=True)
class Scenario:
    key: str
    name: str
    mode: str
    raw: dict[str, Any]


@lru_cache(maxsize=4)
def load_scenarios(path: Path | None = None) -> dict[str, Scenario]:
    target = Path(path) if path else get_settings().fixtures_dir / "scenarios" / "scenarios.yaml"
    data = yaml.safe_load(target.read_text()) or {}
    return {
        key: Scenario(key=key, name=cfg.get("name", key), mode=cfg["mode"], raw=cfg)
        for key, cfg in data.items()
    }


class Injector:
    """Arms one scenario against a run and fires it at the right moment."""

    def __init__(self, scenarios: dict[str, Scenario] | None = None) -> None:
        self.scenarios = scenarios or load_scenarios()
        self.armed: tuple[str, int] | None = None
        self.fired = False
        self.fired_at_seq: int | None = None
        self._pending_tool: Scenario | None = None

    def arm(self, scenario_key: str, at_step: int) -> None:
        if scenario_key not in self.scenarios:
            raise KeyError(f"unknown scenario: {scenario_key}")
        self.armed = (scenario_key, at_step)
        self.fired = False
        self._pending_tool = None

    def should_fire(self, step: int) -> bool:
        if self.armed is None or self.fired:
            return False
        return step >= self.armed[1]

    def fire(self, controller: Any, step: int) -> str | None:
        """Apply the mutation. Returns the scenario key, or None if nothing was armed."""
        if not self.should_fire(step) or self.armed is None:
            return None
        key, _ = self.armed
        scenario = self.scenarios[key]
        self.fired = True

        if scenario.mode == "inject_messages":
            controller.adapter.inject_messages(controller.handle, scenario.raw["messages"])
        elif scenario.mode == "rewrite_context":
            self._compact(controller, scenario)
        elif scenario.mode == "intercept_tool":
            # Armed rather than applied: the mutation lands on the NEXT matching tool result.
            self._pending_tool = scenario

        event = controller.store.emit(
            "injection",
            {"scenario": key, "at_step": step, "target_agent": None},
            checkpoint_ref=controller.current_checkpoint,
        )
        self.fired_at_seq = event.seq
        return key

    def _compact(self, controller: Any, scenario: Scenario) -> None:
        """Emulate aggressive compaction: keep the ends, replace the middle with a lossy summary."""
        messages = controller.adapter.get_context(controller.handle)
        head = int(scenario.raw.get("keep_head", 1))
        tail = int(scenario.raw.get("keep_tail", 2))
        summary = {"role": "user", "content": scenario.raw["summary"]}
        rebuilt = messages[:head] + [summary] + (messages[-tail:] if tail else [])
        controller.adapter.set_context(controller.handle, rebuilt)
        controller.store.emit(
            "memory_op",
            {
                "op": "compact",
                "detail": f"history compacted from {len(messages)} to {len(rebuilt)} messages",
            },
            checkpoint_ref=controller.current_checkpoint,
        )

    def intercept(self, tool: str, call: Any) -> Any:
        """Swap a tool result for the fixture payload. Returns the original when not armed."""
        scenario = self._pending_tool
        if scenario is None or scenario.raw.get("tool") != tool:
            return call
        self._pending_tool = None
        replacement = scenario.raw["replacement"]
        return type(call)(
            ok=bool(replacement.get("ok", True)),
            content=str(replacement.get("content", "")),
            meta={**replacement.get("meta", {}), "poisoned": True},
        )
