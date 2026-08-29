"""Exact + semantic near-dedup. Exact dedup is always available (hash-based,
deterministic). Semantic near-dedup requires an explicitly configured
embedding provider — with none configured, it fails closed (skips, never
silently approximates lexical hashing as "semantic")."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ids import normalized_pair_hash


@dataclass
class DedupDrop:
    kept_id: str
    removed_id: str
    similarity: float
    method: str


class SemanticEmbeddingProvider(Protocol):
    provider_id: str

    def embed(self, text: str) -> list[float]: ...


def exact_dedup(records: list[dict]) -> tuple[list[dict], list[DedupDrop]]:
    kept: list[dict] = []
    drops: list[DedupDrop] = []
    seen_hash_to_id: dict[str, str] = {}
    for record in records:
        pair_hash = normalized_pair_hash(record["originalText"], record["finalText"])
        if pair_hash in seen_hash_to_id:
            drops.append(DedupDrop(kept_id=seen_hash_to_id[pair_hash], removed_id=record["id"], similarity=1.0, method="exact"))
            continue
        seen_hash_to_id[pair_hash] = record["id"]
        kept.append(record)
    return kept, drops


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = sum(x * x for x in a) ** 0.5
    norm_b = sum(y * y for y in b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


def semantic_near_dedup(
    records: list[dict],
    embedding_provider: SemanticEmbeddingProvider | None,
    threshold: float,
) -> tuple[list[dict], list[DedupDrop]]:
    """Fails closed: with no embedding_provider configured, returns every
    record unchanged rather than approximating semantic similarity with a
    non-semantic method."""
    if embedding_provider is None:
        return records, []

    kept: list[dict] = []
    drops: list[DedupDrop] = []
    kept_embeddings: list[tuple[str, list[float]]] = []
    for record in records:
        text = f"{record['originalText']} -> {record['finalText']}"
        embedding = embedding_provider.embed(text)
        duplicate_of = None
        best_score = 0.0
        for kept_id, kept_embedding in kept_embeddings:
            score = _cosine_similarity(embedding, kept_embedding)
            if score >= threshold and score > best_score:
                duplicate_of = kept_id
                best_score = score
        if duplicate_of is not None:
            drops.append(DedupDrop(kept_id=duplicate_of, removed_id=record["id"], similarity=best_score, method="semantic"))
            continue
        kept.append(record)
        kept_embeddings.append((record["id"], embedding))
    return kept, drops
