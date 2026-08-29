#!/usr/bin/env python3
"""Write a reproducibility manifest for a trained LoRA adapter: contract
version, policy-spec/dataset checksums, base model, training config, git
commit, timestamp, and dataset counts.
"""

import argparse
import hashlib
import json
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


def get_git_commit() -> Optional[str]:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True, timeout=5
        )
        return result.stdout.strip()
    except Exception:
        return None


def count_jsonl_lines(file_path: Path) -> int:
    if not file_path.exists():
        return 0
    with open(file_path, "r", encoding="utf-8") as f:
        return sum(1 for _ in f)


def sha256_of(file_path: Path) -> Optional[str]:
    if not file_path.exists():
        return None
    digest = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description="Write reproducibility manifest for a trained LoRA adapter.")
    parser.add_argument("--contract-version", required=True, help="task-contract version this run trained against, e.g. 'v3'.")
    parser.add_argument("--dataset-dir", required=True, help="Directory containing train.jsonl, valid.jsonl, test.jsonl.")
    parser.add_argument("--adapter-path", required=True, help="Trained adapter output directory.")
    parser.add_argument("--base-model", required=True, help="Base model ID, e.g. 'Qwen/Qwen3-0.6B'.")
    parser.add_argument("--out", required=True, help="Output manifest file path.")
    parser.add_argument("--policy-spec-path", default=None, help="Path to policy-spec.v*.json to checksum.")
    parser.add_argument("--dataset-source-path", default=None, help="Path to the source training-dataset export JSON to checksum.")
    parser.add_argument("--iters", type=int, default=None)
    parser.add_argument("--batch-size", type=int, default=None)
    parser.add_argument("--learning-rate", type=float, default=None)
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir)
    manifest = {
        "contract_version": args.contract_version,
        "base_model": args.base_model,
        "dataset_directory": str(args.dataset_dir),
        "dataset_counts": {
            "train": count_jsonl_lines(dataset_dir / "train.jsonl"),
            "valid": count_jsonl_lines(dataset_dir / "valid.jsonl"),
            "test": count_jsonl_lines(dataset_dir / "test.jsonl"),
        },
        "policy_spec_sha256": sha256_of(Path(args.policy_spec_path)) if args.policy_spec_path else None,
        "dataset_source_sha256": sha256_of(Path(args.dataset_source_path)) if args.dataset_source_path else None,
        "training_config": {
            "iters": args.iters,
            "batch_size": args.batch_size,
            "learning_rate": args.learning_rate,
        },
        "git_commit": get_git_commit(),
        "timestamp_utc": datetime.now(timezone.utc).isoformat(),
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2)

    print(f"Manifest written to {out_path}:")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
