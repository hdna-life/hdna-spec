"""Diagnostics for a completed smoke run — built by re-reading the
run's persisted artifacts, never by re-deriving one stage's count via
subtraction of others. Stage JSONL files are append-only/idempotently
overwritten-in-full (see pipeline stages), so re-reading them after any
invocation — first or resumed — always yields the CUMULATIVE totals for
the whole run_id, not just the latest invocation."""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

from jsonl_io import read_jsonl


def build_smoke_diagnostics(
    out_dir: Path,
    dedupe_stats: dict,
    generator_budget: dict,
    verifier_budget: dict,
) -> dict[str, Any]:
    generated = list(read_jsonl(out_dir / "generated.jsonl"))
    generate_failures = list(read_jsonl(out_dir / "failures" / "generate.jsonl"))
    validated = list(read_jsonl(out_dir / "validated.jsonl"))
    validate_failures = list(read_jsonl(out_dir / "failures" / "validate.jsonl"))
    contamination_failures = list(read_jsonl(out_dir / "failures" / "contamination.jsonl"))
    verified = list(read_jsonl(out_dir / "verified.jsonl"))  # accepted only
    verify_failures = list(read_jsonl(out_dir / "failures" / "verify.jsonl"))
    final_records = list(read_jsonl(out_dir / "deduped.jsonl"))  # post exact+semantic dedup, post 2nd contamination pass

    verify_rejection_reasons = Counter(f.get("reason", "unknown") for f in verify_failures)
    pre_verify_contamination = sum(1 for f in contamination_failures if f.get("reason") == "contamination_pre_verify")
    post_dedup_contamination = sum(1 for f in contamination_failures if f.get("reason") == "contamination_post_dedup")
    dimension_disagreements = sum(1 for r in verified if r.get("dimension_sets_equal") is False)

    return {
        "generated_count": len(generated),
        "generator_provider_errors": len(generate_failures),
        "schema_valid_count": len(validated),
        "schema_invalid_count": len(validate_failures),
        "pre_verify_contamination_dropped": pre_verify_contamination,
        "verifier_request_count": len(verified) + len(verify_failures),
        "verifier_provider_errors": verify_rejection_reasons.get("provider_error", 0),
        "semantic_verdict_disagreement_count": verify_rejection_reasons.get("verdict_disagreement", 0),
        "low_verifier_confidence_count": verify_rejection_reasons.get("low_verifier_confidence", 0),
        "accepted_before_dedup_count": len(verified),
        "dimension_disagreement_count": dimension_disagreements,
        "exact_duplicates_dropped": dedupe_stats["exact_dedup_count"],
        "semantic_near_duplicates_dropped": dedupe_stats["semantic_near_dedup_count"],
        "post_dedup_contamination_dropped": post_dedup_contamination,
        "contamination_dropped": pre_verify_contamination + post_dedup_contamination,
        "final_accepted_count": len(final_records),
        "language_distribution": dict(Counter(r["language"] for r in final_records)),
        "coverage_bucket_distribution": dict(Counter(r["coverage_bucket"] for r in final_records)),
        "verdict_distribution": dict(Counter(r["canonical_verdict"] for r in final_records)),
        "generator_cost": generator_budget,
        "verifier_cost": verifier_budget,
        "total_reserved_spend_usd": round(generator_budget.get("reserved_spend_usd", 0.0) + verifier_budget.get("reserved_spend_usd", 0.0), 6),
        "total_actual_spend_usd": round(generator_budget.get("actual_spend_usd", 0.0) + verifier_budget.get("actual_spend_usd", 0.0), 6),
    }
