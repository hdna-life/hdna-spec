#!/usr/bin/env python3
"""
Phase 5A Trial 4 (v3 / Test 1 redesign): Convert human-reviewed candidates
into train/valid/test JSONL format.

This script reads a Trial 4 training-dataset export JSON file (produced by
the Dashboard's "Data / Exports" page, buildTrainingDatasetExport — see
extension/src/persona/trial4-review-state.ts) and converts each candidate
into a training example in the format expected by mlx_lm.lora:

  {"prompt": "<narrow judge prompt>", "completion": "<JSON string>"}

**Ground-truth discipline (fixes a real bug in the pre-v3 version of this
script):** a candidate is included ONLY when `includeInTraining == true`
AND `humanVerdict is not None` — the human's reviewed judgment
(`humanVerdict`/`humanDimensions`), never the model's own proposal
(`proposedVerdict`/`proposedDimensions`/`proposedDescription`), is the
training target. The prior version of this script filtered on a
`decision == "accepted"` field that no longer exists on the schema, and
built completions from `proposedVerdict`/`proposedDescription` — silently
training the model to imitate its own (or DeepSeek's) unreviewed
proposals, which contradicts "human verdict is authoritative ground
truth" (docs/decisions/0017's structured-decisions addendum). Do not
revert to reading `decision`/`proposedVerdict`/`proposedDescription` as
ground truth here.

The prompt is built to match `buildNarrowJudgePrompt` in
extension/src/persona/semantic-revision-judge-wire.ts character-for-
character — this is deliberate: the trained model must see exactly the
prompt it will be served at inference time by every judge transport
(local MLX, DeepSeek, OpenRouter) that shares this wire protocol.

The completion's `description` field is DERIVED deterministically from
the human's structured labels (verdict + dimensions) rather than reusing
any operator/model prose field — reviewNoteTr/operatorNoteTr/loreNoteTr/
proposedDescription must never silently become training ground truth
(see this file's Changelog note below for why option A was chosen over
treating description as optional/non-primary).

The confidence values are heuristic placeholders for this
concept-validation dataset:
- 0.9 for meaning_added/meaning_removed/meaning_transformed (higher confidence)
- 0.6 for no_meaningful_change/uncertain (lower confidence, abstention)

Output files: train.jsonl, valid.jsonl, test.jsonl (80/10/10 split).

Usage:
  python3 split_dataset.py --training-dataset /path/to/training-dataset.json --out dataset/prepared/
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "lore"))
from policy import format_dimension_direction_pairs, is_valid_dimensions_list, load_policy  # noqa: E402

# Turkish labels for deterministic description generation — must match
# extension/src/persona/trial4-review-state.ts's DIMENSION_LABELS_TR /
# DIRECTION_LABELS_TR (kept in sync by hand, same reasoning as above).
DIMENSION_LABELS_EN = {
    "expressed_affect_valence": "expressed affect valence",
    "expressed_affect_intensity": "expressed affect intensity",
    "directness": "directness",
    "politeness": "politeness",
    "formality": "formality",
    "certainty": "certainty",
    "evidentiality": "evidentiality",
    "commitment": "commitment",
    "directive_force": "directive force",
    "conditionality": "conditionality",
    "scope": "scope",
    "specificity": "specificity",
    "rationale": "rationale",
    "factual_content": "factual content",
    "action_or_decision": "action/decision",
}

DIRECTION_LABELS_EN = {
    "increased": "increased",
    "decreased": "decreased",
    "more_positive": "became more positive",
    "more_negative": "became more negative",
    "added": "added",
    "removed": "removed",
    "narrowed": "narrowed",
    "expanded": "expanded",
    "changed": "changed",
}

VERDICT_PHRASES_EN = {
    "meaning_added": "Meaning was added",
    "meaning_removed": "Meaning was removed",
    "meaning_transformed": "Meaning was transformed",
    "no_meaningful_change": "No meaningful change",
    "uncertain": "Uncertain",
}


# Must match extension/src/persona/semantic-revision-judge-wire.ts's
# buildNarrowJudgePrompt character-for-character — the trained model must
# see exactly the prompt served at inference time.
def build_judge_prompt(
    kind: str, before_context: str, original_text: str, final_text: str, after_context: str, policy: dict[str, Any]
) -> str:
    return (
        "You are judging one localized human text revision.\n\n"
        f"Operation: {kind}\n"
        f'Context before: "{before_context}"\n'
        f'Original span: "{original_text}"\n'
        f'Final span: "{final_text}"\n'
        f'Context after: "{after_context}"\n\n'
        "There are TWO SEPARATE questions to answer.\n\n"
        "(1) SEMANTIC/PRACTICAL VERDICT — did this revision change the "
        "underlying proposition or practical meaning, in a directly "
        "observable way?\n\n"
        "Do not infer personality, motivation, psychology, identity, or stable "
        "preferences. Do not discuss anything beyond this one localized "
        "revision — no other part of the text, no aggregation, no repeated "
        "patterns.\n\n"
        "A textual change may preserve meaning. If the proposition/practical "
        'meaning is essentially preserved, verdict is "no_meaningful_change".\n\n'
        "If meaning is added, removed, or transformed, verdict is "
        '"meaning_added", "meaning_removed", or "meaning_transformed", and '
        "description is one short sentence describing only that narrow "
        "semantic change, grounded only in the original span, the final span, "
        "and the given context. Otherwise description is null.\n\n"
        'If unsure, verdict is "uncertain" and description is null.\n\n'
        "(2) OBSERVABLE BEHAVIORAL DIMENSIONS — separately from the verdict "
        "above, did the EXPRESSED wording change along any of these "
        "dimensions, regardless of whether the proposition itself changed? A "
        "change here does NOT require a semantic verdict other than "
        '"no_meaningful_change" — many genuine dimension changes happen while '
        "the underlying proposition stays exactly the same (e.g. tone, "
        "certainty, or politeness shifting while the claim itself does not).\n\n"
        f"Allowed dimension(direction) pairs — ONLY these pairings are valid: "
        f"{format_dimension_direction_pairs(policy)}.\n\n"
        "Only describe DIRECTLY OBSERVABLE changes in expressed wording/stance "
        "— never infer the human's actual internal emotion, mood, or "
        'psychological state. "expressed_affect_valence"/"expressed_affect_intensity" '
        "describe the TEXT's expressed affect, not a claim about how the "
        "person actually feels.\n\n"
        'dimensions is an array of {"dimension": ..., "direction": ...} pairs. '
        "It may be empty — an empty array is a valid, expected answer meaning "
        '"no observable behavioral shift." Never include the same dimension '
        'twice. If verdict is "uncertain", dimensions must be an empty array.\n\n'
        "This applies regardless of language; reason about the underlying "
        "meaning/behavior shift itself, not language-specific wording, "
        "suffixes, or grammar.\n\n"
        "Respond with EXACTLY one JSON object and nothing else — no "
        "explanation, no Markdown, no extra text before or after it. The JSON "
        "object must have exactly these four keys:\n"
        '{"verdict": "<one of: no_meaningful_change, meaning_added, '
        'meaning_removed, meaning_transformed, uncertain>", "dimensions": '
        '[{"dimension": "<...>", "direction": "<...>"}, ...], "description": '
        "<string or null>, \"confidence\": <number between 0 and 1>}"
    )


def load_training_candidates(file_path: str) -> list[dict[str, Any]]:
    """Load candidates from a Trial 4 training-dataset export JSON file,
    filtered to includeInTraining=True AND humanVerdict is not None —
    the only fields that constitute human-reviewed ground truth (see this
    file's module docstring)."""
    candidates = []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, list):
                candidates = data
            elif isinstance(data, dict):
                candidates = [data]
            else:
                print(f"Error: expected JSON array or object, got {type(data)}", file=sys.stderr)
                sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: invalid JSON in {file_path}: {e}", file=sys.stderr)
        sys.exit(1)
    except FileNotFoundError:
        print(f"Error: file not found: {file_path}", file=sys.stderr)
        sys.exit(1)

    ground_truth = [
        c for c in candidates if c.get("includeInTraining") is True and c.get("humanVerdict") is not None
    ]
    print(
        f"Loaded {len(ground_truth)} human-reviewed, included candidates from {file_path} "
        f"(total in file: {len(candidates)})."
    )

    if not ground_truth:
        print("Warning: no included, human-reviewed candidates found. Output files will be empty.", file=sys.stderr)

    return ground_truth


def describe_dimensions(dimensions: list[dict[str, str]]) -> str:
    """Deterministic short English phrase for a dimensions list, e.g.
    'certainty increased, directive force increased'. Empty list -> ''."""
    parts = []
    for change in dimensions:
        dim_label = DIMENSION_LABELS_EN.get(change["dimension"], change["dimension"])
        dir_label = DIRECTION_LABELS_EN.get(change["direction"], change["direction"])
        parts.append(f"{dim_label} {dir_label}")
    return ", ".join(parts)


def build_description(verdict: str, dimensions: list[dict[str, str]]) -> str | None:
    """Derives a deterministic short description from the human's structured
    labels only (verdict + dimensions) — never from proposedDescription or
    any operator/model prose field (see module docstring's ground-truth
    discipline note). Option A from the pre-implementation summary: a
    deterministic short description derived from structured human labels,
    chosen over treating description as optional/non-primary because the
    training format's completion schema still expects a `description` key
    matching the judge's own output contract (see build_judge_prompt), so
    leaving it structurally absent would itself be a format mismatch.

    Returns None for no_meaningful_change/uncertain, matching the verdict
    axis's existing null-iff-abstention rule (task-contract.v3.md §1).
    """
    if verdict in ("no_meaningful_change", "uncertain"):
        return None

    dims_text = describe_dimensions(dimensions)
    base = VERDICT_PHRASES_EN.get(verdict, verdict)
    if dims_text:
        return f"{base} ({dims_text})."
    return f"{base}."


def candidate_to_example(candidate: dict[str, Any], policy: dict[str, Any]) -> dict[str, str]:
    """Convert one human-reviewed candidate to training example:
    {"prompt": "...", "completion": "..."}.

    Reads only kind/beforeContext/originalText/finalText/afterContext/
    humanVerdict/humanDimensions — never proposedVerdict/proposedDimensions/
    proposedDescription or any operator-note field, so none of them can
    enter the training dataset. Raises if humanDimensions contains a pair
    the policy spec does not allow.
    """
    prompt = build_judge_prompt(
        kind=candidate["kind"],
        before_context=candidate["beforeContext"],
        original_text=candidate["originalText"],
        final_text=candidate["finalText"],
        after_context=candidate["afterContext"],
        policy=policy,
    )

    verdict = candidate["humanVerdict"]
    dimensions = candidate.get("humanDimensions") or []
    if not is_valid_dimensions_list(dimensions, policy):
        raise ValueError(f"Candidate {candidate.get('id', '?')} has an invalid dimensions list: {dimensions}")
    description = build_description(verdict, dimensions)

    if verdict in ["meaning_added", "meaning_removed", "meaning_transformed"]:
        confidence = 0.9
    else:  # no_meaningful_change or uncertain
        confidence = 0.6

    completion_obj = {
        "verdict": verdict,
        "dimensions": dimensions,
        "description": description,
        "confidence": confidence,
    }
    completion = json.dumps(completion_obj)

    return {
        "prompt": prompt,
        "completion": completion,
    }


def write_jsonl(examples: list[dict[str, str]], file_path: Path) -> None:
    """Write examples to JSONL file (one JSON object per line)."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with open(file_path, "w", encoding="utf-8") as f:
        for example in examples:
            f.write(json.dumps(example) + "\n")
    print(f"Wrote {len(examples)} examples to {file_path}")


def main():
    parser = argparse.ArgumentParser(
        description="Convert human-reviewed Trial 4 training candidates into train/valid/test JSONL for mlx_lm.lora."
    )
    parser.add_argument(
        "--training-dataset",
        required=True,
        help="Path to the Trial 4 training-dataset export JSON file (Dashboard's Data/Exports page).",
    )
    parser.add_argument(
        "--out",
        default="dataset/prepared",
        help="Output directory for train.jsonl, valid.jsonl, test.jsonl (default: dataset/prepared).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed for shuffling before split (default: 42).",
    )
    args = parser.parse_args()

    candidates = load_training_candidates(args.training_dataset)

    if not candidates:
        print("No human-reviewed, included candidates to process. Exiting.", file=sys.stderr)
        sys.exit(1)

    policy = load_policy()
    examples = [candidate_to_example(c, policy) for c in candidates]

    random.seed(args.seed)
    random.shuffle(examples)

    n = len(examples)
    train_end = int(0.8 * n)
    valid_end = train_end + int(0.1 * n)

    train_examples = examples[:train_end]
    valid_examples = examples[train_end:valid_end]
    test_examples = examples[valid_end:]

    out_dir = Path(args.out)
    write_jsonl(train_examples, out_dir / "train.jsonl")
    write_jsonl(valid_examples, out_dir / "valid.jsonl")
    write_jsonl(test_examples, out_dir / "test.jsonl")

    print(f"\nSplit summary (seed={args.seed}):")
    print(f"  train: {len(train_examples)} / {n} ({100*len(train_examples)/n:.1f}%)")
    print(f"  valid: {len(valid_examples)} / {n} ({100*len(valid_examples)/n:.1f}%)")
    print(f"  test:  {len(test_examples)} / {n} ({100*len(test_examples)/n:.1f}%)")


if __name__ == "__main__":
    main()
