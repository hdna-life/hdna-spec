#!/usr/bin/env python3
"""Explicit preflight: is the protected-case registry ready for a real
Test 2 smoke or full run? Run this before any of those — it never
prints raw text (there is none in the registry) and never modifies the
registry.

Exit code 0 = ready, 1 = not ready. Ready means: valid v1 schema, every
entry is a well-formed sha256 hex hash, and the number of *unique*
hashes (duplicates are not double-counted) is at least --expected-count.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lib"))
from protected_registry import registry_status  # noqa: E402

REGISTRY_PATH = Path(__file__).resolve().parent.parent / "benchmark" / "protected-cases.v1.json"


def main() -> None:
    parser = argparse.ArgumentParser(description="Check protected-case registry readiness.")
    parser.add_argument("--registry", default=str(REGISTRY_PATH))
    parser.add_argument("--expected-count", type=int, default=10)
    args = parser.parse_args()

    status = registry_status(Path(args.registry), args.expected_count)

    if not status["ok"]:
        print(f"NOT READY — {status['path']}: {status['error']}")
        sys.exit(1)

    print(f"registry: {status['path']}")
    print(f"version: {status['version']}")
    print(f"total entries: {status['total_entries']}")
    print(f"unique hashes: {status['unique_count']}")
    print(f"duplicate entries (not double-counted): {status['duplicate_count']}")
    print(f"expected: {status['expected_count']}")

    if status["ready"]:
        print("READY")
        sys.exit(0)
    print(
        f"NOT READY — {status['unique_count']} of {status['expected_count']} required unique protected-case "
        f"hashes populated"
    )
    sys.exit(1)


if __name__ == "__main__":
    main()
