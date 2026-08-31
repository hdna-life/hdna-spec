#!/usr/bin/env python3
"""Small real-provider smoke run: coverage bucket selection -> real
generator -> deterministic validation -> contamination guard (before the
verifier ever sees a candidate) -> blind real verifier -> acceptance
policy -> exact dedup -> contamination guard again (defense in depth) ->
smoke manifest. Does NOT build/freeze the final Test 2 corpus, train
anything, or touch acceptance thresholds/coverage quotas/the final
benchmark.

Every run is isolated under data/smoke/<run_id>/ — a new run_id never
reuses another run's artifacts. Re-running the SAME run_id resumes it:
`--max-candidates` is the TOTAL for the run_id across all invocations
(not "more, again"), the budget is cumulative and never resets, and the
run's model/coverage-plan/budget configuration is persisted at creation
and enforced unchanged on every resume.

Run: python3 smoke.py --run-id smoke-001 --generator-model-id ... \
    --verifier-model-id ... --generator-budget-requests 25 \
    --verifier-budget-requests 25
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(LIB_DIR))
from budget import BudgetConfig, restore_tracker, shared_spend_from_persisted  # noqa: E402
from contamination import filter_contaminated, load_protected_hashes  # noqa: E402
from coverage import load_coverage_plan  # noqa: E402
from jsonl_io import append_jsonl, read_jsonl, write_jsonl  # noqa: E402
from manifest import build_run_manifest, write_manifest  # noqa: E402
from protected_registry import registry_status  # noqa: E402
from run_state import BUDGET_STATE_FILENAME, RUN_CONFIG_FILENAME, build_run_config, load_budget_state, load_or_create_run_config, save_budget_state  # noqa: E402
from smoke_report import build_smoke_diagnostics  # noqa: E402

import dedupe  # noqa: E402
import generate  # noqa: E402
import validate  # noqa: E402
import verify  # noqa: E402

RUN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def resolve_run_dir(out_dir_root: Path, run_id: str) -> Path:
    if not RUN_ID_PATTERN.match(run_id):
        raise SystemExit(
            f"--run-id {run_id!r} is unsafe or empty — must match {RUN_ID_PATTERN.pattern} "
            "(this becomes a directory name under data/smoke/)."
        )
    run_dir = (out_dir_root / run_id).resolve()
    if out_dir_root.resolve() not in run_dir.parents:
        raise SystemExit(f"--run-id {run_id!r} escapes the smoke output root — refusing.")
    return run_dir


def compute_remaining_total(generated_path: Path, max_candidates: int) -> int:
    """`--max-candidates` is the TOTAL for a run_id across every
    invocation — not "this many more". Returns how many new candidates
    this invocation may still generate."""
    already_generated = sum(1 for _ in read_jsonl(generated_path))
    return max(0, max_candidates - already_generated)


def run_smoke(
    coverage_plan_path: Path,
    protected_registry_path: Path,
    out_dir_root: Path,
    run_id: str,
    generator_model_id: str,
    verifier_model_id: str,
    max_candidates: int,
    generator_budget_requests: int,
    verifier_budget_requests: int,
    max_budget_usd: float | None = None,
    max_cost_per_request_usd: float = 0.0,
    max_output_tokens: int = 800,
    verifier_confidence_threshold: float | None = None,
    allow_empty_protected_registry: bool = False,
) -> dict:
    from acceptance import VERIFIER_CONFIDENCE_THRESHOLD
    from policy import load_policy, POLICY_SPEC_PATH
    from real_providers import (
        GENERATOR_PROMPT_VERSION,
        OpenRouterGeneratorProvider,
        OpenRouterVerifierProvider,
        VERIFIER_PROMPT_VERSION,
        generator_prompt_sha256,
        verifier_prompt_sha256,
    )

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise SystemExit("OPENROUTER_API_KEY is not set.")

    confidence_threshold = verifier_confidence_threshold if verifier_confidence_threshold is not None else VERIFIER_CONFIDENCE_THRESHOLD

    out_dir = resolve_run_dir(out_dir_root, run_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "failures").mkdir(parents=True, exist_ok=True)

    # Canonical readiness gate (training/test2/lib/protected_registry.py) —
    # runs before any provider is constructed or any request is made. The
    # explicit override below permits ONLY a genuinely empty, well-formed
    # registry (deliberate infrastructure smoke testing); it never bypasses
    # a malformed or partially populated (1-9 of 10) registry.
    status = registry_status(protected_registry_path, expected_count=10)
    registry_override_used = False
    if not status["ready"]:
        is_genuinely_empty = status["ok"] and status["unique_count"] == 0
        if is_genuinely_empty and allow_empty_protected_registry:
            registry_override_used = True
            print(
                "WARNING: proceeding with an EMPTY protected-case registry via "
                "--allow-empty-protected-registry-smoke-only — no contamination guard is active this run.",
                file=sys.stderr,
            )
        else:
            detail = status.get("error") or (
                f"only {status['unique_count']} of {status['expected_count']} required unique protected-case "
                f"hashes are populated"
            )
            override_note = (
                "" if is_genuinely_empty else
                " --allow-empty-protected-registry-smoke-only only bypasses a genuinely EMPTY registry for "
                "deliberate infrastructure smoke testing — it never bypasses a malformed or partially "
                "populated registry."
            )
            raise SystemExit(
                f"Protected Test 1 benchmark registry is not ready ({protected_registry_path}): {detail} — "
                f"refusing real paid generation. Populate it via pipeline/add_protected_case.py and verify "
                f"with pipeline/check_protected_registry.py.{override_note}"
            )

    protected_hashes = load_protected_hashes(protected_registry_path)

    # Immutable run configuration: first invocation persists it; a resumed
    # invocation must match it exactly or is refused.
    requested_config = build_run_config(
        generator_model_id=generator_model_id, verifier_model_id=verifier_model_id,
        coverage_plan_path=coverage_plan_path, policy_spec_path=POLICY_SPEC_PATH,
        max_output_tokens=max_output_tokens, verifier_confidence_threshold=confidence_threshold,
        generator_budget_requests=generator_budget_requests, verifier_budget_requests=verifier_budget_requests,
        max_budget_usd=max_budget_usd, max_cost_per_request_usd=max_cost_per_request_usd,
        protected_registry_override_used=registry_override_used,
    )
    load_or_create_run_config(out_dir / RUN_CONFIG_FILENAME, requested_config)

    policy = load_policy()
    coverage_plan = load_coverage_plan(coverage_plan_path)

    # Cumulative budget: restore counters from any prior invocation of this
    # run_id — a restart must not reset the budget.
    budget_state_path = out_dir / BUDGET_STATE_FILENAME
    persisted_budget = load_budget_state(budget_state_path) or {}
    shared_spend = shared_spend_from_persisted(persisted_budget.get("generator"), persisted_budget.get("verifier"))
    generator_config = BudgetConfig(generator_budget_requests, max_budget_usd, max_cost_per_request_usd)
    verifier_config = BudgetConfig(verifier_budget_requests, max_budget_usd, max_cost_per_request_usd)
    generator_budget = restore_tracker(generator_config, shared_spend, persisted_budget.get("generator"))
    verifier_budget = restore_tracker(verifier_config, shared_spend, persisted_budget.get("verifier"))

    generator = OpenRouterGeneratorProvider(api_key, generator_model_id, generator_budget, max_tokens=max_output_tokens)
    verifier = OpenRouterVerifierProvider(api_key, verifier_model_id, verifier_budget, max_tokens=max_output_tokens)

    try:
        # `--max-candidates` is the TOTAL for this run_id, not "more, again" —
        # only the shortfall against what's already generated is requested.
        generated_path = out_dir / "generated.jsonl"
        remaining_total = compute_remaining_total(generated_path, max_candidates)
        gen_failures = out_dir / "failures" / "generate.jsonl"
        if remaining_total > 0:
            generate.run(generator, coverage_plan, generated_path, gen_failures, max_total=remaining_total)

        validated_path = out_dir / "validated.jsonl"
        validate_failures = out_dir / "failures" / "validate.jsonl"
        validate.run(generated_path, validated_path, validate_failures, policy)

        # Contamination guard BEFORE the verifier — a protected candidate must
        # never be sent to a verifier provider, real or otherwise.
        pre_verify_clean_path = out_dir / "pre_verify_clean.jsonl"
        pre_verify_clean, pre_verify_contaminated = filter_contaminated(list(read_jsonl(validated_path)), protected_hashes)
        write_jsonl(pre_verify_clean_path, pre_verify_clean)
        contamination_failures_path = out_dir / "failures" / "contamination.jsonl"
        already_flagged = {r["id"] for r in read_jsonl(contamination_failures_path)}
        for record in pre_verify_contaminated:
            if record["id"] not in already_flagged:
                append_jsonl(contamination_failures_path, {"id": record["id"], "reason": "contamination_pre_verify"})

        verified_path = out_dir / "verified.jsonl"
        verify_failures = out_dir / "failures" / "verify.jsonl"
        verify.run(verifier, pre_verify_clean_path, verified_path, verify_failures, policy, confidence_threshold)

        deduped_path = out_dir / "deduped.jsonl"
        dedup_report = out_dir / "dedup_report.jsonl"
        dedup_config = out_dir / "dedup_config.json"
        dedupe_stats = dedupe.run(verified_path, deduped_path, dedup_report, dedup_config, mode="smoke", embedding_provider=None)

        # Contamination guard AGAIN post-dedup — defense in depth, not a
        # substitute for the pre-verify check above.
        deduped = list(read_jsonl(deduped_path))
        final_clean, post_dedup_contaminated = filter_contaminated(deduped, protected_hashes)
        already_flagged = {r["id"] for r in read_jsonl(contamination_failures_path)}
        for record in post_dedup_contaminated:
            if record["id"] not in already_flagged:
                append_jsonl(contamination_failures_path, {"id": record["id"], "reason": "contamination_post_dedup"})
        write_jsonl(deduped_path, final_clean)
    finally:
        # Persist cumulative budget state even on failure — a crash mid-run
        # must not lose already-spent budget accounting.
        save_budget_state(budget_state_path, generator_budget.state_for_persistence(), verifier_budget.state_for_persistence(), {
            "reserved_usd": shared_spend.reserved_usd, "actual_usd": shared_spend.actual_usd,
        })

    diagnostics = build_smoke_diagnostics(out_dir, dedupe_stats, generator_budget.as_dict(), verifier_budget.as_dict())
    rejection_counts_by_reason = {
        "schema_invalid": diagnostics["schema_invalid_count"],
        "contamination_pre_verify": diagnostics["pre_verify_contamination_dropped"],
        "verdict_disagreement": diagnostics["semantic_verdict_disagreement_count"],
        "low_verifier_confidence": diagnostics["low_verifier_confidence_count"],
        "verifier_provider_error": diagnostics["verifier_provider_errors"],
        "contamination_post_dedup": diagnostics["post_dedup_contamination_dropped"],
    }

    manifest = build_run_manifest(
        run_id=run_id,
        contract_version="v3",
        policy_spec_path=POLICY_SPEC_PATH,
        coverage_plan_path=coverage_plan_path,
        generator_model_id=generator_model_id,
        verifier_model_id=verifier_model_id,
        generator_prompt_version=GENERATOR_PROMPT_VERSION,
        generator_prompt_sha256=generator_prompt_sha256(policy),
        verifier_prompt_version=VERIFIER_PROMPT_VERSION,
        verifier_prompt_sha256=verifier_prompt_sha256(policy),
        generation_params={"max_candidates": max_candidates, "max_output_tokens": max_output_tokens},
        verifier_confidence_threshold=confidence_threshold,
        semantic_dedup_threshold=None,
        semantic_dedup_provider_id=None,
        request_limits={"generator": generator_budget_requests, "verifier": verifier_budget_requests},
        max_budget_usd=max_budget_usd,
        max_cost_per_request_usd=max_cost_per_request_usd,
        generator_request_count=generator_budget.requests,
        verifier_request_count=verifier_budget.requests,
        reserved_generator_spend_usd=generator_budget.reserved_spend_usd,
        reserved_verifier_spend_usd=verifier_budget.reserved_spend_usd,
        reserved_total_spend_usd=diagnostics["total_reserved_spend_usd"],
        actual_generator_spend_usd=generator_budget.actual_spend_usd,
        actual_verifier_spend_usd=verifier_budget.actual_spend_usd,
        actual_total_spend_usd=diagnostics["total_actual_spend_usd"],
        contamination_reject_count=diagnostics["contamination_dropped"],
        stage_counts={"generated": diagnostics["generated_count"], "accepted": diagnostics["final_accepted_count"]},
        rejection_counts_by_reason=rejection_counts_by_reason,
        exact_dedup_count=diagnostics["exact_duplicates_dropped"],
        semantic_near_dedup_count=diagnostics["semantic_near_duplicates_dropped"],
        final_verdict_distribution=diagnostics["verdict_distribution"],
        final_language_distribution=diagnostics["language_distribution"],
        final_operation_distribution={},
        final_coverage_bucket_counts=diagnostics["coverage_bucket_distribution"],
        started_at="",
    )
    manifest["smoke"] = True
    manifest["diagnostics"] = diagnostics
    manifest["protected_registry_override_used"] = registry_override_used
    write_manifest(manifest, out_dir / f"{run_id}.smoke_manifest.json")
    return manifest


def main() -> None:
    base = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Test 2 real-provider smoke run.")
    parser.add_argument("--coverage-plan", default=str(base / "coverage-plan.v1.json"))
    parser.add_argument("--protected-registry", default=str(base / "benchmark" / "protected-cases.v1.json"))
    parser.add_argument("--out-dir", default=str(base / "data" / "smoke"), help="Root directory; each run_id gets its own subdirectory.")
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--generator-model-id", required=True)
    parser.add_argument("--verifier-model-id", required=True)
    parser.add_argument("--max-candidates", type=int, default=30, help="TOTAL candidates for this run_id across all invocations.")
    parser.add_argument("--generator-budget-requests", type=int, required=True)
    parser.add_argument("--verifier-budget-requests", type=int, required=True)
    parser.add_argument("--max-budget-usd", type=float, default=None, help="Shared cap across generator+verifier combined, cumulative across resumes.")
    parser.add_argument("--max-cost-per-request-usd", type=float, default=0.0, help="Conservative worst-case estimate used for the pre-request safety check.")
    parser.add_argument("--max-output-tokens", type=int, default=800)
    parser.add_argument("--verifier-confidence-threshold", type=float, default=None)
    parser.add_argument(
        "--allow-empty-protected-registry-smoke-only",
        action="store_true",
        help=(
            "Bypass the refusal ONLY when the registry is genuinely empty (0 hashes, valid schema). Never "
            "bypasses a malformed or partially populated (1-9 of 10) registry. Smoke-only infrastructure "
            "testing — never use for a real corpus-bound run."
        ),
    )
    args = parser.parse_args()

    if args.max_candidates > 50:
        raise SystemExit("Smoke runs are capped at 50 candidates — use the full pipeline for larger runs.")

    manifest = run_smoke(
        Path(args.coverage_plan), Path(args.protected_registry), Path(args.out_dir), args.run_id,
        args.generator_model_id, args.verifier_model_id, args.max_candidates,
        args.generator_budget_requests, args.verifier_budget_requests, args.max_budget_usd, args.max_cost_per_request_usd,
        args.max_output_tokens, args.verifier_confidence_threshold, args.allow_empty_protected_registry_smoke_only,
    )
    print(json.dumps(manifest["diagnostics"], indent=2))


if __name__ == "__main__":
    main()
