"""OpenRouter-backed generator/verifier. Not called anywhere in this
repository's tests or CI — no network access happens unless an operator
explicitly runs a pipeline stage with --provider openrouter and a real
OPENROUTER_API_KEY."""

from __future__ import annotations

import json
import urllib.request

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"


class OpenRouterGeneratorProvider:
    def __init__(self, api_key: str, model_id: str):
        self.api_key = api_key
        self.model_id = model_id

    def generate(self, coverage_item: dict) -> dict:
        raise NotImplementedError("Real generation prompt not authored yet — no paid calls in this pass.")


class OpenRouterVerifierProvider:
    def __init__(self, api_key: str, model_id: str):
        self.api_key = api_key
        self.model_id = model_id

    def verify(self, candidate_input: dict) -> dict:
        raise NotImplementedError("Real verification prompt not authored yet — no paid calls in this pass.")

    def _post(self, payload: dict) -> dict:
        request = urllib.request.Request(
            OPENROUTER_URL,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read())
