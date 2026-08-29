#!/usr/bin/env python3
"""Summarizes a completed smoke run's manifest for a human to decide
STOP/REVISE vs. PROCEED. Prints diagnostics only — makes no decision."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def print_summary(manifest: dict) -> None:
    d = manifest["diagnostics"]
    print(f"Smoke run: {manifest['run_id']} ({manifest.get('generator_model_id')} / {manifest.get('verifier_model_id')})")
    if manifest.get("protected_registry_override_used"):
        print("WARNING: this run used --allow-empty-protected-registry-smoke-only — no contamination guard was active.")
    print()
    print(f"Generated:                     {d['generated_count']} (generator errors: {d['generator_provider_errors']})")
    print(f"Schema-valid / invalid:        {d['schema_valid_count']} / {d['schema_invalid_count']}")
    print(f"Contamination dropped (pre):   {d['pre_verify_contamination_dropped']}")
    print(f"Verifier requests:             {d['verifier_request_count']} (provider errors: {d['verifier_provider_errors']})")
    print(f"Semantic verdict disagreement: {d['semantic_verdict_disagreement_count']}")
    print(f"Low verifier confidence:       {d['low_verifier_confidence_count']}")
    print(f"Accepted before dedup:         {d['accepted_before_dedup_count']}")
    print(f"Dimension disagreement:        {d['dimension_disagreement_count']} — metadata only, never a rejection reason")
    print(f"Exact duplicates dropped:      {d['exact_duplicates_dropped']}")
    print(f"Semantic near-dups dropped:    {d['semantic_near_duplicates_dropped']}")
    print(f"Contamination dropped (post):  {d['post_dedup_contamination_dropped']}")
    print(f"Final accepted:                {d['final_accepted_count']}")
    print(f"Language distribution:         {d['language_distribution']}")
    print(f"Coverage bucket distribution:  {d['coverage_bucket_distribution']}")
    print(f"Verdict distribution:          {d['verdict_distribution']}")
    print(f"Generator cost:                {d['generator_cost']}")
    print(f"Verifier cost:                 {d['verifier_cost']}")
    print(f"Total spend (USD):             {d['total_spend_usd']}")
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
