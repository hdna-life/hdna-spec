#!/usr/bin/env python3
"""
Phase 5A Trial 4: Convert accepted candidates into train/valid/test JSONL format.

This script reads an "accepted export" JSON file (containing candidates where
decision="accepted") and converts each into training examples in the format
expected by mlx_lm.lora:

  {"prompt": "<narrow judge prompt>", "completion": "<JSON string>"}

The prompt is built from kind, originalText, finalText, beforeContext, afterContext.
The completion is a JSON string containing verdict, description, confidence.

The confidence values are heuristic placeholders for this concept-validation dataset:
- 0.9 for meaning_added/meaning_removed/meaning_transformed (higher confidence)
- 0.6 for no_meaningful_change/uncertain (lower confidence, abstention)

Output files: train.jsonl, valid.jsonl, test.jsonl (80/10/10 split).

Usage:
  python3 split_dataset.py --accepted /path/to/accepted.json --out dataset/prepared/
"""

import argparse
import json
import random
import sys
from pathlib import Path
from typing import Any


# The exact narrow judge prompt format, matching the TypeScript extension character-for-character.
def build_judge_prompt(
    kind: str, before_context: str, original_text: str, final_text: str, after_context: str
) -> str:
    """Build the prompt string for the narrow semantic-change judge task."""
    return f"""You are judging one localized human text revision.

Operation: {kind}
Context before: "{before_context}"
Original span: "{original_text}"
Final span: "{final_text}"
Context after: "{after_context}"

Decide whether this revision changes meaning in a directly observable way.

Do not infer personality, motivation, psychology, identity, or stable preferences. Do not discuss anything beyond this one localized revision — no other part of the text, no aggregation, no repeated patterns.

A textual change may preserve meaning. If meaning is essentially preserved, verdict is "no_meaningful_change" and description is null.

If meaning is added, removed, or transformed, verdict is "meaning_added", "meaning_removed", or "meaning_transformed", and description is one short sentence describing only that narrow semantic change, grounded only in the original span, the final span, and the given context.

If unsure, verdict is "uncertain" and description is null.

This applies regardless of language; reason about the underlying meaning shift itself, not language-specific wording, suffixes, or grammar.

Respond with EXACTLY one JSON object and nothing else — no explanation, no Markdown, no extra text before or after it. The JSON object must have exactly these three keys:
{{"verdict": "<one of: no_meaningful_change, meaning_added, meaning_removed, meaning_transformed, uncertain>", "description": <string or null>, "confidence": <number between 0 and 1>}}
"""


def load_accepted_candidates(file_path: str) -> list[dict[str, Any]]:
    """Load candidates from exported JSON, filter to decision='accepted' only."""
    candidates = []
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            # Handle both array and single-object cases
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

    # Filter to accepted only
    accepted = [c for c in candidates if c.get("decision") == "accepted"]
    print(f"Loaded {len(accepted)} accepted candidates from {file_path} (total in file: {len(candidates)}).")

    if not accepted:
        print("Warning: no accepted candidates found. Output files will be empty.", file=sys.stderr)

    return accepted


def candidate_to_example(candidate: dict[str, Any]) -> dict[str, str]:
    """Convert one candidate to training example: {"prompt": "...", "completion": "..."}."""
    # Build the prompt
    prompt = build_judge_prompt(
        kind=candidate["kind"],
        before_context=candidate["beforeContext"],
        original_text=candidate["originalText"],
        final_text=candidate["finalText"],
        after_context=candidate["afterContext"],
    )

    # Build the completion: a single-line JSON string
    # confidence is a heuristic placeholder for this concept-validation dataset
    verdict = candidate["proposedVerdict"]
    description = candidate["proposedDescription"]

    if verdict in ["meaning_added", "meaning_removed", "meaning_transformed"]:
        confidence = 0.9
    else:  # no_meaningful_change or uncertain
        confidence = 0.6

    completion_obj = {
        "verdict": verdict,
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
        description="Convert accepted candidates into train/valid/test JSONL for mlx_lm.lora."
    )
    parser.add_argument(
        "--accepted",
        required=True,
        help="Path to accepted candidates export JSON file (from browser extension).",
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

    # Load and filter
    candidates = load_accepted_candidates(args.accepted)

    if not candidates:
        print("No accepted candidates to process. Exiting.", file=sys.stderr)
        sys.exit(1)

    # Convert to training examples
    examples = [candidate_to_example(c) for c in candidates]

    # Shuffle with fixed seed
    random.seed(args.seed)
    random.shuffle(examples)

    # Split: 80% train, 10% valid, 10% test
    n = len(examples)
    train_end = int(0.8 * n)
    valid_end = train_end + int(0.1 * n)

    train_examples = examples[:train_end]
    valid_examples = examples[train_end:valid_end]
    test_examples = examples[valid_end:]

    # Write JSONL files
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
