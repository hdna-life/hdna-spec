#!/usr/bin/env python3
"""Canonical full-run orchestration entrypoint for the eventual 5K
generation. NOT executed by this change — this only wires the existing
stages into one accepted-quota-driven path with hard safety ceilings.

Order: generate -> deterministic validation -> contamination guard ->
blind verifier -> acceptance -> exact dedup -> semantic near-dedup ->
contamination guard again -> quota/balance enforcement -> frozen
dataset (build_dataset.py, unchanged).

The frozen coverage-plan.v1.json bucket quotas are targets for ACCEPTED
examples, not generated candidates — schema rejection, verifier
disagreement, low confidence, provider failure, exact/semantic dedup,
and contamination all shrink a bucket's accepted count below what was
generated. This module replenishes each bucket — keeps generating for
it — until its accepted quota is met or an explicit ceiling stops it.
Ceilings are mandatory here (no large default): a bucket that can never
be satisfied (e.g. the verifier consistently disagrees) must stop safely
with progress preserved and the shortfall reported, never loop forever
and never freeze a corpus with missing quotas — build_dataset.py already
refuses that unconditionally."""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections import Counter
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(LIB_DIR))
from budget import BudgetExceeded  # noqa: E402
from contamination import filter_contaminated, load_protected_hashes  # noqa: E402
from coverage import bucket_quotas, load_coverage_plan  # noqa: E402
from ids import candidate_id  # noqa: E402
from jsonl_io import append_jsonl, read_jsonl, write_jsonl  # noqa: E402
from protected_registry import require_ready  # noqa: E402

PROTECTED_REGISTRY_EXPECTED_COUNT = 10

import dedupe  # noqa: E402
import generate  # noqa: E402
import validate  # noqa: E402
import verify  # noqa: E402


def _append_generated(out_path: Path, provider, name: str, language: str, bucket_def: dict) -> None:
    candidate = provider.generate({"bucket": name, "language": language, **bucket_def})
    record = {
        "id": candidate_id(
            candidate["kind"], candidate["beforeContext"], candidate["originalText"],
            candidate["finalText"], candidate["afterContext"],
        ),
        "coverage_bucket": name,
        "language": candidate["language"],
        "kind": candidate["kind"],
        "beforeContext": candidate["beforeContext"],
        "originalText": candidate["originalText"],
        "finalText": candidate["finalText"],
        "afterContext": candidate["afterContext"],
        "generator": {
            "model_id": provider.model_id,
            "proposedVerdict": candidate["proposedVerdict"],
            "proposedDimensions": candidate["proposedDimensions"],
            "proposedExplanation": candidate.get("proposedExplanation"),
        },
    }
    append_jsonl(out_path, record)


def replenish_to_accepted_quota(
    generator,
    verifier,
    coverage_plan: dict,
    protected_registry_path: Path,
    policy: dict,
    out_dir: Path,
    max_total_requests: int,
    max_attempts_per_bucket: int,
    embedding_provider=None,
    semantic_threshold: float = 0.92,
) -> dict:
    """Loops in rounds: each round attempts one new candidate per bucket
    still short of its accepted quota (and under its own attempt
    ceiling), then re-runs validate -> contamination -> verify -> dedup
    -> contamination once for the whole round. Stops when every bucket's
    quota is met, or `max_total_requests` generator attempts are used up,
    or every still-short bucket has hit `max_attempts_per_bucket`."""
    # Canonical readiness gate (training/test2/lib/protected_registry.py) —
    # runs before any generation/provider work begins. Unlike smoke, there
    # is NO override here: an empty, malformed, or partially populated
    # (1-9 of 10) registry all refuse identically.
    require_ready(protected_registry_path, expected_count=PROTECTED_REGISTRY_EXPECTED_COUNT)
    protected_hashes = load_protected_hashes(protected_registry_path)

    quotas = bucket_quotas(coverage_plan)
    languages = generate.language_cycle(coverage_plan)
    generated_path = out_dir / "generated.jsonl"
    validated_path = out_dir / "validated.jsonl"
    validate_failures = out_dir / "failures" / "validate.jsonl"
    gen_failures = out_dir / "failures" / "generate.jsonl"
    pre_verify_clean_path = out_dir / "pre_verify_clean.jsonl"
    contamination_failures_path = out_dir / "failures" / "contamination.jsonl"
    verified_path = out_dir / "verified.jsonl"
    verify_failures = out_dir / "failures" / "verify.jsonl"
    deduped_path = out_dir / "deduped.jsonl"
    dedup_report = out_dir / "dedup_report.jsonl"
    dedup_config_path = out_dir / "dedup_config.json"

    attempts_by_bucket: Counter[str] = Counter()
    total_attempts = 0
    lang_index = 0
    stopped_reason = None

    def current_accepted_counts() -> Counter[str]:
        validate.run(generated_path, validated_path, validate_failures, policy)
        clean, contaminated = filter_contaminated(list(read_jsonl(validated_path)), protected_hashes)
        write_jsonl(pre_verify_clean_path, clean)
        already_flagged = {r["id"] for r in read_jsonl(contamination_failures_path)}
        for record in contaminated:
            if record["id"] not in already_flagged:
                append_jsonl(contamination_failures_path, {"id": record["id"], "reason": "contamination_pre_verify"})

        verify.run(verifier, pre_verify_clean_path, verified_path, verify_failures, policy)
        dedupe_stats = dedupe.run(
            verified_path, deduped_path, dedup_report, dedup_config_path, mode="full",
            embedding_provider=embedding_provider, threshold=semantic_threshold,
        )
        deduped = list(read_jsonl(deduped_path))
        final_clean, post_contaminated = filter_contaminated(deduped, protected_hashes)
        already_flagged = {r["id"] for r in read_jsonl(contamination_failures_path)}
        for record in post_contaminated:
            if record["id"] not in already_flagged:
                append_jsonl(contamination_failures_path, {"id": record["id"], "reason": "contamination_post_dedup"})
        write_jsonl(deduped_path, final_clean)
        return Counter(r["coverage_bucket"] for r in final_clean), dedupe_stats

    accepted_counts, dedupe_stats = current_accepted_counts()

    while True:
        missing = {b: quotas[b] - accepted_counts.get(b, 0) for b in quotas if accepted_counts.get(b, 0) < quotas[b]}
        if not missing:
            break
        if total_attempts >= max_total_requests:
            stopped_reason = "max_total_requests"
            break
        eligible = [b for b in missing if attempts_by_bucket[b] < max_attempts_per_bucket]
        if not eligible:
            stopped_reason = "every_short_bucket_hit_max_attempts_per_bucket"
            break

        made_progress_this_round = False
        for bucket_name in eligible:
            if total_attempts >= max_total_requests:
                break
            bucket_def = next(b for b in coverage_plan["coverage_buckets"] if b["bucket"] == bucket_name)
            language = languages[lang_index % len(languages)]
            lang_index += 1
            try:
                _append_generated(generated_path, generator, bucket_name, language, bucket_def)
                made_progress_this_round = True
            except BudgetExceeded as err:
                stopped_reason = f"budget_exceeded: {err}"
                break
            except Exception as err:  # noqa: BLE001 — one failed attempt must not abort the round
                append_jsonl(gen_failures, {"coverage_bucket": bucket_name, "language": language, "error": str(err)})
            attempts_by_bucket[bucket_name] += 1
            total_attempts += 1
        if stopped_reason:
            break

        accepted_counts, dedupe_stats = current_accepted_counts()
        if not made_progress_this_round:
            stopped_reason = "no_progress"
            break

    missing_quotas = {b: quotas[b] - accepted_counts.get(b, 0) for b in quotas if accepted_counts.get(b, 0) < quotas[b]}
    return {
        "accepted_counts": dict(accepted_counts),
        "missing_quotas": missing_quotas,
        "total_attempts": total_attempts,
        "attempts_by_bucket": dict(attempts_by_bucket),
        "stopped_reason": stopped_reason,
        "dedupe_stats": dedupe_stats,
    }


def main() -> None:
    raise SystemExit(
        "full_run.py is the canonical orchestration entrypoint for the eventual 5K generation. It is not wired "
        "up for direct CLI execution in this pass — call replenish_to_accepted_quota() explicitly with real "
        "generator/verifier providers, an explicit semantic embedding provider, and explicit safety ceilings "
        "once those are ready. This refusal is intentional."
    )


if __name__ == "__main__":
    main()
