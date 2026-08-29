"""Diagnostics for a completed smoke run — pure functions over the stage
JSONL artifacts, no side effects."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from jsonl_io import read_jsonl


def _rate(numerator: int, denominator: int) -> float | None:
    return numerator / denominator if denominator else None


def build_smoke_diagnostics(
    generated_path: Path,
    validated_path: Path,
    verified_path: Path,
    verify_failures_path: Path,
    deduped_path: Path,
    contamination_count: int,
    generator_budget: dict,
    verifier_budget: dict,
) -> dict[str, Any]:
    generated = list(read_jsonl(generated_path))
    validated = list(read_jsonl(validated_path))
    verified = list(read_jsonl(verified_path))  # accepted only
    verify_failures = list(read_jsonl(verify_failures_path))
    deduped = list(read_jsonl(deduped_path))

    rejection_reasons = Counter(f.get("reason", "unknown") for f in verify_failures)
    dimension_disagreements = sum(1 for r in verified if r.get("dimension_sets_equal") is False)
    verifier_requests = len(verified) + len(verify_failures)

    return {
        "generated_count": len(generated),
        "schema_valid_count": len(validated),
        "schema_valid_rate": _rate(len(validated), len(generated)),
        "verifier_request_count": verifier_requests,
        "semantic_verdict_agreement_count": len(verified) + rejection_reasons.get("low_verifier_confidence", 0),
        "semantic_verdict_agreement_rate": _rate(
            len(verified) + rejection_reasons.get("low_verifier_confidence", 0), verifier_requests
        ),
        "verifier_confidence_rejection_count": rejection_reasons.get("low_verifier_confidence", 0),
        "verifier_confidence_rejection_rate": _rate(rejection_reasons.get("low_verifier_confidence", 0), verifier_requests),
        "dimension_disagreement_count": dimension_disagreements,
        "dimension_disagreement_rate": _rate(dimension_disagreements, len(verified)),
        "accepted_count": len(deduped),
        "accepted_rate": _rate(len(deduped), len(generated)),
        "rejection_counts_by_reason": dict(rejection_reasons),
        "contamination_count": contamination_count,
        "language_distribution": dict(Counter(r["language"] for r in deduped)),
        "coverage_bucket_distribution": dict(Counter(r["coverage_bucket"] for r in deduped)),
        "verdict_distribution": dict(Counter(r["canonical_verdict"] for r in deduped)),
        "generator_cost": generator_budget,
        "verifier_cost": verifier_budget,
        "total_spend_usd": round(generator_budget.get("spend_usd", 0.0) + verifier_budget.get("spend_usd", 0.0), 6),
    }
