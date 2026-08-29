#!/usr/bin/env python3
"""Test 2 generator role — proposes candidate examples against
coverage-plan.v1.json. A candidate's proposed verdict/dimensions are NOT
ground truth; verify.py judges independently and blind.

STUB. Not implemented. No API calls are made by this file.
"""

from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Test 2 generator (stub, not implemented).")
    parser.add_argument("--coverage-plan", default="coverage-plan.v1.json")
    parser.add_argument("--out", default="data/generated.jsonl")
    parser.add_argument("--count", type=int, default=0)
    parser.parse_args()
    raise NotImplementedError("Test 2 generation has not started. See training/test2/README.md.")


if __name__ == "__main__":
    main()
