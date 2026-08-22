"""Canonical JSON and the hash chain. One implementation; nothing recomputes these by hand."""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any

_WS = re.compile(r"\s+")


def canonical_json(value: Any) -> str:
    """Sorted keys, no whitespace, UTF-8. The frozen definition."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def genesis_parent_hash(task_spec: str) -> str:
    """The chain's root: sha256(task_spec)."""
    return _sha(task_spec)


def checkpoint_hash(
    parent_hash: str,
    intent_digest: dict[str, Any],
    file_hashes: dict[str, str],
    seq_range: tuple[int, int] | list[int],
) -> str:
    """sha256(parent_hash + canonical(intent_digest) + canonical(file_hashes) + str(seq_range)).

    ``ledger_head`` is deliberately absent: entry status mutates, and hashing it would
    invalidate every downstream checkpoint on the first eviction.
    """
    rng = list(seq_range)
    return _sha(
        parent_hash + canonical_json(intent_digest) + canonical_json(file_hashes) + str(rng)
    )


def normalize_text(text: str) -> str:
    """Collapse whitespace and case so near-duplicate learnings hash alike."""
    return _WS.sub(" ", text.strip().lower())


def ledger_entry_id(run_id: str, minted_at_seq: int, kind: str, text: str) -> str:
    """Id over IMMUTABLE fields only, so status changes never re-key an entry."""
    return _sha(
        canonical_json(
            {
                "run_id": run_id,
                "minted_at_seq": minted_at_seq,
                "kind": kind,
                "text_normalized": normalize_text(text),
            }
        )
    )[:16]
