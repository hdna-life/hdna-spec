"""Generator/verifier provider interfaces. The verifier must never see the
generator's proposed verdict, dimensions, or explanation — callers pass it
only the raw candidate input (kind/originalText/finalText/beforeContext/
afterContext), never the generator's output."""

from __future__ import annotations

from typing import Protocol


class GeneratorProvider(Protocol):
    model_id: str

    def generate(self, coverage_item: dict) -> dict:
        """coverage_item -> {kind, originalText, finalText, beforeContext,
        afterContext, proposedVerdict, proposedDimensions, proposedExplanation}."""
        ...


class VerifierProvider(Protocol):
    model_id: str

    def verify(self, candidate_input: dict) -> dict:
        """{kind, originalText, finalText, beforeContext, afterContext} ->
        {verdict, dimensions, confidence}. Must not accept generator fields."""
        ...


class MockGeneratorProvider:
    """Deterministic offline fixture generator — returns candidates from a
    predeclared list, cycling if exhausted. For pipeline tests only."""

    model_id = "mock/generator-v1"

    def __init__(self, candidates: list[dict]):
        self._candidates = candidates
        self._i = 0

    def generate(self, coverage_item: dict) -> dict:
        candidate = self._candidates[self._i % len(self._candidates)]
        self._i += 1
        return dict(candidate)


class MockVerifierProvider:
    """Deterministic offline fixture verifier, keyed by the candidate's
    stable ID so tests can pin exact agreement/confidence/disagreement
    scenarios. For pipeline tests only."""

    model_id = "mock/verifier-v1"

    def __init__(self, verdicts_by_id: dict[str, dict]):
        self._verdicts_by_id = verdicts_by_id

    def verify(self, candidate_input: dict) -> dict:
        candidate_id = candidate_input["id"]
        if candidate_id not in self._verdicts_by_id:
            raise KeyError(f"MockVerifierProvider has no fixture for {candidate_id}")
        result = dict(self._verdicts_by_id[candidate_id])
        for forbidden in ("proposedVerdict", "proposedDimensions", "proposedExplanation"):
            if forbidden in candidate_input:
                raise ValueError(f"Verifier input leaked generator field: {forbidden}")
        return result
