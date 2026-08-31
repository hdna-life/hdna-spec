#!/usr/bin/env python3
"""Adds protected-case content hashes to the registry, without ever
writing raw text to disk in this repository. Two modes:

  --original-text/--final-text   add a single pair (e.g. one of Test 2's
                                  own held-out cases)
  --pairs-file PATH               batch-add every pair in a local JSON
                                  (array of objects) or JSONL (one object
                                  per line) file — each object needs
                                  "originalText" and "finalText" keys.
                                  The file is only ever READ; its content
                                  is never copied into this repository or
                                  printed to the terminal, only hashed.

Keep the pairs file itself outside the repository (or somewhere already
gitignored) — this tool does not check that for you.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from ids import normalized_pair_hash  # noqa: E402
from protected_registry import empty_registry, load_registry_strict, RegistryError  # noqa: E402

REGISTRY_PATH = Path(__file__).resolve().parent.parent / "benchmark" / "protected-cases.v1.json"
STATUS_KEY = "test1_final_benchmark_status"


def _load_registry(registry_path: Path) -> dict:
    if not registry_path.exists():
        return empty_registry()
    try:
        return load_registry_strict(registry_path)
    except RegistryError as err:
        raise SystemExit(
            f"Refusing to modify an invalid registry ({registry_path}): {err}. Fix or restore it by hand first — "
            f"this tool never overwrites a corrupt registry."
        ) from err


def _iter_pairs_file(pairs_path: Path):
    if pairs_path.suffix == ".jsonl":
        with open(pairs_path, "r", encoding="utf-8") as f:
            for line_no, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError as err:
                    raise SystemExit(f"{pairs_path}:{line_no}: not valid JSON ({err})") from err
                yield line_no, obj
    else:
        try:
            data = json.loads(pairs_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as err:
            raise SystemExit(f"{pairs_path}: not valid JSON ({err})") from err
        if not isinstance(data, list):
            raise SystemExit(f"{pairs_path}: expected a top-level JSON array of pair objects")
        for i, obj in enumerate(data, start=1):
            yield i, obj


def _pair_hash_from_obj(pairs_path: Path, index: int, obj: dict) -> str:
    if not isinstance(obj, dict) or "originalText" not in obj or "finalText" not in obj:
        raise SystemExit(
            f"{pairs_path}: entry {index} must be an object with 'originalText' and 'finalText' keys"
        )
    return normalized_pair_hash(obj["originalText"], obj["finalText"])


def _write_registry(registry_path: Path, registry: dict) -> None:
    unique = sorted(set(registry["protected_pair_hashes"]))
    registry["protected_pair_hashes"] = unique
    registry[STATUS_KEY] = (
        f"{len(unique)} of 10 populated — hashes only, no raw text. Populated via "
        f"pipeline/add_protected_case.py. Run pipeline/check_protected_registry.py to verify readiness "
        f"before any real Test 2 smoke or full generation."
    )
    registry_path.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Add case hash(es) to the protected-cases registry.")
    parser.add_argument("--original-text")
    parser.add_argument("--final-text")
    parser.add_argument("--pairs-file", type=Path, help="Local JSON/JSONL file of {originalText, finalText} pairs.")
    parser.add_argument("--registry", default=str(REGISTRY_PATH))
    args = parser.parse_args()

    if bool(args.original_text) != bool(args.final_text):
        raise SystemExit("--original-text and --final-text must be given together")
    if not args.pairs_file and not args.original_text:
        raise SystemExit("provide either --pairs-file or --original-text/--final-text")
    if args.pairs_file and args.original_text:
        raise SystemExit("--pairs-file and --original-text/--final-text are mutually exclusive")

    registry_path = Path(args.registry)
    registry = _load_registry(registry_path)
    before = set(registry["protected_pair_hashes"])

    if args.pairs_file:
        input_hashes = set()
        total_entries = 0
        for index, obj in _iter_pairs_file(args.pairs_file):
            input_hashes.add(_pair_hash_from_obj(args.pairs_file, index, obj))
            total_entries += 1
        registry["protected_pair_hashes"] = list(before | input_hashes)
        _write_registry(registry_path, registry)
        after = set(registry["protected_pair_hashes"])
        print(f"Read {total_entries} pair(s) from {args.pairs_file} ({len(input_hashes)} unique).")
        print(f"Newly added: {len(input_hashes - before)}. Already present: {len(input_hashes & before)}.")
        print(f"Registry now has {len(after)} unique protected-case hash(es).")
    else:
        pair_hash = normalized_pair_hash(args.original_text, args.final_text)
        registry["protected_pair_hashes"] = list(before | {pair_hash})
        _write_registry(registry_path, registry)
        if pair_hash in before:
            print(f"Already present: {pair_hash}")
        else:
            print(f"Added {pair_hash}")
        print(f"Registry now has {len(set(registry['protected_pair_hashes']))} unique protected-case hash(es).")


if __name__ == "__main__":
    main()
