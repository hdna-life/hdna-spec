"""Deterministic content-derived IDs — never random UUIDs, so re-generating
the same candidate always yields the same ID and resumable stages can
skip already-processed records by ID alone."""

from __future__ import annotations

import hashlib
import unicodedata


def _normalize(text: str) -> str:
    return unicodedata.normalize("NFC", text.strip())


def candidate_id(kind: str, before_context: str, original_text: str, final_text: str, after_context: str) -> str:
    parts = [kind, before_context, original_text, final_text, after_context]
    canonical = "\x1f".join(_normalize(p) for p in parts)
    return "c_" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:24]


def normalized_pair_hash(original_text: str, final_text: str) -> str:
    """Hash of just the original/final text pair, independent of kind/context —
    used for exact-duplicate and contamination checks that must match even if
    a case was re-localized differently."""
    canonical = "\x1f".join(_normalize(t) for t in (original_text, final_text))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
