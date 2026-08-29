"""Run manifest — never stores API keys, only configuration/results."""

from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def sha256_of(path: Path) -> str | None:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def get_git_commit() -> str | None:
    try:
        result = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True, timeout=5)
        return result.stdout.strip()
    except Exception:
        return None


def build_run_manifest(
    run_id: str,
    contract_version: str,
    policy_spec_path: Path,
    coverage_plan_path: Path,
    generator_model_id: str,
    verifier_model_id: str,
    generation_params: dict[str, Any],
    verifier_confidence_threshold: float,
    semantic_dedup_threshold: float | None,
    stage_counts: dict[str, int],
    rejection_counts_by_reason: dict[str, int],
    exact_dedup_count: int,
    semantic_near_dedup_count: int,
    final_verdict_distribution: dict[str, float],
    final_language_distribution: dict[str, float],
    final_operation_distribution: dict[str, float],
    final_coverage_bucket_counts: dict[str, int],
    started_at: str,
) -> dict[str, Any]:
    return {
        "run_id": run_id,
        "git_commit": get_git_commit(),
        "contract_version": contract_version,
        "policy_spec_sha256": sha256_of(policy_spec_path),
        "coverage_plan_sha256": sha256_of(coverage_plan_path),
        "generator_model_id": generator_model_id,
        "verifier_model_id": verifier_model_id,
        "generation_params": generation_params,
        "verifier_confidence_threshold": verifier_confidence_threshold,
        "semantic_dedup_threshold": semantic_dedup_threshold,
        "language_targets": {"tr": 0.5, "en": 0.5},
        "accepted_count_target": 5000,
        "started_at_utc": started_at,
        "completed_at_utc": datetime.now(timezone.utc).isoformat(),
        "stage_counts": stage_counts,
        "rejection_counts_by_reason": rejection_counts_by_reason,
        "exact_dedup_count": exact_dedup_count,
        "semantic_near_dedup_count": semantic_near_dedup_count,
        "final_verdict_distribution": final_verdict_distribution,
        "final_language_distribution": final_language_distribution,
        "final_operation_distribution": final_operation_distribution,
        "final_coverage_bucket_counts": final_coverage_bucket_counts,
    }


def write_manifest(manifest: dict[str, Any], out_path: Path) -> None:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
