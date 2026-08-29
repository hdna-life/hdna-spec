#!/usr/bin/env python3
"""Stage 5: contamination guard, coverage-quota selection, verdict-band and
operation-minimum checks, deterministic train/valid/internal-test split,
frozen corpus + run manifest. The internal test split is a training
diagnostic only — never the final Test 2 benchmark, which stays external
and fresh."""

from __future__ import annotations

import argparse
import random
import sys
from collections import Counter
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(LIB_DIR))
from contamination import is_contaminated, load_protected_hashes  # noqa: E402
from coverage import check_operation_minimums, check_verdict_bands, load_coverage_plan, select_within_quotas  # noqa: E402
from jsonl_io import append_jsonl, read_jsonl, write_jsonl  # noqa: E402
from manifest import build_run_manifest, write_manifest  # noqa: E402

TRAIN_FRACTION, VALID_FRACTION = 0.8, 0.1


def run(
    in_path: Path,
    coverage_plan_path: Path,
    protected_registry_path: Path,
    out_dir: Path,
    failures_path: Path,
    run_id: str,
    verifier_model_id: str,
    seed: int = 42,
) -> dict:
    records = list(read_jsonl(in_path))
    plan = load_coverage_plan(coverage_plan_path)
    protected_hashes = load_protected_hashes(protected_registry_path)

    clean = []
    contamination_count = 0
    for record in records:
        if is_contaminated(record, protected_hashes):
            append_jsonl(failures_path, {"id": record["id"], "reason": "contamination"})
            contamination_count += 1
        else:
            clean.append(record)

    selected, overflow = select_within_quotas(clean, plan)
    for record in overflow:
        append_jsonl(failures_path, {"id": record["id"], "reason": "coverage_quota_full"})

    band_violations = check_verdict_bands(selected, plan)
    operation_violations = check_operation_minimums(selected, plan)

    random.Random(seed).shuffle(selected)
    n = len(selected)
    train_end = int(TRAIN_FRACTION * n)
    valid_end = train_end + int(VALID_FRACTION * n)
    train, valid, internal_test = selected[:train_end], selected[train_end:valid_end], selected[valid_end:]

    accepted_path = out_dir / "accepted.jsonl"
    write_jsonl(accepted_path, selected)
    write_jsonl(out_dir / "train.jsonl", train)
    write_jsonl(out_dir / "valid.jsonl", valid)
    write_jsonl(out_dir / "internal_test.jsonl", internal_test)

    verdict_counts = Counter(r["canonical_verdict"] for r in selected)
    language_counts = Counter(r["language"] for r in selected)
    operation_counts = Counter(r["kind"] for r in selected)
    bucket_counts = Counter(r["coverage_bucket"] for r in selected)

    manifest = build_run_manifest(
        run_id=run_id,
        contract_version="v3",
        policy_spec_path=Path(plan["policy_spec"]),
        coverage_plan_path=coverage_plan_path,
        generator_model_id="unset",
        verifier_model_id=verifier_model_id,
        generation_params={},
        verifier_confidence_threshold=0.90,
        semantic_dedup_threshold=None,
        stage_counts={"input": len(records), "clean": len(clean), "selected": n},
        rejection_counts_by_reason={"contamination": contamination_count, "coverage_quota_full": len(overflow)},
        exact_dedup_count=0,
        semantic_near_dedup_count=0,
        final_verdict_distribution={k: v / n for k, v in verdict_counts.items()} if n else {},
        final_language_distribution={k: v / n for k, v in language_counts.items()} if n else {},
        final_operation_distribution={k: v / n for k, v in operation_counts.items()} if n else {},
        final_coverage_bucket_counts=dict(bucket_counts),
        started_at="",
    )
    write_manifest(manifest, out_dir / f"{run_id}.manifest.json")

    return {
        "accepted": n,
        "train": len(train),
        "valid": len(valid),
        "internal_test": len(internal_test),
        "contamination_dropped": contamination_count,
        "coverage_overflow_dropped": len(overflow),
        "verdict_band_violations": band_violations,
        "operation_minimum_violations": operation_violations,
    }


def main() -> None:
    base = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Test 2 dataset builder.")
    parser.add_argument("--in", dest="input_path", default=str(base / "data" / "deduped.jsonl"))
    parser.add_argument("--coverage-plan", default=str(base / "coverage-plan.v1.json"))
    parser.add_argument("--protected-registry", default=str(base / "benchmark" / "protected-cases.v1.json"))
    parser.add_argument("--out-dir", default=str(base / "data" / "frozen"))
    parser.add_argument("--failures", default=str(base / "data" / "failures" / "build_dataset.jsonl"))
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--verifier-model-id", default="unset")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    stats = run(
        Path(args.input_path), Path(args.coverage_plan), Path(args.protected_registry), Path(args.out_dir),
        Path(args.failures), args.run_id, args.verifier_model_id, args.seed,
    )
    print(stats)
    if stats["verdict_band_violations"] or stats["operation_minimum_violations"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
