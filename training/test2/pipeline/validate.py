#!/usr/bin/env python3
"""Deterministic schema/policy validation for generator candidates —
rejects malformed shape and any dimension/direction pair not in
training/phase5a/lore/policy-spec.v1.json. No network calls.

STUB. Not implemented.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "phase5a" / "lore"))
from policy import is_valid_dimensions_list, load_policy  # noqa: E402


def validate_candidate(candidate: dict, policy: dict) -> bool:
    required = {"kind", "originalText", "finalText", "beforeContext", "afterContext", "proposedVerdict", "proposedDimensions"}
    if not required.issubset(candidate.keys()):
        return False
    if candidate["proposedVerdict"] not in policy["verdicts"]:
        return False
    return is_valid_dimensions_list(candidate["proposedDimensions"], policy)


def main() -> None:
    parser = argparse.ArgumentParser(description="Test 2 candidate validator (stub, not implemented).")
    parser.add_argument("--in", dest="input_path", default="data/generated.jsonl")
    parser.add_argument("--out", default="data/validated.jsonl")
    parser.parse_args()
    load_policy()
    raise NotImplementedError("Test 2 generation has not started. See training/test2/README.md.")


if __name__ == "__main__":
    main()
