"""v1 generator/verifier acceptance policy. The verifier's independent
judgment — never the generator's proposal — becomes the canonical training
target once the semantic verdict is independently confirmed. Exact
dimension-set agreement between generator and verifier is NOT required;
disagreement there is recorded for audit, not rejected."""

from __future__ import annotations

VERIFIER_CONFIDENCE_THRESHOLD = 0.90


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
