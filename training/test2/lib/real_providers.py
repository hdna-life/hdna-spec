"""OpenRouter-backed generator/verifier. No call happens without an
explicit BudgetTracker.charge() succeeding first — see lib/budget.py.
Reuses training/phase5a/lore/policy.py and dataset/split_dataset.py's
judge prompt; does not duplicate the taxonomy."""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "phase5a" / "lore"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "phase5a" / "dataset"))
from policy import format_dimension_direction_pairs, is_valid_dimensions_list, load_policy  # noqa: E402
from split_dataset import build_judge_prompt  # noqa: E402

from budget import BudgetTracker  # noqa: E402

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
KINDS = ["added", "removed", "replaced", "reordered"]
LANGUAGES = ["tr", "en"]
LANGUAGE_NAMES = {"tr": "Turkish", "en": "English"}
DEFAULT_MAX_TOKENS = 800


def _dimensions_json_schema(policy: dict) -> dict:
    return {
        "type": "array",
        "items": {
            "anyOf": [
                {
                    "type": "object",
                    "properties": {
                        "dimension": {"type": "string", "enum": [dimension]},
                        "direction": {"type": "string", "enum": directions},
                    },
                    "required": ["dimension", "direction"],
                    "additionalProperties": False,
                }
                for dimension, directions in policy["dimensions"].items()
            ]
        },
    }


def _post_structured(
    api_key: str, model_id: str, prompt: str, schema_name: str, schema: dict, max_tokens: int
) -> tuple[dict, float | None]:
    """Returns (parsed_content, actual_cost_usd_or_None). Cost is only
    populated when OpenRouter's usage-accounting field is present in the
    response — otherwise callers fall back to the configured flat estimate."""
    request = urllib.request.Request(
        OPENROUTER_URL,
        data=json.dumps(
            {
                "model": model_id,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_tokens,
                "usage": {"include": True},
                "response_format": {"type": "json_schema", "json_schema": {"name": schema_name, "strict": True, "schema": schema}},
            }
        ).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        body = json.loads(response.read())
    content = body["choices"][0]["message"]["content"]
    actual_cost = body.get("usage", {}).get("cost")
    return json.loads(content), actual_cost


class OpenRouterGeneratorProvider:
    """Proposes one candidate for a coverage bucket, in an explicitly
    requested language. The proposal is never ground truth — verify.py
    judges it independently and blind."""

    def __init__(self, api_key: str, model_id: str, budget: BudgetTracker, max_tokens: int = DEFAULT_MAX_TOKENS):
        self.api_key = api_key
        self.model_id = model_id
        self.budget = budget
        self.max_tokens = max_tokens
        self.policy = load_policy()

    def _schema(self, language: str) -> dict:
        dims_schema = _dimensions_json_schema(self.policy)
        return {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": KINDS},
                "language": {"type": "string", "enum": [language]},
                "beforeContext": {"type": "string"},
                "originalText": {"type": "string"},
                "finalText": {"type": "string"},
                "afterContext": {"type": "string"},
                "proposedVerdict": {"type": "string", "enum": self.policy["verdicts"]},
                "proposedDimensions": dims_schema,
                "proposedExplanation": {"type": "string"},
            },
            "required": [
                "kind", "language", "beforeContext", "originalText", "finalText", "afterContext",
                "proposedVerdict", "proposedDimensions", "proposedExplanation",
            ],
            "additionalProperties": False,
        }

    def _prompt(self, coverage_item: dict, language: str) -> str:
        language_name = LANGUAGE_NAMES[language]
        return (
            "You are constructing ONE training example for a localized text-revision judge.\n\n"
            f"Target coverage bucket: {coverage_item['bucket']}\n"
            f"Bucket intent: {coverage_item.get('description', coverage_item.get('note', ''))}\n\n"
            f"Required language: {language_name} ONLY. Every text field "
            f"(beforeContext, originalText, finalText, afterContext) must be "
            f"written in {language_name}, not translated or mixed.\n\n"
            "Invent a realistic BEFORE/AFTER localized text revision (kind, "
            "beforeContext, originalText, finalText, afterContext) matching this "
            "bucket's intent. originalText is '' only when kind is 'added'; "
            "finalText is '' only when kind is 'removed'.\n\n"
            "Then judge your own invented example under the same contract a "
            "narrow revision judge uses: a semantic verdict plus zero or more "
            "behavioral dimension changes.\n\n"
            f"Allowed dimension(direction) pairs — ONLY these pairings are valid: {format_dimension_direction_pairs(self.policy)}.\n\n"
            "Never infer hidden emotion, motivation, psychology, or personality. "
            "Do not force a dimension onto an example with no genuine observable "
            "shift — dimensions may be empty.\n\n"
            "Respond with the required structured fields only."
        )

    def generate(self, coverage_item: dict) -> dict:
        language = coverage_item.get("language")
        if language not in LANGUAGES:
            raise ValueError(f"generate() requires an explicit coverage_item['language'] in {LANGUAGES}, got {language!r}")
        self.budget.charge()
        candidate, actual_cost = _post_structured(
            self.api_key, self.model_id, self._prompt(coverage_item, language),
            "test2_candidate", self._schema(language), self.max_tokens,
        )
        self.budget.reconcile_actual_cost(actual_cost)
        if candidate["language"] != language:
            raise ValueError(f"generator returned language {candidate['language']!r}, requested {language!r}")
        if candidate["proposedVerdict"] not in self.policy["verdicts"] or not is_valid_dimensions_list(
            candidate["proposedDimensions"], self.policy
        ):
            raise ValueError("generator returned a candidate outside the canonical policy")
        return candidate


class OpenRouterVerifierProvider:
    """Blind judge — receives only the candidate input fields, reuses the
    exact narrow judge prompt training/phase5a's own pipeline trains
    against."""

    def __init__(self, api_key: str, model_id: str, budget: BudgetTracker, max_tokens: int = DEFAULT_MAX_TOKENS):
        self.api_key = api_key
        self.model_id = model_id
        self.budget = budget
        self.max_tokens = max_tokens
        self.policy = load_policy()

    def _schema(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "verdict": {"type": "string", "enum": self.policy["verdicts"]},
                "dimensions": _dimensions_json_schema(self.policy),
                "description": {"type": ["string", "null"]},
                "confidence": {"type": "number"},
            },
            "required": ["verdict", "dimensions", "description", "confidence"],
            "additionalProperties": False,
        }

    def verify(self, candidate_input: dict) -> dict:
        for forbidden in ("proposedVerdict", "proposedDimensions", "proposedExplanation"):
            if forbidden in candidate_input:
                raise ValueError(f"verifier input must not carry generator field: {forbidden}")

        prompt = build_judge_prompt(
            kind=candidate_input["kind"],
            before_context=candidate_input["beforeContext"],
            original_text=candidate_input["originalText"],
            final_text=candidate_input["finalText"],
            after_context=candidate_input["afterContext"],
            policy=self.policy,
        )
        self.budget.charge()
        result, actual_cost = _post_structured(
            self.api_key, self.model_id, prompt, "semantic_revision_judgment", self._schema(), self.max_tokens
        )
        self.budget.reconcile_actual_cost(actual_cost)

        if result["verdict"] not in self.policy["verdicts"] or not is_valid_dimensions_list(
            result["dimensions"], self.policy
        ):
            raise ValueError("verifier returned output outside the canonical policy")
        return {"verdict": result["verdict"], "dimensions": result["dimensions"], "confidence": result["confidence"]}
