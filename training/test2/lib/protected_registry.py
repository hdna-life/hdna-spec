"""Strict schema/format validation for the protected-case registry file
itself — separate from `contamination.load_protected_hashes`, which stays
lenient in the hot matching path (any string in `protected_pair_hashes` is
matched as-is, including registries built directly in tests). This module
is for the operator-facing tools (`add_protected_case.py`,
`check_protected_registry.py`) that write or gate on the registry, where
catching a malformed entry — e.g. raw text accidentally added instead of
a hash — matters more than tolerating it."""

from __future__ import annotations

import json
import re
from pathlib import Path

SCHEMA_VERSION = "v1"
HASH_PATTERN = re.compile(r"^[0-9a-f]{64}$")


class RegistryError(ValueError):
    pass


def empty_registry() -> dict:
    return {"version": SCHEMA_VERSION, "protected_pair_hashes": []}


def load_registry_strict(path: Path) -> dict:
    """Loads and validates the registry file. Never echoes a malformed
    entry's value in an error message — it might be raw text that leaked
    in by mistake, and that must never end up in a log or terminal."""
    if not path.exists():
        raise RegistryError(f"registry file not found: {path}")
    try:
        registry = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as err:
        raise RegistryError(f"registry file is not valid JSON: {path} ({err})") from err

    if not isinstance(registry, dict):
        raise RegistryError(f"registry file must contain a JSON object: {path}")

    version = registry.get("version")
    if version != SCHEMA_VERSION:
        raise RegistryError(
            f"registry version must be {SCHEMA_VERSION!r}, got {version!r} — refusing to trust an "
            f"unrecognized schema"
        )

    hashes = registry.get("protected_pair_hashes")
    if not isinstance(hashes, list):
        raise RegistryError("registry field 'protected_pair_hashes' must be a list")

    for i, entry in enumerate(hashes):
        if not isinstance(entry, str) or not HASH_PATTERN.match(entry):
            raise RegistryError(
                f"registry entry at index {i} is not a valid sha256 hex hash — refusing to load "
                f"(a malformed entry may mean raw text was committed instead of a hash; check "
                f"the registry file by hand, do not print its contents)"
            )

    return registry


def registry_status(path: Path, expected_count: int = 10) -> dict:
    """Never raises — always returns a status dict so callers can report
    readiness without a try/except. Duplicates are counted once: `ready`
    is judged on unique_count, not the raw entry count."""
    try:
        registry = load_registry_strict(path)
    except RegistryError as err:
        return {
            "path": str(path),
            "ok": False,
            "ready": False,
            "error": str(err),
            "expected_count": expected_count,
        }

    hashes = registry["protected_pair_hashes"]
    unique = set(hashes)
    return {
        "path": str(path),
        "ok": True,
        "version": registry.get("version"),
        "total_entries": len(hashes),
        "unique_count": len(unique),
        "duplicate_count": len(hashes) - len(unique),
        "expected_count": expected_count,
        "ready": len(unique) >= expected_count,
    }


def require_ready(path: Path, expected_count: int = 10) -> dict:
    """Fail-closed gate for use before any real smoke/full generation."""
    status = registry_status(path, expected_count)
    if not status["ready"]:
        reason = status.get("error") or (
            f"only {status.get('unique_count', 0)} of {expected_count} required unique protected-case "
            f"hashes are populated"
        )
        raise SystemExit(
            f"Protected-case registry is not ready ({path}): {reason}. Populate it via "
            f"pipeline/add_protected_case.py, then re-run pipeline/check_protected_registry.py."
        )
    return status
