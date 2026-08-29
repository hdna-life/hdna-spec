#!/usr/bin/env python3
"""Stage 4: exact normalized dedup, then semantic near-dedup if an
embedding provider is explicitly configured (fails closed otherwise — see
lib/dedup.py). Pure/deterministic over the full verified set; recomputed
from scratch each run rather than incrementally resumed."""

from __future__ import annotations

import argparse
import sys
from dataclasses import asdict
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(LIB_DIR))
from dedup import exact_dedup, semantic_near_dedup  # noqa: E402
from jsonl_io import read_jsonl, write_jsonl  # noqa: E402

DEFAULT_SEMANTIC_THRESHOLD = 0.92


def run(in_path: Path, out_path: Path, report_path: Path, embedding_provider=None, threshold: float = DEFAULT_SEMANTIC_THRESHOLD):
    records = list(read_jsonl(in_path))
    after_exact, exact_drops = exact_dedup(records)
    after_semantic, semantic_drops = semantic_near_dedup(after_exact, embedding_provider, threshold)

    write_jsonl(out_path, after_semantic)
    write_jsonl(report_path, [asdict(d) for d in (exact_drops + semantic_drops)])

    return {
        "input": len(records),
        "output": len(after_semantic),
        "exact_dedup_count": len(exact_drops),
        "semantic_near_dedup_count": len(semantic_drops),
    }


def main() -> None:
    base = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Test 2 dedup.")
    parser.add_argument("--in", dest="input_path", default=str(base / "data" / "verified.jsonl"))
    parser.add_argument("--out", default=str(base / "data" / "deduped.jsonl"))
    parser.add_argument("--report", default=str(base / "data" / "dedup_report.jsonl"))
    parser.add_argument("--semantic-threshold", type=float, default=DEFAULT_SEMANTIC_THRESHOLD)
    parser.add_argument(
        "--semantic-embedding-provider",
        default=None,
        help="Not yet decided — omit to skip semantic near-dedup (exact dedup still runs).",
    )
    args = parser.parse_args()

    if args.semantic_embedding_provider is not None:
        raise SystemExit("No semantic embedding provider is configured yet. Run without --semantic-embedding-provider.")

    stats = run(Path(args.input_path), Path(args.out), Path(args.report), embedding_provider=None, threshold=args.semantic_threshold)
    print(stats)


if __name__ == "__main__":
    main()
