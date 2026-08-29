"""Spend cap enforcement for real generator/verifier runs. Every real run
must configure a request cap; exceeding it stops the run before the next
request, not after. A USD cap must never be configured with a zero
effective cost estimate — that would silently claim spend protection
while only request-count protection actually existed."""

from __future__ import annotations

from dataclasses import dataclass, field


class BudgetExceeded(Exception):
    pass


@dataclass
class SharedSpend:
    """Shared across multiple BudgetTrackers (e.g. generator + verifier in
    one smoke run) so a `max_usd` cap is enforced against their COMBINED
    spend, not independently per component."""

    total_usd: float = 0.0


@dataclass
class BudgetConfig:
    max_requests: int | None = None
    max_usd: float | None = None
    cost_per_request_usd: float = 0.0

    def __post_init__(self) -> None:
        if self.max_requests is None and self.max_usd is None:
            raise ValueError("BudgetConfig requires at least max_requests — every real run needs a hard cap.")
        if self.max_usd is not None and self.cost_per_request_usd <= 0:
            raise ValueError(
                "--budget-usd requires a non-zero cost estimate (--cost-per-request-usd or actual "
                "provider cost accounting) — refusing to accept a USD cap with zero effective cost."
            )


@dataclass
class BudgetTracker:
    config: BudgetConfig
    shared_spend: SharedSpend = field(default_factory=SharedSpend)
    requests: int = field(default=0, init=False)
    spend_usd: float = field(default=0.0, init=False)

    def charge(self) -> None:
        """Call BEFORE making a request — a call that would exceed either
        cap never happens."""
        next_requests = self.requests + 1
        next_component_spend = self.spend_usd + self.config.cost_per_request_usd
        next_shared_spend = self.shared_spend.total_usd + self.config.cost_per_request_usd
        if self.config.max_requests is not None and next_requests > self.config.max_requests:
            raise BudgetExceeded(f"request cap exceeded: {next_requests} > {self.config.max_requests}")
        if self.config.max_usd is not None and next_shared_spend > self.config.max_usd:
            raise BudgetExceeded(f"spend cap exceeded: ${next_shared_spend:.4f} > ${self.config.max_usd:.4f}")
        self.requests = next_requests
        self.spend_usd = next_component_spend
        self.shared_spend.total_usd = next_shared_spend

    def reconcile_actual_cost(self, actual_usd: float | None) -> None:
        """Replaces the flat per-request estimate with actual provider-reported
        cost for reporting purposes, once known. Never re-checked against the
        cap retroactively — the call already happened."""
        if actual_usd is None:
            return
        delta = actual_usd - self.config.cost_per_request_usd
        self.spend_usd += delta
        self.shared_spend.total_usd += delta

    def as_dict(self) -> dict:
        return {
            "max_requests": self.config.max_requests,
            "max_usd": self.config.max_usd,
            "requests": self.requests,
            "spend_usd": round(self.spend_usd, 6),
        }
