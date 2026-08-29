#!/usr/bin/env python3
"""Blind verifier role. Receives ONLY kind/originalText/finalText/
beforeContext/afterContext — never the generator's proposed verdict,
dimensions, or explanation — and produces an independent judgment against
training/phase5a/lore/policy-spec.v1.json. An example is accepted only
when the verifier's judgment matches the generator's proposal exactly.

STUB. Not implemented. No API calls are made by this file.
"""

from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="Test 2 blind verifier (stub, not implemented).")
    parser.add_argument("--in", dest="input_path", default="data/validated.jsonl")
    parser.add_argument("--out", default="data/verified.jsonl")
    parser.parse_args()
    raise NotImplementedError("Test 2 generation has not started. See training/test2/README.md.")


if __name__ == "__main__":
    main()
