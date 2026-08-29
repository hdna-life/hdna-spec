#!/usr/bin/env python3
"""Stage 2: deterministic schema/policy validation of generated candidates.
No network calls."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(LIB_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "phase5a" / "lore"))
from jsonl_io import append_jsonl, read_ids, read_jsonl  # noqa: E402
from policy import is_valid_dimensions_list, load_policy  # noqa: E402

REQUIRED_FIELDS = {"kind", "originalText", "finalText", "beforeContext", "afterContext", "generator", "language"}
VALID_KINDS = {"added", "removed", "replaced", "reordered"}
VALID_LANGUAGES = {"tr", "en"}


def validate_candidate(record: dict, policy: dict) -> str | None:
    """Returns a rejection reason, or None if valid."""
    if not REQUIRED_FIELDS.issubset(record.keys()):
        return "missing_required_field"
    if record["kind"] not in VALID_KINDS:
        return "invalid_kind"
    if record["language"] not in VALID_LANGUAGES:
        return "invalid_language"
    generator = record["generator"]
    if generator["proposedVerdict"] not in policy["verdicts"]:
        return "invalid_verdict"
    if not is_valid_dimensions_list(generator["proposedDimensions"], policy):
        return "invalid_dimensions"
    if generator["proposedVerdict"] == "uncertain" and generator["proposedDimensions"]:
        return "uncertain_with_nonempty_dimensions"
    return None


def run(in_path: Path, out_path: Path, failures_path: Path, policy: dict) -> dict[str, int]:
    already_done = read_ids(out_path) | read_ids(failures_path)
    passed = rejected = 0
    for record in read_jsonl(in_path):
        if record["id"] in already_done:
            continue
        reason = validate_candidate(record, policy)
        if reason is None:
            append_jsonl(out_path, record)
            passed += 1
        else:
            append_jsonl(failures_path, {"id": record["id"], "reason": reason})
            rejected += 1
    return {"passed": passed, "rejected": rejected}


def main() -> None:
    base = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(description="Test 2 candidate validator.")
    parser.add_argument("--in", dest="input_path", default=str(base / "data" / "generated.jsonl"))
    parser.add_argument("--out", default=str(base / "data" / "validated.jsonl"))
    parser.add_argument("--failures", default=str(base / "data" / "failures" / "validate.jsonl"))
    args = parser.parse_args()

    policy = load_policy()
    stats = run(Path(args.input_path), Path(args.out), Path(args.failures), policy)
    print(stats)


if __name__ == "__main__":
    main()
