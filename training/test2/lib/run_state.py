"""Persisted per-run_id state so a resumed invocation is safe: an
immutable run configuration (refuses to silently change generator/
verifier model, coverage plan, policy spec, token/confidence settings,
budget configuration, or the protected-registry override mode) and
cumulative budget counters (a restart must not reset the budget)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from manifest import sha256_of

RUN_CONFIG_FILENAME = "run_config.json"
BUDGET_STATE_FILENAME = "budget_state.json"


def build_run_config(
    *,
    generator_model_id: str,
    verifier_model_id: str,
    coverage_plan_path: Path,
    policy_spec_path: Path,
    max_output_tokens: int,
    verifier_confidence_threshold: float,
    generator_budget_requests: int,
    verifier_budget_requests: int,
    max_budget_usd: float | None,
    max_cost_per_request_usd: float,
    protected_registry_override_used: bool,
) -> dict[str, Any]:
    return {
        "generator_model_id": generator_model_id,
        "verifier_model_id": verifier_model_id,
        "coverage_plan_sha256": sha256_of(coverage_plan_path),
        "policy_spec_sha256": sha256_of(policy_spec_path),
        "max_output_tokens": max_output_tokens,
        "verifier_confidence_threshold": verifier_confidence_threshold,
        "generator_budget_requests": generator_budget_requests,
        "verifier_budget_requests": verifier_budget_requests,
        "max_budget_usd": max_budget_usd,
        "max_cost_per_request_usd": max_cost_per_request_usd,
        "protected_registry_override_used": protected_registry_override_used,
    }


def load_or_create_run_config(path: Path, config: dict[str, Any]) -> dict[str, Any]:
    """First invocation for a run_id: persists `config` and returns it.
    A resumed invocation: loads the persisted config and refuses (raises
    SystemExit) if the caller's `config` differs in any immutable field."""
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(config, indent=2, ensure_ascii=False), encoding="utf-8")
        return config

    persisted = json.loads(path.read_text(encoding="utf-8"))
    mismatches = {
        key: {"persisted": persisted.get(key), "requested": value}
        for key, value in config.items()
        if persisted.get(key) != value
    }
    if mismatches:
        raise SystemExit(
            "Refusing to resume this run_id — the requested configuration differs from the one this run_id "
            "was created with:\n" + json.dumps(mismatches, indent=2, ensure_ascii=False)
        )
    return persisted


def load_budget_state(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def save_budget_state(path: Path, generator_state: dict, verifier_state: dict, shared_state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"generator": generator_state, "verifier": verifier_state, "shared": shared_state}, indent=2),
        encoding="utf-8",
    )
