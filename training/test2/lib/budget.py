"""Spend cap enforcement for real generator/verifier runs, safe across
process restarts of the same run_id.

Two numbers are tracked and never confused with each other:
  - RESERVED spend: a predeclared conservative worst-case
    (`max_cost_per_request_usd`) added to the running total BEFORE each
    request is allowed. This is what the pre-request safety check uses —
    it only ever grows, so a later request can never be let through
    because an earlier one turned out cheaper than estimated.
  - ACTUAL spend: the provider-reported real cost, recorded after the
    fact for provenance/reporting only. It never feeds back into the
    pre-request safety check.

State (requests, reserved spend, actual spend) is a plain dict that
callers persist and restore across invocations of the same run_id — a
restart must not reset the budget."""

from __future__ import annotations

from dataclasses import dataclass, field


class BudgetExceeded(Exception):
    pass


@dataclass
class SharedSpend:
    """Shared across multiple BudgetTrackers (e.g. generator + verifier in
    one run) so a `max_budget_usd` cap is enforced against their COMBINED
    reserved/actual spend, not independently per component."""

    reserved_usd: float = 0.0
    actual_usd: float = 0.0


@dataclass
class BudgetConfig:
    max_requests: int | None = None
    max_budget_usd: float | None = None
    max_cost_per_request_usd: float = 0.0

    def __post_init__(self) -> None:
        if self.max_requests is None and self.max_budget_usd is None:
            raise ValueError("BudgetConfig requires at least max_requests — every real run needs a hard cap.")
        if self.max_budget_usd is not None and self.max_cost_per_request_usd <= 0:
            raise ValueError(
                "max_budget_usd requires a non-zero max_cost_per_request_usd safety estimate — refusing to "
                "accept a USD cap with zero effective worst-case cost."
            )


@dataclass
class BudgetTracker:
    config: BudgetConfig
    shared_spend: SharedSpend = field(default_factory=SharedSpend)
    requests: int = 0
    reserved_spend_usd: float = 0.0
    actual_spend_usd: float = 0.0

    def charge(self) -> None:
        """Call BEFORE making a request — reserves the declared worst-case
        cost. A call that would exceed either cap never happens, and the
        reservation is never given back even if the actual cost is lower."""
        next_requests = self.requests + 1
        next_shared_reserved = self.shared_spend.reserved_usd + self.config.max_cost_per_request_usd
        if self.config.max_requests is not None and next_requests > self.config.max_requests:
            raise BudgetExceeded(f"request cap exceeded: {next_requests} > {self.config.max_requests}")
        if self.config.max_budget_usd is not None and next_shared_reserved > self.config.max_budget_usd:
            raise BudgetExceeded(f"reserved spend cap exceeded: ${next_shared_reserved:.4f} > ${self.config.max_budget_usd:.4f}")
        self.requests = next_requests
        self.reserved_spend_usd += self.config.max_cost_per_request_usd
        self.shared_spend.reserved_usd = next_shared_reserved

    def record_actual_cost(self, actual_usd: float | None) -> None:
        """Provenance only — never re-checked against the cap and never
        subtracted from the reserved total, so a cheaper-than-estimated
        actual cost can't be used to justify an extra request later."""
        if actual_usd is None:
            return
        self.actual_spend_usd += actual_usd
        self.shared_spend.actual_usd += actual_usd

    def as_dict(self) -> dict:
        return {
            "max_requests": self.config.max_requests,
            "max_budget_usd": self.config.max_budget_usd,
            "max_cost_per_request_usd": self.config.max_cost_per_request_usd,
            "requests": self.requests,
            "reserved_spend_usd": round(self.reserved_spend_usd, 6),
            "actual_spend_usd": round(self.actual_spend_usd, 6),
        }

    def state_for_persistence(self) -> dict:
        """Just the mutable counters — not config, which is validated
        separately against the persisted run config on resume."""
        return {
            "requests": self.requests,
            "reserved_spend_usd": self.reserved_spend_usd,
            "actual_spend_usd": self.actual_spend_usd,
        }


def restore_tracker(config: BudgetConfig, shared_spend: SharedSpend, persisted_state: dict | None) -> BudgetTracker:
    """Builds a BudgetTracker whose counters resume from a previously
    persisted state (or fresh, if none) — a restart must not reset the
    budget."""
    tracker = BudgetTracker(config, shared_spend)
    if persisted_state:
        tracker.requests = persisted_state.get("requests", 0)
        tracker.reserved_spend_usd = persisted_state.get("reserved_spend_usd", 0.0)
        tracker.actual_spend_usd = persisted_state.get("actual_spend_usd", 0.0)
    return tracker


def shared_spend_from_persisted(generator_state: dict | None, verifier_state: dict | None) -> SharedSpend:
    reserved = (generator_state or {}).get("reserved_spend_usd", 0.0) + (verifier_state or {}).get("reserved_spend_usd", 0.0)
    actual = (generator_state or {}).get("actual_spend_usd", 0.0) + (verifier_state or {}).get("actual_spend_usd", 0.0)
    return SharedSpend(reserved_usd=reserved, actual_usd=actual)
