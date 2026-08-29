#!/usr/bin/env python3
"""Small real-provider smoke run: coverage bucket selection -> real
generator -> deterministic validation -> blind real verifier ->
acceptance policy -> exact dedup -> contamination guard -> smoke
manifest. Does NOT build/freeze the final Test 2 corpus, train anything,
or touch acceptance thresholds/coverage quotas/the final benchmark.

Run: python3 smoke.py --max-candidates 20 --generator-model-id ... \
    --verifier-model-id ... --generator-budget-requests 25 \
    --verifier-budget-requests 25
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(LIB_DIR))
from budget import BudgetConfig, BudgetTracker  # noqa: E402
from contamination import is_contaminated, load_protected_hashes  # noqa: E402
from coverage import load_coverage_plan  # noqa: E402
from jsonl_io import read_jsonl, write_jsonl  # noqa: E402
from manifest import build_run_manifest, write_manifest  # noqa: E402
from smoke_report import build_smoke_diagnostics  # noqa: E402

import dedupe  # noqa: E402
import generate  # noqa: E402
import validate  # noqa: E402
import verify  # noqa: E402


def run_smoke(
    coverage_plan_path: Path,
    protected_registry_path: Path,
    out_dir: Path,
    run_id: str,
    generator_model_id: str,
    verifier_model_id: str,
    max_candidates: int,
    generator_budget_requests: int,
    verifier_budget_requests: int,
    budget_usd: float | None = None,
    cost_per_request_usd: float = 0.0,
) -> dict:
    from policy import load_policy
    from real_providers import OpenRouterGeneratorProvider, OpenRouterVerifierProvider

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise SystemExit("OPENROUTER_API_KEY is not set.")

    policy = load_policy()
    coverage_plan = load_coverage_plan(coverage_plan_path)

    generator_budget = BudgetTracker(BudgetConfig(generator_budget_requests, budget_usd, cost_per_request_usd))
    verifier_budget = BudgetTracker(BudgetConfig(verifier_budget_requests, budget_usd, cost_per_request_usd))
    generator = OpenRouterGeneratorProvider(api_key, generator_model_id, generator_budget)
    verifier = OpenRouterVerifierProvider(api_key, verifier_model_id, verifier_budget)

    generated_path = out_dir / "generated.jsonl"
    gen_failures = out_dir / "failures" / "generate.jsonl"
    generate.run(generator, coverage_plan, generated_path, gen_failures, max_total=max_candidates)

    validated_path = out_dir / "validated.jsonl"
    validate_failures = out_dir / "failures" / "validate.jsonl"
    validate.run(generated_path, validated_path, validate_failures, policy)

    verified_path = out_dir / "verified.jsonl"
    verify_failures = out_dir / "failures" / "verify.jsonl"
    verify.run(verifier, validated_path, verified_path, verify_failures, policy)

    deduped_path = out_dir / "deduped.jsonl"
    dedup_report = out_dir / "dedup_report.jsonl"
    dedup_config = out_dir / "dedup_config.json"
    dedupe.run(verified_path, deduped_path, dedup_report, dedup_config, mode="smoke", embedding_provider=None)

    protected_hashes = load_protected_hashes(protected_registry_path)
    deduped = list(read_jsonl(deduped_path))
    clean = [r for r in deduped if not is_contaminated(r, protected_hashes)]
    contamination_count = len(deduped) - len(clean)
    write_jsonl(deduped_path, clean)

    diagnostics = build_smoke_diagnostics(
        generated_path, validated_path, verified_path, verify_failures, deduped_path,
        contamination_count, generator_budget.as_dict(), verifier_budget.as_dict(),
    )

    manifest = build_run_manifest(
        run_id=run_id,
        contract_version="v3",
        policy_spec_path=Path(coverage_plan["policy_spec"]),
        coverage_plan_path=coverage_plan_path,
        generator_model_id=generator_model_id,
        verifier_model_id=verifier_model_id,
        generation_params={"max_candidates": max_candidates},
        verifier_confidence_threshold=0.90,
        semantic_dedup_threshold=None,
        stage_counts={"generated": diagnostics["generated_count"], "accepted": diagnostics["accepted_count"]},
        rejection_counts_by_reason=diagnostics["rejection_counts_by_reason"],
        exact_dedup_count=diagnostics["generated_count"] - diagnostics["accepted_count"] - contamination_count,
        semantic_near_dedup_count=0,
        final_verdict_distribution=diagnostics["verdict_distribution"],
        final_language_distribution=diagnostics["language_distribution"],
        final_operation_distribution={},
        final_coverage_bucket_counts=diagnostics["coverage_bucket_distribution"],
        started_at="",
    )
    manifest["smoke"] = True
    manifest["diagnostics"] = diagnostics
    write_manifest(manifest, out_dir / f"{run_id}.smoke_manifest.json")
    return manifest


def main() -> None:
    base = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Test 2 real-provider smoke run.")
    parser.add_argument("--coverage-plan", default=str(base / "coverage-plan.v1.json"))
    parser.add_argument("--protected-registry", default=str(base / "benchmark" / "protected-cases.v1.json"))
    parser.add_argument("--out-dir", default=str(base / "data" / "smoke"))
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--generator-model-id", required=True)
    parser.add_argument("--verifier-model-id", required=True)
    parser.add_argument("--max-candidates", type=int, default=30)
    parser.add_argument("--generator-budget-requests", type=int, required=True)
    parser.add_argument("--verifier-budget-requests", type=int, required=True)
    parser.add_argument("--budget-usd", type=float, default=None)
    parser.add_argument("--cost-per-request-usd", type=float, default=0.0)
    args = parser.parse_args()

    if args.max_candidates > 50:
        raise SystemExit("Smoke runs are capped at 50 candidates — use the full pipeline for larger runs.")

    manifest = run_smoke(
        Path(args.coverage_plan), Path(args.protected_registry), Path(args.out_dir), args.run_id,
        args.generator_model_id, args.verifier_model_id, args.max_candidates,
        args.generator_budget_requests, args.verifier_budget_requests, args.budget_usd, args.cost_per_request_usd,
    )
    print(json.dumps(manifest["diagnostics"], indent=2))


if __name__ == "__main__":
    main()
