#!/usr/bin/env python3
"""Small real-provider smoke run: coverage bucket selection -> real
generator -> deterministic validation -> contamination guard (before the
verifier ever sees a candidate) -> blind real verifier -> acceptance
policy -> exact dedup -> contamination guard again (defense in depth) ->
smoke manifest. Does NOT build/freeze the final Test 2 corpus, train
anything, or touch acceptance thresholds/coverage quotas/the final
benchmark.

Every run is isolated under data/smoke/<run_id>/ — a new run_id never
reuses another run's artifacts; re-running the SAME run_id resumes it.

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
from budget import BudgetConfig, BudgetTracker, SharedSpend  # noqa: E402
from contamination import filter_contaminated, load_protected_hashes  # noqa: E402
from coverage import load_coverage_plan  # noqa: E402
from jsonl_io import append_jsonl, read_jsonl, write_jsonl  # noqa: E402
from manifest import build_run_manifest, write_manifest  # noqa: E402
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
    budget_usd: float | None = None,
    cost_per_request_usd: float = 0.0,
    max_output_tokens: int = 800,
    allow_empty_protected_registry: bool = False,
) -> dict:
    from policy import load_policy
    from real_providers import OpenRouterGeneratorProvider, OpenRouterVerifierProvider

    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise SystemExit("OPENROUTER_API_KEY is not set.")

    out_dir = resolve_run_dir(out_dir_root, run_id)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "failures").mkdir(parents=True, exist_ok=True)

    protected_hashes = load_protected_hashes(protected_registry_path)
    registry_override_used = False
    if not protected_hashes:
        if not allow_empty_protected_registry:
            raise SystemExit(
                "Protected Test 1 benchmark registry is empty (0 populated) — refusing real paid generation "
                "with no contamination guard in place. Populate it via pipeline/add_protected_case.py, or pass "
                "--allow-empty-protected-registry-smoke-only if this is deliberate temporary infrastructure "
                "smoke testing only (never for a real corpus-bound smoke run)."
            )
        registry_override_used = True
        print(
            "WARNING: proceeding with an EMPTY protected-case registry via "
            "--allow-empty-protected-registry-smoke-only — no contamination guard is active this run.",
            file=sys.stderr,
        )

    policy = load_policy()
    coverage_plan = load_coverage_plan(coverage_plan_path)

    shared_spend = SharedSpend()
    generator_budget = BudgetTracker(
        BudgetConfig(generator_budget_requests, budget_usd, cost_per_request_usd), shared_spend
    )
    verifier_budget = BudgetTracker(
        BudgetConfig(verifier_budget_requests, budget_usd, cost_per_request_usd), shared_spend
    )
    generator = OpenRouterGeneratorProvider(api_key, generator_model_id, generator_budget, max_tokens=max_output_tokens)
    verifier = OpenRouterVerifierProvider(api_key, verifier_model_id, verifier_budget, max_tokens=max_output_tokens)

    generated_path = out_dir / "generated.jsonl"
    gen_failures = out_dir / "failures" / "generate.jsonl"
    generate_stats = generate.run(generator, coverage_plan, generated_path, gen_failures, max_total=max_candidates)

    validated_path = out_dir / "validated.jsonl"
    validate_failures = out_dir / "failures" / "validate.jsonl"
    validate_stats = validate.run(generated_path, validated_path, validate_failures, policy)

    # Contamination guard BEFORE the verifier — a protected candidate must
    # never be sent to a verifier provider, real or otherwise.
    pre_verify_clean_path = out_dir / "pre_verify_clean.jsonl"
    pre_verify_clean, pre_verify_contaminated = filter_contaminated(list(read_jsonl(validated_path)), protected_hashes)
    write_jsonl(pre_verify_clean_path, pre_verify_clean)
    for record in pre_verify_contaminated:
        append_jsonl(out_dir / "failures" / "contamination.jsonl", {"id": record["id"], "reason": "contamination_pre_verify"})

    verified_path = out_dir / "verified.jsonl"
    verify_failures = out_dir / "failures" / "verify.jsonl"
    verify_stats = verify.run(verifier, pre_verify_clean_path, verified_path, verify_failures, policy)

    deduped_path = out_dir / "deduped.jsonl"
    dedup_report = out_dir / "dedup_report.jsonl"
    dedup_config = out_dir / "dedup_config.json"
    dedupe_stats = dedupe.run(verified_path, deduped_path, dedup_report, dedup_config, mode="smoke", embedding_provider=None)

    # Contamination guard AGAIN post-dedup — defense in depth, not a
    # substitute for the pre-verify check above.
    deduped = list(read_jsonl(deduped_path))
    final_clean, post_dedup_contaminated = filter_contaminated(deduped, protected_hashes)
    for record in post_dedup_contaminated:
        append_jsonl(out_dir / "failures" / "contamination.jsonl", {"id": record["id"], "reason": "contamination_post_dedup"})
    write_jsonl(deduped_path, final_clean)

    diagnostics = build_smoke_diagnostics(
        generate_stats, validate_stats, len(pre_verify_contaminated), verify_stats, dedupe_stats,
        len(post_dedup_contaminated), final_clean, generator_budget.as_dict(), verifier_budget.as_dict(),
    )

    manifest = build_run_manifest(
        run_id=run_id,
        contract_version="v3",
        policy_spec_path=Path(coverage_plan["policy_spec"]),
        coverage_plan_path=coverage_plan_path,
        generator_model_id=generator_model_id,
        verifier_model_id=verifier_model_id,
        generation_params={"max_candidates": max_candidates, "max_output_tokens": max_output_tokens},
        verifier_confidence_threshold=0.90,
        semantic_dedup_threshold=None,
        stage_counts={"generated": diagnostics["generated_count"], "accepted": diagnostics["final_accepted_count"]},
        rejection_counts_by_reason=verify_stats["rejection_reasons"],
        exact_dedup_count=dedupe_stats["exact_dedup_count"],
        semantic_near_dedup_count=dedupe_stats["semantic_near_dedup_count"],
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
    parser.add_argument("--max-candidates", type=int, default=30)
    parser.add_argument("--generator-budget-requests", type=int, required=True)
    parser.add_argument("--verifier-budget-requests", type=int, required=True)
    parser.add_argument("--budget-usd", type=float, default=None, help="Shared cap across generator+verifier combined, not each independently.")
    parser.add_argument("--cost-per-request-usd", type=float, default=0.0)
    parser.add_argument("--max-output-tokens", type=int, default=800)
    parser.add_argument(
        "--allow-empty-protected-registry-smoke-only",
        action="store_true",
        help="Bypass the empty-registry refusal. Smoke-only infrastructure testing — never use for a real corpus-bound run.",
    )
    args = parser.parse_args()

    if args.max_candidates > 50:
        raise SystemExit("Smoke runs are capped at 50 candidates — use the full pipeline for larger runs.")

    manifest = run_smoke(
        Path(args.coverage_plan), Path(args.protected_registry), Path(args.out_dir), args.run_id,
        args.generator_model_id, args.verifier_model_id, args.max_candidates,
        args.generator_budget_requests, args.verifier_budget_requests, args.budget_usd, args.cost_per_request_usd,
        args.max_output_tokens, args.allow_empty_protected_registry_smoke_only,
    )
    print(json.dumps(manifest["diagnostics"], indent=2))


if __name__ == "__main__":
    main()
