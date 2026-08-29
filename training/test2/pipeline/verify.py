#!/usr/bin/env python3
"""Stage 3: blind verifier judgment + v1 acceptance policy.

The verifier receives ONLY kind/originalText/finalText/beforeContext/
afterContext — never the generator's proposal. Acceptance requires
verdict agreement and verifier confidence >= threshold; dimension-set
disagreement is recorded, not rejected — the verifier's dimensions become
the canonical target on acceptance."""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(LIB_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "phase5a" / "lore"))
from acceptance import VERIFIER_CONFIDENCE_THRESHOLD, decide_acceptance  # noqa: E402
from budget import BudgetConfig, BudgetExceeded, BudgetTracker  # noqa: E402
from jsonl_io import append_jsonl, read_ids, read_jsonl  # noqa: E402
from policy import is_valid_dimensions_list, load_policy  # noqa: E402
from providers import VerifierProvider  # noqa: E402

BLIND_INPUT_FIELDS = ("id", "kind", "originalText", "finalText", "beforeContext", "afterContext")


def run(
    provider: VerifierProvider,
    in_path: Path,
    out_path: Path,
    failures_path: Path,
    policy: dict,
    confidence_threshold: float = VERIFIER_CONFIDENCE_THRESHOLD,
) -> dict[str, int | str | None]:
    # Permanently-rejected IDs (deterministic policy reasons) are skipped on
    # resume; provider_error entries are retried — a transient failure must
    # not permanently exclude a candidate.
    permanently_rejected = {r["id"] for r in read_jsonl(failures_path) if r.get("reason") != "provider_error"}
    already_done = read_ids(out_path) | permanently_rejected
    accepted = rejected = errors = dimension_disagreements = 0
    rejection_reasons: Counter[str] = Counter()
    stopped_reason = None

    for record in read_jsonl(in_path):
        if record["id"] in already_done:
            continue

        blind_input = {field: record[field] for field in BLIND_INPUT_FIELDS}
        try:
            verifier_output = provider.verify(blind_input)
        except BudgetExceeded as err:
            stopped_reason = f"budget_exceeded: {err}"
            break
        except Exception as err:  # noqa: BLE001
            append_jsonl(failures_path, {"id": record["id"], "reason": "provider_error", "detail": str(err)})
            errors += 1
            continue

        if verifier_output["verdict"] not in policy["verdicts"] or not is_valid_dimensions_list(
            verifier_output["dimensions"], policy
        ):
            append_jsonl(failures_path, {"id": record["id"], "reason": "verifier_output_invalid"})
            rejection_reasons["verifier_output_invalid"] += 1
            rejected += 1
            continue

        record = {**record, "verifier": {"model_id": provider.model_id, **verifier_output}}
        decision = decide_acceptance(record, confidence_threshold)
        if decision["accepted"]:
            record["canonical_verdict"] = decision["canonical_verdict"]
            record["canonical_dimensions"] = decision["canonical_dimensions"]
            record["dimension_sets_equal"] = decision["dimension_sets_equal"]
            append_jsonl(out_path, record)
            accepted += 1
            if not decision["dimension_sets_equal"]:
                dimension_disagreements += 1
        else:
            append_jsonl(failures_path, {"id": record["id"], "reason": decision["reason"]})
            rejection_reasons[decision["reason"]] += 1
            rejected += 1

    return {
        "accepted": accepted,
        "rejected": rejected,
        "provider_errors": errors,
        "dimension_disagreements": dimension_disagreements,
        "rejection_reasons": dict(rejection_reasons),
        "stopped_reason": stopped_reason,
    }


def main() -> None:
    base = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Test 2 blind verifier.")
    parser.add_argument("--in", dest="input_path", default=str(base / "data" / "validated.jsonl"))
    parser.add_argument("--out", default=str(base / "data" / "verified.jsonl"))
    parser.add_argument("--failures", default=str(base / "data" / "failures" / "verify.jsonl"))
    parser.add_argument("--confidence-threshold", type=float, default=VERIFIER_CONFIDENCE_THRESHOLD)
    parser.add_argument("--provider", choices=["mock", "openrouter"], default="openrouter")
    parser.add_argument("--model-id", default=None, help="Required with --provider openrouter.")
    parser.add_argument("--budget-requests", type=int, default=None, help="Required with --provider openrouter.")
    parser.add_argument("--budget-usd", type=float, default=None)
    parser.add_argument("--cost-per-request-usd", type=float, default=0.0)
    parser.add_argument("--max-output-tokens", type=int, default=800)
    args = parser.parse_args()

    policy = load_policy()

    if args.provider == "openrouter":
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise SystemExit("OPENROUTER_API_KEY is not set.")
        if not args.model_id:
            raise SystemExit("--model-id is required with --provider openrouter.")
        if args.budget_requests is None:
            raise SystemExit("--budget-requests is required with --provider openrouter — every real run needs a spend cap.")
        from real_providers import OpenRouterVerifierProvider

        budget = BudgetTracker(BudgetConfig(args.budget_requests, args.budget_usd, args.cost_per_request_usd))
        provider = OpenRouterVerifierProvider(api_key, args.model_id, budget, max_tokens=args.max_output_tokens)
    else:
        from providers import MockVerifierProvider

        provider = MockVerifierProvider(verdicts_by_id={})

    stats = run(provider, Path(args.input_path), Path(args.out), Path(args.failures), policy, args.confidence_threshold)
    print(stats)


if __name__ == "__main__":
    main()
