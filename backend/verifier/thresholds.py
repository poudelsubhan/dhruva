"""Loader for ``config/thresholds.yaml`` — the single tuning surface."""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from backend.config import get_settings


@dataclass(frozen=True)
class Thresholds:
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def verifier(self) -> dict[str, Any]:
        return self.raw.get("verifier", {})

    @property
    def ledger(self) -> dict[str, Any]:
        return self.raw.get("ledger", {})

    @property
    def rollback(self) -> dict[str, Any]:
        return self.raw.get("rollback", {})

    @property
    def weights(self) -> dict[str, float]:
        return self.verifier.get("weights", {"alignment": 0.6, "repetition": 0.2, "progress": 0.2})

    @property
    def breach(self) -> float:
        return float(self.verifier.get("thresholds", {}).get("breach", 0.55))

    @property
    def warn(self) -> float:
        return float(self.verifier.get("thresholds", {}).get("warn", 0.70))

    @property
    def window_steps(self) -> int:
        return int(self.verifier.get("window_steps", 5))

    @property
    def warns_to_breach(self) -> int:
        return int(self.verifier.get("consecutive_warns_to_breach", 2))


@lru_cache(maxsize=4)
def load_thresholds(path: Path | None = None) -> Thresholds:
    target = Path(path) if path else get_settings().config_dir / "thresholds.yaml"
    return Thresholds(raw=yaml.safe_load(target.read_text()) or {})
