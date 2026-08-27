#!/usr/bin/env python3
"""
Phase 5A Trial 4: Generate candidate examples via OpenRouter.

This script synthesizes plausible AI-draft-to-human-edit scenarios following
the task contract in training/phase5a/lore/task-contract.v2.md.

Routed through OpenRouter (https://openrouter.ai), not a direct DeepSeek API
call — the same gateway Trial 0-3 already use elsewhere in this repository
(extension/src/persona/openrouter-*.ts), so there is one API-key/billing
surface for the whole Phase 5A experiment family rather than a second,
DeepSeek-specific one. The generator model defaults to a DeepSeek model
routed through OpenRouter (--model deepseek/deepseek-chat) to preserve
Operator Decision 1's "DeepSeek generates candidates, never validates them"
role — but the model id is a plain OpenRouter model string, so any other
OpenRouter-hosted model can be substituted with --model.

Usage:
  python3 generate_candidates.py --count 500
  python3 generate_candidates.py --count 500 --batch-size 8 --seed 42

Environment:
  OPENROUTER_API_KEY (required): Your OpenRouter API authentication token.

Output:
  candidates.json (by default, or --out <path>): JSON array of candidate objects,
  one per line during generation (appended incrementally so partial progress
  survives crashes).
"""

import argparse
import json
import os
import random
import sys
import uuid
from pathlib import Path
from typing import Any

try:
    import urllib.request
    import urllib.error
except ImportError:
    print("Error: urllib not available (required for standard library HTTP)", file=sys.stderr)
    sys.exit(1)


# Task contract text embedded here for the prompt.
TASK_CONTRACT = """# Phase 5A task/lore contract — v2

## 1. The task, restated exactly as Trial 3 specifies it

Given one localized textual intervention:

- kind: 'added' | 'removed' | 'replaced' | 'reordered'
- originalText: the ORIGINAL (AI draft) span, '' if kind is 'added'
- finalText: the FINAL (human-edited) span, '' if kind is 'removed'
- beforeContext: a short excerpt of unchanged text immediately before the span
- afterContext: a short excerpt of unchanged text immediately after the span

Produce exactly:

- verdict: 'no_meaningful_change' | 'meaning_added' | 'meaning_removed'
  | 'meaning_transformed' | 'uncertain'
- description: one short sentence, or null (null iff verdict is
  'no_meaningful_change' or 'uncertain')
- confidence: a number between 0 and 1

This is the entire task. Nothing else is in scope for this contract.

## 2. What "meaningful" means here

A verdict other than `no_meaningful_change`/`uncertain` requires that the
localized intervention itself introduces, removes, or transforms an observable
semantic or pragmatic property. Illustrative categories: stance, modality,
commitment, certainty, conditionality, intensity, framing, specificity,
directness, formality, interpersonal stance.

The counterfactual check: would this exact observation still be true having
only ever seen the ORIGINAL span, never the FINAL span? If yes, the correct
verdict is `no_meaningful_change` — the meaning was already present.

### 2.1. A changed factual topic is NOT required for a meaningful change (v2)

Changes to hedging, certainty, intensity, commitment, directive strength,
qualification, rationale, framing, or scope may constitute meaningful
behavioral/semantic changes even when the core factual proposition remains
unchanged. Do NOT classify such changes as `no_meaningful_change` merely
because the underlying factual topic remains the same. "Same topic" is not
"same meaning" — apply the counterfactual check above, not a topic-sameness
shortcut.

Examples:
- "This might help with the issue." -> "This will fix the issue." — same
  topic, but certainty shifted from hedged to asserted. `meaning_transformed`.
- "You should consider running the tests before merging." -> "Run the tests
  before merging." — same topic, but directive strength shifted from
  suggestion to imperative. `meaning_transformed`.

This does not mean every same-topic rewording is meaningful: a change that
alters none of hedging/certainty/intensity/commitment/directive-strength/
qualification/rationale/framing/scope, and genuinely only rephrases the same
claim with the same force, is still correctly `no_meaningful_change`.

## 3. What must NOT be produced (failure classes from Trials 0-3, plus v2's addition)

- Do not attribute pre-existing meaning to the edit.
- Do not infer a motivation, reason, or psychological explanation for a
  removal or replacement unless the FINAL text itself states that reason.
- Do not infer stable personality, motivation, psychology, demographics,
  or identity from one intervention.
- Do not use textual-diff magnitude as evidence of semantic-change magnitude.
- Do not use unchanged factual topic as evidence of no semantic change (v2,
  §2.1) — the same failure shape, one level more specific: "same topic" is
  not "same meaning."
- Do not rely on language-specific wording, suffixes, or grammar. Reason about
  the underlying meaning shift, however it happens to be expressed.
- Do not invent a comparison that contradicts the FINAL text.

## 4. Kind-specific notes

- 'replaced': judge cosmetic corrections (e.g. typo fix) as `no_meaningful_change`.
  Per §2.1, a 'replaced' pair on the same factual topic is NOT automatically
  cosmetic either — check hedging/certainty/intensity/commitment/directive-
  strength/qualification/rationale/framing/scope before defaulting to
  `no_meaningful_change`.
- 'added'/'removed': judge only the added/removed content itself in context.
- 'reordered': word order rarely changes meaning, but judge the actual case.

## 5. Abstention is correct, not a failure

`no_meaningful_change` and `uncertain` are valid, expected, and often correct.
A dataset that never abstains is miscalibrated. Include a healthy mix of all
five verdict values, including plenty of abstention cases.

## 6. In-contract examples (for grounding only)

Trial 1 identified: removing "I think"-equivalent hedging → shift toward
directness. This is `meaning_transformed`.

Trial 2 identified: replacing a generic rest recommendation with a concrete
consequence/personal observation → specificity added. This is `meaning_added`.
Also: spelling-fix-only replacements → `no_meaningful_change` with null description.

v2 identified (§2.1): "This might help with the issue." → "This will fix
the issue." — same topic, certainty shifted from hedged to asserted. This
is `meaning_transformed`, NOT `no_meaningful_change`. Also: "You should
consider running the tests before merging." → "Run the tests before
merging." — same topic, directive strength shifted from suggestion to
imperative. This is `meaning_transformed`, NOT `no_meaningful_change`.
"""

TOPIC_SEEDS = [
    "product planning email",
    "recipe instructions",
    "travel itinerary note",
    "code review comment",
    "customer support reply",
    "meeting notes summary",
    "technical documentation",
    "team retrospective feedback",
    "project proposal draft",
    "bug report with steps to reproduce",
    "job interview feedback",
    "research paper abstract",
    "marketing copy for a feature",
    "apology or clarification message",
    "design critique note",
    "financial advice or recommendation",
    "onboarding instructions",
    "user experience feedback",
    "academic writing excerpt",
    "product roadmap update",
]


def load_existing_candidates(out_path: str) -> list[dict[str, Any]]:
    """Load existing candidates from output file if it exists."""
    if os.path.exists(out_path):
        existing = []
        try:
            with open(out_path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        existing.append(json.loads(line))
            print(f"Loaded {len(existing)} existing candidates from {out_path}.")
            return existing
        except Exception as e:
            print(f"Warning: failed to load existing candidates: {e}", file=sys.stderr)
            return []
    return []


def generate_batch_prompt(topic: str, batch_size: int) -> str:
    """Build a single prompt for one batch of candidates on a topic."""
    return f"""You are generating synthetic examples for training a semantic-change judgment model.

Given the task contract below, invent {batch_size} PLAUSIBLE AI-draft-to-human-edit scenarios in the context of: {topic}

For each scenario, invent:
1. kind: one of 'added', 'removed', 'replaced', 'reordered'
2. originalText: the AI-drafted span (may be empty string if kind is 'added')
3. finalText: the human-edited span (may be empty string if kind is 'removed')
4. beforeContext: short unchanged text before the span (may be empty)
5. afterContext: short unchanged text after the span (may be empty)
6. proposedVerdict: your judgment of what verdict a human should assign. Must be one of:
   - 'no_meaningful_change' (preserve meaning or cosmetic change)
   - 'meaning_added' (edit introduces new semantic content)
   - 'meaning_removed' (edit removes semantic content)
   - 'meaning_transformed' (edit changes existing semantic meaning)
   - 'uncertain' (you cannot confidently judge)
7. proposedDescription: null if proposedVerdict is 'no_meaningful_change' or 'uncertain';
   otherwise a one-sentence description of the semantic change grounded in the
   original->final transformation.

KEY DISCIPLINE:
- Abstention (no_meaningful_change + uncertain) should represent ~40% of your examples.
- Do NOT over-generate "interesting" verdicts just to make examples seem diverse.
- Ensure proposedDescription never describes meaning already present in originalText.
- Ensure proposedDescription grounds ONLY in what the originalText->finalText
  transformation introduced, removed, or changed; never in context or pre-existing information.
- Include a meaningful share of examples where the factual topic stays the
  same but hedging/certainty/intensity/commitment/directive-strength/
  qualification/rationale/framing/scope shifts (see task contract §2.1) —
  these must be proposedVerdict='meaning_transformed' (or added/removed as
  appropriate), NEVER 'no_meaningful_change', even though the topic is
  unchanged.

TASK CONTRACT:
{TASK_CONTRACT}

Respond with EXACTLY a JSON array of {batch_size} objects, one per line.
Each object must have ALL seven fields above. Each object occupies one complete line.
No markdown, no explanation before or after the array. Just the JSON array.
Example format (one object per line):
{{"kind": "replaced", "originalText": "...", "finalText": "...", "beforeContext": "...", "afterContext": "...", "proposedVerdict": "no_meaningful_change", "proposedDescription": null}}
{{"kind": "added", "originalText": "", "finalText": "...", "beforeContext": "...", "afterContext": "...", "proposedVerdict": "meaning_added", "proposedDescription": "..."}}
"""


def call_openrouter_api(
    prompt: str, model: str, api_key: str
) -> tuple[bool, str]:
    """Call OpenRouter's chat completions endpoint and return (success, response_text)."""
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7,
    }

    try:
        req = urllib.request.Request(
            url, data=json.dumps(payload).encode("utf-8"), headers=headers
        )
        with urllib.request.urlopen(req, timeout=60) as response:
            response_data = json.loads(response.read().decode("utf-8"))
            if "choices" in response_data and len(response_data["choices"]) > 0:
                content = response_data["choices"][0]["message"]["content"]
                return True, content
            else:
                return False, "No choices in response"
    except urllib.error.HTTPError as e:
        error_detail = ""
        try:
            error_detail = e.read().decode("utf-8")
        except:
            pass
        return False, f"HTTP {e.code}: {error_detail}"
    except Exception as e:
        return False, str(e)


def parse_batch_response(response_text: str, expected_count: int) -> list[dict]:
    """Parse response as JSON array; return list of valid candidate objects."""
    candidates = []
    lines = response_text.strip().split("\n")

    for line in lines:
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("[") or line.startswith("]"):
            continue

        try:
            obj = json.loads(line)
            # Validate required fields
            if not all(
                k in obj
                for k in [
                    "kind",
                    "originalText",
                    "finalText",
                    "beforeContext",
                    "afterContext",
                    "proposedVerdict",
                    "proposedDescription",
                ]
            ):
                print(
                    f"Warning: skipping candidate missing fields: {json.dumps(obj)[:100]}",
                    file=sys.stderr,
                )
                continue

            # Validate verdict
            if obj["proposedVerdict"] not in [
                "no_meaningful_change",
                "meaning_added",
                "meaning_removed",
                "meaning_transformed",
                "uncertain",
            ]:
                print(
                    f"Warning: skipping candidate with invalid verdict: {obj['proposedVerdict']}",
                    file=sys.stderr,
                )
                continue

            # Validate description logic
            if obj["proposedVerdict"] in ["no_meaningful_change", "uncertain"]:
                if obj["proposedDescription"] is not None:
                    print(
                        f"Warning: description should be null for verdict={obj['proposedVerdict']}, skipping",
                        file=sys.stderr,
                    )
                    continue
            else:
                if not obj["proposedDescription"] or not isinstance(
                    obj["proposedDescription"], str
                ):
                    print(
                        f"Warning: description required for verdict={obj['proposedVerdict']}, skipping",
                        file=sys.stderr,
                    )
                    continue

            candidates.append(obj)
        except json.JSONDecodeError:
            # Silently skip non-JSON lines (headers, footers, etc.)
            pass

    return candidates


def output_candidate(out_path: str, candidate_dict: dict) -> None:
    """Append one candidate (with generated ID) to output file as JSON line."""
    # Add required fields that the generator doesn't produce
    output_obj = {
        "id": str(uuid.uuid4()),
        "kind": candidate_dict["kind"],
        "originalText": candidate_dict["originalText"],
        "finalText": candidate_dict["finalText"],
        "beforeContext": candidate_dict["beforeContext"],
        "afterContext": candidate_dict["afterContext"],
        "proposedVerdict": candidate_dict["proposedVerdict"],
        "proposedDescription": candidate_dict["proposedDescription"],
        "decision": "pending",
    }
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(output_obj) + "\n")
        f.flush()


def main():
    parser = argparse.ArgumentParser(
        description="Generate Phase 5A Trial 4 candidate examples via OpenRouter."
    )
    parser.add_argument(
        "--count",
        type=int,
        default=500,
        help="Total number of candidates to generate (default: 500).",
    )
    parser.add_argument(
        "--out",
        default="dataset/generated/candidates.json",
        help="Output file path (default: dataset/generated/candidates.json).",
    )
    parser.add_argument(
        "--model",
        default="deepseek/deepseek-chat",
        help=(
            "OpenRouter model ID (default: deepseek/deepseek-chat — a DeepSeek "
            "model routed through OpenRouter, per Operator Decision 1: DeepSeek "
            "generates candidates, it never validates/decides inclusion). Any "
            "OpenRouter-hosted model id may be substituted; verify availability "
            "against https://openrouter.ai/models."
        ),
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=8,
        help="Candidates per API call (default: 8).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for topic-seed shuffling (default: unseeded).",
    )
    args = parser.parse_args()

    # Check API key
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print(
            "Error: OPENROUTER_API_KEY environment variable not set.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Load existing candidates
    existing = load_existing_candidates(args.out)
    remaining = max(0, args.count - len(existing))

    if remaining == 0:
        print(f"Target count ({args.count}) already reached. No generation needed.")
        return

    print(
        f"Generating {remaining} additional candidates (existing: {len(existing)}, target: {args.count})."
    )

    # Prepare topic cycling
    if args.seed is not None:
        random.seed(args.seed)
    topics_cycle = TOPIC_SEEDS.copy()
    random.shuffle(topics_cycle)

    topic_idx = 0
    generated = 0

    while generated < remaining:
        topic = topics_cycle[topic_idx % len(topics_cycle)]
        batch_size = min(args.batch_size, remaining - generated)

        print(f"\nBatch {generated // args.batch_size + 1}: topic='{topic}', size={batch_size}...", end=" ", flush=True)

        prompt = generate_batch_prompt(topic, batch_size)
        success, response_text = call_openrouter_api(prompt, args.model, api_key)

        if not success:
            print(f"FAILED: {response_text}", file=sys.stderr)
            sys.exit(1)

        candidates = parse_batch_response(response_text, batch_size)
        print(f"got {len(candidates)} valid candidates.", flush=True)

        for candidate in candidates:
            output_candidate(args.out, candidate)
            generated += 1

        topic_idx += 1

    print(f"\nGeneration complete. Total candidates: {len(existing) + generated}")


if __name__ == "__main__":
    main()
