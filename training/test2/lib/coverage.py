"""Coverage-plan enforcement: bucket quotas, verdict bands, operation
minimums, all read from coverage-plan.v1.json — never hardcoded here."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any


def load_coverage_plan(path: Path) -> dict[str, Any]:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def bucket_quotas(plan: dict[str, Any]) -> dict[str, int]:
    return {b["bucket"]: b["quota"] for b in plan["coverage_buckets"]}


def select_within_quotas(records: list[dict], plan: dict[str, Any]) -> tuple[list[dict], list[dict]]:
    """Greedily accepts records up to each bucket's quota, in input order —
    input order should already reflect priority (e.g. earliest-verified
    first). Returns (selected, overflow)."""
    quotas = bucket_quotas(plan)
    counts: Counter[str] = Counter()
    selected: list[dict] = []
    overflow: list[dict] = []
    for record in records:
        bucket = record["coverage_bucket"]
        if counts[bucket] < quotas.get(bucket, 0):
            selected.append(record)
            counts[bucket] += 1
        else:
            overflow.append(record)
    return selected, overflow


def verdict_distribution(records: list[dict]) -> dict[str, float]:
    total = len(records)
    if total == 0:
        return {}
    counts = Counter(r["canonical_verdict"] for r in records)
    return {verdict: count / total for verdict, count in counts.items()}


def check_verdict_bands(records: list[dict], plan: dict[str, Any]) -> list[str]:
    """Returns human-readable violations; empty list means all bands satisfied."""
    distribution = verdict_distribution(records)
    violations = []
    for verdict, band in plan["verdict_bands"].items():
        fraction = distribution.get(verdict, 0.0)
        if not (band["min_fraction"] <= fraction <= band["max_fraction"]):
            violations.append(
                f"{verdict}: {fraction:.1%} outside [{band['min_fraction']:.0%}, {band['max_fraction']:.0%}]"
            )
    return violations


def check_operation_minimums(records: list[dict], plan: dict[str, Any]) -> list[str]:
    counts = Counter(r["kind"] for r in records)
    violations = []
    for operation, minimum in plan["operation_minimums"].items():
        if counts.get(operation, 0) < minimum:
            violations.append(f"{operation}: {counts.get(operation, 0)} < required minimum {minimum}")
    return violations


def check_bucket_quotas_met(records: list[dict], plan: dict[str, Any]) -> list[str]:
    """Every bucket must reach its quota exactly, not merely avoid exceeding it."""
    quotas = bucket_quotas(plan)
    counts = Counter(r["coverage_bucket"] for r in records)
    violations = []
    for bucket, quota in quotas.items():
        if counts.get(bucket, 0) < quota:
            violations.append(f"{bucket}: {counts.get(bucket, 0)} < required quota {quota}")
    return violations


def check_language_mix(records: list[dict], plan: dict[str, Any]) -> list[str]:
    total = len(records)
    if total == 0 or "language_mix" not in plan:
        return []
    tolerance = plan.get("language_mix_tolerance_fraction", 0.05)
    counts = Counter(r["language"] for r in records)
    violations = []
    for language, target_fraction in plan["language_mix"].items():
        fraction = counts.get(language, 0) / total
        if abs(fraction - target_fraction) > tolerance:
            violations.append(f"{language}: {fraction:.1%} outside target {target_fraction:.0%} ± {tolerance:.0%}")
    return violations
