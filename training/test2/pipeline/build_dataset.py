#!/usr/bin/env python3
"""Coverage balancing against coverage-plan.v1.json and freezing the
final accepted corpus + train/valid/test split for Gemma LoRA/SFT.

STUB. Not implemented.
"""

from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Test 2 dataset builder (stub, not implemented).")
    parser.add_argument("--in", dest="input_path", default="data/deduped.jsonl")
    parser.add_argument("--coverage-plan", default="coverage-plan.v1.json")
    parser.add_argument("--out", default="data/frozen")
    parser.parse_args()
    raise NotImplementedError("Test 2 generation has not started. See training/test2/README.md.")


if __name__ == "__main__":
    main()
