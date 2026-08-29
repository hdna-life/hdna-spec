#!/usr/bin/env python3
"""Summarizes a completed smoke run's manifest for a human to decide
STOP/REVISE vs. PROCEED. Prints diagnostics only — makes no decision."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def format_rate(value: float | None) -> str:
    return f"{value:.1%}" if value is not None else "n/a"


def print_summary(manifest: dict) -> None:
    d = manifest["diagnostics"]
    print(f"Smoke run: {manifest['run_id']} ({manifest.get('generator_model_id')} / {manifest.get('verifier_model_id')})")
    print()
    print(f"Generated:                    {d['generated_count']}")
    print(f"Schema-valid:                 {d['schema_valid_count']} ({format_rate(d['schema_valid_rate'])})")
    print(f"Verifier requests:            {d['verifier_request_count']}")
    print(f"Semantic verdict agreement:   {d['semantic_verdict_agreement_count']} ({format_rate(d['semantic_verdict_agreement_rate'])})")
    print(f"Confidence rejections:        {d['verifier_confidence_rejection_count']} ({format_rate(d['verifier_confidence_rejection_rate'])})")
    print(f"Dimension disagreement:       {d['dimension_disagreement_count']} ({format_rate(d['dimension_disagreement_rate'])}) — metadata only, never a rejection reason")
    print(f"Accepted:                     {d['accepted_count']} ({format_rate(d['accepted_rate'])})")
    print(f"Contamination dropped:        {d['contamination_count']}")
    print(f"Rejection reasons:            {d['rejection_counts_by_reason']}")
    print(f"Language distribution:        {d['language_distribution']}")
    print(f"Coverage bucket distribution: {d['coverage_bucket_distribution']}")
    print(f"Verdict distribution:         {d['verdict_distribution']}")
    print(f"Generator cost:               {d['generator_cost']}")
    print(f"Verifier cost:                {d['verifier_cost']}")
    print(f"Total spend (USD):            {d['total_spend_usd']}")
    print()
    print(f"Acceptance criteria for reference: {Path(__file__).resolve().parent.parent / 'ACCEPTANCE_CRITERIA.md'}")
    print("This script does not decide STOP/REVISE vs. PROCEED — that is an operator judgment call.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Review a Test 2 smoke run.")
    parser.add_argument("manifest_path")
    args = parser.parse_args()
    manifest = json.loads(Path(args.manifest_path).read_text(encoding="utf-8"))
    print_summary(manifest)


if __name__ == "__main__":
    main()
