"""Diagnostics for a completed smoke run — built from each stage's own
returned stats, never re-derived by subtracting counts across stages
(subtraction silently absorbs whatever the other stages didn't account
for, e.g. treating dropped-for-any-reason as "exact duplicates")."""

from __future__ import annotations

from collections import Counter
from typing import Any


def build_smoke_diagnostics(
    generate_stats: dict,
    validate_stats: dict,
    pre_verify_contamination_count: int,
    verify_stats: dict,
    dedupe_stats: dict,
    post_dedup_contamination_count: int,
    final_records: list[dict],
    generator_budget: dict,
    verifier_budget: dict,
) -> dict[str, Any]:
    contamination_dropped = pre_verify_contamination_count + post_dedup_contamination_count
    return {
        "generated_count": generate_stats["generated"],
        "generator_provider_errors": generate_stats.get("provider_errors", 0),
        "schema_valid_count": validate_stats["passed"],
        "schema_invalid_count": validate_stats["rejected"],
        "pre_verify_contamination_dropped": pre_verify_contamination_count,
        "verifier_request_count": verify_stats["accepted"] + verify_stats["rejected"] + verify_stats["provider_errors"],
        "verifier_provider_errors": verify_stats["provider_errors"],
        "semantic_verdict_disagreement_count": verify_stats["rejection_reasons"].get("verdict_disagreement", 0),
        "low_verifier_confidence_count": verify_stats["rejection_reasons"].get("low_verifier_confidence", 0),
        "accepted_before_dedup_count": verify_stats["accepted"],
        "dimension_disagreement_count": verify_stats["dimension_disagreements"],
        "exact_duplicates_dropped": dedupe_stats["exact_dedup_count"],
        "semantic_near_duplicates_dropped": dedupe_stats["semantic_near_dedup_count"],
        "post_dedup_contamination_dropped": post_dedup_contamination_count,
        "contamination_dropped": contamination_dropped,
        "final_accepted_count": len(final_records),
        "language_distribution": dict(Counter(r["language"] for r in final_records)),
        "coverage_bucket_distribution": dict(Counter(r["coverage_bucket"] for r in final_records)),
        "verdict_distribution": dict(Counter(r["canonical_verdict"] for r in final_records)),
        "generator_cost": generator_budget,
        "verifier_cost": verifier_budget,
        "total_spend_usd": round(generator_budget.get("spend_usd", 0.0) + verifier_budget.get("spend_usd", 0.0), 6),
    }
