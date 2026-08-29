#!/usr/bin/env python3
"""Adds one case's content hash to the protected-cases registry, without
ever writing the raw text to disk in this repository. Run locally against
Test 1's benchmark file and Test 2's own held-out set before generation."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from ids import normalized_pair_hash  # noqa: E402

REGISTRY_PATH = Path(__file__).resolve().parent.parent / "benchmark" / "protected-cases.v1.json"


def main() -> None:
    parser = argparse.ArgumentParser(description="Add a case's hash to the protected-cases registry.")
    parser.add_argument("--original-text", required=True)
    parser.add_argument("--final-text", required=True)
    parser.add_argument("--registry", default=str(REGISTRY_PATH))
    args = parser.parse_args()

    registry_path = Path(args.registry)
    registry = json.loads(registry_path.read_text(encoding="utf-8")) if registry_path.exists() else {
        "version": "v1",
        "protected_pair_hashes": [],
    }
    pair_hash = normalized_pair_hash(args.original_text, args.final_text)
    if pair_hash not in registry["protected_pair_hashes"]:
        registry["protected_pair_hashes"].append(pair_hash)
        registry_path.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
        print(f"Added {pair_hash}")
    else:
        print(f"Already present: {pair_hash}")


if __name__ == "__main__":
    main()
