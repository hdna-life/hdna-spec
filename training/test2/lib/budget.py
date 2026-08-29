"""Spend cap enforcement for real generator/verifier runs. Every real run
must configure a cap; exceeding it stops the run before the next request,
not after — never a soft warning."""

from __future__ import annotations

from dataclasses import dataclass, field


class BudgetExceeded(Exception):
    pass


@dataclass
class BudgetConfig:
    max_requests: int | None = None
    max_usd: float | None = None
    cost_per_request_usd: float = 0.0


@dataclass
class BudgetTracker:
    config: BudgetConfig
    requests: int = field(default=0, init=False)
    spend_usd: float = field(default=0.0, init=False)

    def charge(self) -> None:
        """Call BEFORE making a request — a call that would exceed the cap
        never happens."""
        next_requests = self.requests + 1
        next_spend = self.spend_usd + self.config.cost_per_request_usd
        if self.config.max_requests is not None and next_requests > self.config.max_requests:
            raise BudgetExceeded(f"request cap exceeded: {next_requests} > {self.config.max_requests}")
        if self.config.max_usd is not None and next_spend > self.config.max_usd:
            raise BudgetExceeded(f"spend cap exceeded: ${next_spend:.4f} > ${self.config.max_usd:.4f}")
        self.requests = next_requests
        self.spend_usd = next_spend

    def as_dict(self) -> dict:
        return {
            "max_requests": self.config.max_requests,
            "max_usd": self.config.max_usd,
            "requests": self.requests,
            "spend_usd": round(self.spend_usd, 6),
        }
