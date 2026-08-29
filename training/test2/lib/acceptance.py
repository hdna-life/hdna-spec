"""v1 generator/verifier acceptance policy. The verifier's independent
judgment — never the generator's proposal — becomes the canonical training
target once the semantic verdict is independently confirmed. Exact
dimension-set agreement between generator and verifier is NOT required;
disagreement there is recorded for audit, not rejected."""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "phase5a" / "lore"))
from policy import is_valid_dimensions_list  # noqa: E402

VERIFIER_CONFIDENCE_THRESHOLD = 0.90


def validate_verifier_output_structure(output: dict[str, Any], policy: dict) -> str | None:
    """Canonical v3 structural contract for a verifier response — rejected,
    never repaired, on any violation:
      - verdict must be one of the policy's verdicts
      - dimensions must be a valid dimension/direction list
      - confidence must be a number in [0, 1]
      - verdict == "uncertain" requires dimensions == []
    Returns a rejection reason, or None if structurally valid."""
    if output.get("verdict") not in policy["verdicts"]:
        return "invalid_verdict"
    if not is_valid_dimensions_list(output.get("dimensions", []), policy):
        return "invalid_dimensions"
    confidence = output.get("confidence")
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)) or not (0.0 <= confidence <= 1.0):
        return "invalid_confidence"
    if output["verdict"] == "uncertain" and output["dimensions"]:
        return "uncertain_with_nonempty_dimensions"
    return None


def decide_acceptance(record: dict, confidence_threshold: float = VERIFIER_CONFIDENCE_THRESHOLD) -> dict:
    """record must already carry validated generator + verifier output.
    Returns {"accepted": bool, "reason": str | None, "canonical_verdict": ...,
    "canonical_dimensions": ..., "dimension_sets_equal": bool}."""
    generator = record["generator"]
    verifier = record["verifier"]

    verdict_agrees = generator["proposedVerdict"] == verifier["verdict"]
    if not verdict_agrees:
        return {"accepted": False, "reason": "verdict_disagreement", "dimension_sets_equal": None}

    if verifier["confidence"] < confidence_threshold:
        return {"accepted": False, "reason": "low_verifier_confidence", "dimension_sets_equal": None}

    generator_dims = {(d["dimension"], d["direction"]) for d in generator["proposedDimensions"]}
    verifier_dims = {(d["dimension"], d["direction"]) for d in verifier["dimensions"]}

    return {
        "accepted": True,
        "reason": None,
        "canonical_verdict": verifier["verdict"],
        "canonical_dimensions": verifier["dimensions"],
        "dimension_sets_equal": generator_dims == verifier_dims,
    }
