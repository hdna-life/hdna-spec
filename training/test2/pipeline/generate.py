#!/usr/bin/env python3
"""Stage 1: generator proposes candidates against coverage-plan.v1.json
quotas. Buckets are filled round-robin, not sequentially — a smoke run
short of the full 5K target still gets representation across every
bucket instead of exhausting the first one. The generator's proposal is
never ground truth — verify.py judges independently and blind.
Resumable: already-generated bucket counts are read back from --out
before continuing."""

from __future__ import annotations

import argparse
import os
import sys
from collections import Counter
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(LIB_DIR))
from budget import BudgetConfig, BudgetExceeded, BudgetTracker  # noqa: E402
from coverage import bucket_quotas, load_coverage_plan  # noqa: E402
from ids import candidate_id  # noqa: E402
from jsonl_io import append_jsonl, read_jsonl  # noqa: E402
from providers import GeneratorProvider  # noqa: E402

STALL_LIMIT = 10  # consecutive provider failures before giving up, not spinning forever


def language_cycle(coverage_plan: dict) -> list[str]:
    """Deterministic alternation matching the frozen language_mix, highest
    fraction first — for the frozen 50/50 tr/en mix this is a plain
    alternation."""
    language_mix = coverage_plan.get("language_mix", {"en": 1.0})
    return sorted(language_mix, key=lambda lang: (-language_mix[lang], lang))


def run(
    provider: GeneratorProvider,
    coverage_plan: dict,
    out_path: Path,
    failures_path: Path,
    max_total: int | None = None,
) -> dict[str, int | str | None]:
    quotas = bucket_quotas(coverage_plan)
    existing = list(read_jsonl(out_path))
    already_by_bucket: Counter[str] = Counter(r["coverage_bucket"] for r in existing)
    already_total = len(existing)

    remaining = {name: max(quota - already_by_bucket[name], 0) for name, quota in quotas.items()}
    active = [b for b in coverage_plan["coverage_buckets"] if remaining[b["bucket"]] > 0]
    languages = language_cycle(coverage_plan)

    generated_this_run = 0
    provider_errors = 0
    stopped_reason = None
    consecutive_failures = 0
    turn = 0

    while active:
        if max_total is not None and generated_this_run >= max_total:
            stopped_reason = "max_total"
            break

        bucket = active[turn % len(active)]
        name = bucket["bucket"]
        language = languages[(already_total + generated_this_run) % len(languages)]

        try:
            candidate = provider.generate({"bucket": name, "language": language, **bucket})
        except BudgetExceeded as err:
            stopped_reason = f"budget_exceeded: {err}"
            break
        except Exception as err:  # noqa: BLE001 — one failed call must not abort the run
            append_jsonl(failures_path, {"coverage_bucket": name, "language": language, "error": str(err)})
            provider_errors += 1
            consecutive_failures += 1
            if consecutive_failures >= STALL_LIMIT:
                stopped_reason = f"stalled: {consecutive_failures} consecutive generator failures"
                break
            turn += 1
            continue

        consecutive_failures = 0
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
        generated_this_run += 1
        remaining[name] -= 1
        if remaining[name] <= 0:
            active = [b for b in active if b["bucket"] != name]
        else:
            turn += 1

    return {"generated": generated_this_run, "provider_errors": provider_errors, "stopped_reason": stopped_reason}


def main() -> None:
    parser = argparse.ArgumentParser(description="Test 2 candidate generator.")
    parser.add_argument("--coverage-plan", default=str(Path(__file__).resolve().parent.parent / "coverage-plan.v1.json"))
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent.parent / "data" / "generated.jsonl"))
    parser.add_argument("--failures", default=str(Path(__file__).resolve().parent.parent / "data" / "failures" / "generate.jsonl"))
    parser.add_argument("--max-total", type=int, default=None, help="Cap total generated this run (e.g. for a smoke test).")
    parser.add_argument("--provider", choices=["mock", "openrouter"], default="openrouter")
    parser.add_argument("--model-id", default=None, help="Required with --provider openrouter.")
    parser.add_argument("--budget-requests", type=int, default=None, help="Required with --provider openrouter.")
    parser.add_argument("--budget-usd", type=float, default=None)
    parser.add_argument("--cost-per-request-usd", type=float, default=0.0)
    parser.add_argument("--max-output-tokens", type=int, default=800)
    args = parser.parse_args()

    coverage_plan = load_coverage_plan(Path(args.coverage_plan))

    if args.provider == "openrouter":
        api_key = os.environ.get("OPENROUTER_API_KEY")
        if not api_key:
            raise SystemExit("OPENROUTER_API_KEY is not set.")
        if not args.model_id:
            raise SystemExit("--model-id is required with --provider openrouter.")
        if args.budget_requests is None:
            raise SystemExit("--budget-requests is required with --provider openrouter — every real run needs a spend cap.")
        from real_providers import OpenRouterGeneratorProvider

        budget = BudgetTracker(BudgetConfig(args.budget_requests, args.budget_usd, args.cost_per_request_usd))
        provider = OpenRouterGeneratorProvider(api_key, args.model_id, budget, max_tokens=args.max_output_tokens)
    else:
        from providers import MockGeneratorProvider

        provider = MockGeneratorProvider(candidates=[])

    stats = run(provider, coverage_plan, Path(args.out), Path(args.failures), max_total=args.max_total)
    print(stats)


if __name__ == "__main__":
    main()
