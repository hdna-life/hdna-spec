#!/usr/bin/env python3
"""
Phase 5A Trial 4: Write a reproducibility manifest for a trained LoRA adapter.

This script records metadata about training run: base model, dataset,
commit hash, and timestamp.

Usage:
  python3 write_manifest.py \\
    --lore-version v1 \\
    --dataset-dir dataset/prepared \\
    --adapter-path adapters/v1 \\
    --base-model Qwen/Qwen3-0.6B \\
    --out adapters/v1/manifest.json
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


def get_git_commit() -> Optional[str]:
    """Get current git commit hash (or None if git not available)."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
            timeout=5,
        )
        return result.stdout.strip()
    except Exception:
        # Git not available, in a detached head state, or error occurred
        return None


def count_jsonl_lines(file_path: Path) -> int:
    """Count lines in a JSONL file."""
    if not file_path.exists():
        return 0
    with open(file_path, "r", encoding="utf-8") as f:
        return sum(1 for _ in f)


def main():
    parser = argparse.ArgumentParser(
        description="Write reproducibility manifest for Phase 5A Trial 4 LoRA adapter."
    )
    parser.add_argument(
        "--lore-version",
        required=True,
        help="Task contract version (e.g., 'v1').",
    )
    parser.add_argument(
        "--dataset-dir",
        required=True,
        help="Path to dataset directory containing train.jsonl, valid.jsonl, test.jsonl.",
    )
    parser.add_argument(
        "--adapter-path",
        required=True,
        help="Path to trained adapter directory.",
    )
    parser.add_argument(
        "--base-model",
        required=True,
        help="Base model ID (e.g., 'Qwen/Qwen3-0.6B').",
    )
    parser.add_argument(
        "--out",
        required=True,
        help="Output manifest file path (typically adapter_path/manifest.json).",
    )
    args = parser.parse_args()

    # Collect metadata
    dataset_dir = Path(args.dataset_dir)
    train_count = count_jsonl_lines(dataset_dir / "train.jsonl")
    valid_count = count_jsonl_lines(dataset_dir / "valid.jsonl")
    test_count = count_jsonl_lines(dataset_dir / "test.jsonl")

    git_commit = get_git_commit()

    timestamp = datetime.now(timezone.utc).isoformat()

    manifest = {
        "lore_contract_version": args.lore_version,
        "base_model": args.base_model,
        "dataset_directory": str(args.dataset_dir),
        "dataset_counts": {
            "train": train_count,
            "valid": valid_count,
            "test": test_count,
        },
        "git_commit": git_commit,
        "timestamp_utc": timestamp,
    }

    # Write manifest
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(f"Manifest written to {out_path}:")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
