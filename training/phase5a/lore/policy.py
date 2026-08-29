"""Loads training/phase5a/lore/policy-spec.v1.json — the single source of
truth for verdicts/dimensions/directions. Python training tooling must
read this file directly; do not hand-duplicate the taxonomy.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

POLICY_SPEC_PATH = Path(__file__).parent / "policy-spec.v1.json"


def load_policy(path: Path = POLICY_SPEC_PATH) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def format_dimension_direction_pairs(policy: dict[str, Any]) -> str:
    """Must match extension/src/persona/behavior-dimension.ts's
    formatCanonicalDimensionDirections() output exactly — the training
    prompt and the runtime judge prompt must render identical text."""
    return ", ".join(
        f"{dimension}({'|'.join(directions)})" for dimension, directions in policy["dimensions"].items()
    )


def is_valid_dimensions_list(dimensions: list[dict[str, str]], policy: dict[str, Any]) -> bool:
    """Mirrors extension/src/persona/behavior-dimension.ts's isValidDimensionsArray."""
    seen: set[str] = set()
    for change in dimensions:
        dimension = change.get("dimension")
        direction = change.get("direction")
        if dimension is None or direction is None:
            return False
        if dimension in seen:
            return False
        seen.add(dimension)
        if direction not in policy["dimensions"].get(dimension, []):
            return False
    return True
