#!/usr/bin/env python3
"""Exact + semantic near-dedup over generator-verifier-agreed candidates.

STUB. Not implemented.
"""

from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Test 2 dedup (stub, not implemented).")
    parser.add_argument("--in", dest="input_path", default="data/verified.jsonl")
    parser.add_argument("--out", default="data/deduped.jsonl")
    parser.parse_args()
    raise NotImplementedError("Test 2 generation has not started. See training/test2/README.md.")


if __name__ == "__main__":
    main()
