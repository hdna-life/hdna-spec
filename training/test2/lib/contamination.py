"""Protected-case contamination guard. Checked before freezing the
accepted corpus — a candidate whose (original, final) pair hash matches a
protected registry entry (Test 1's benchmark, or Test 2's own held-out
set) must never enter training/generation. The registry stores only
hashes, never the protected text itself, so this file can be committed
without exposing benchmark contents."""

from __future__ import annotations

import json
from pathlib import Path

from ids import normalized_pair_hash


def load_protected_hashes(registry_path: Path) -> set[str]:
    if not registry_path.exists():
        return set()
    with open(registry_path, "r", encoding="utf-8") as f:
        registry = json.load(f)
    return set(registry.get("protected_pair_hashes", []))


def is_contaminated(record: dict, protected_hashes: set[str]) -> bool:
    return normalized_pair_hash(record["originalText"], record["finalText"]) in protected_hashes


def filter_contaminated(records: list[dict], protected_hashes: set[str]) -> tuple[list[dict], list[dict]]:
    """Splits records into (clean, contaminated) — reusable as a pipeline
    stage anywhere a protected-case check must gate what happens next
    (e.g. before the candidate ever reaches a verifier provider)."""
    clean, contaminated = [], []
    for record in records:
        (contaminated if is_contaminated(record, protected_hashes) else clean).append(record)
    return clean, contaminated
