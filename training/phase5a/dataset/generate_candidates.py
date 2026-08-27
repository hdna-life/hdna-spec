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

GENERATION MODEL: 1 API request = 1 candidate (not a batch). Earlier batched
generation (asking for N candidates in one response) proved brittle in
practice — batches of 8 sometimes returned as few as 1 valid candidate, some
returned 0, and some requests timed out entirely, all while carrying the
partial-batch-loss risk of one malformed line poisoning parsing for the rest
of the response. Rather than add batch-repair/recovery logic, generation was
simplified to the smallest reliable unit: each request asks for exactly one
candidate object, is validated independently, and is retried independently
on failure — so one bad response can never affect any other candidate.

CONCURRENCY: up to --concurrency (default 4) single-candidate requests run
at once via a small, fixed-size thread pool (Python's stdlib
concurrent.futures.ThreadPoolExecutor — not a new dependency, not a larger
async orchestration framework). Each worker generates exactly one candidate;
a failed/invalid/timed-out request retries independently within its own
worker slot and never affects any other in-flight request. Output writes are
serialized behind a lock so concurrent workers can never interleave/corrupt
JSONL lines or duplicate a write.

Usage:
  python3 generate_candidates.py --count 500
  python3 generate_candidates.py --count 500 --concurrency 4 --seed 42

Environment:
  OPENROUTER_API_KEY (required): Your OpenRouter API authentication token.

Output:
  candidates.json (by default, or --out <path>): one JSON object per line,
  appended incrementally as each candidate is validated, so partial progress
  survives a crash or an interrupted run. --count is the target number of
  VALID PERSISTED candidates (existing + newly generated), not a request
  count — the script keeps issuing individual requests until that many
  valid candidates exist on disk, or a bounded global failure limit is hit.
"""

import argparse
import json
import os
import random
import sys
import threading
import uuid
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from typing import Any, Optional

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

VALID_VERDICTS = [
    "no_meaningful_change",
    "meaning_added",
    "meaning_removed",
    "meaning_transformed",
    "uncertain",
]

REQUIRED_FIELDS = [
    "kind",
    "originalText",
    "finalText",
    "beforeContext",
    "afterContext",
    "proposedVerdict",
    "proposedDescription",
    "reviewNoteTr",
]

REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES_PER_CANDIDATE = 3


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


def generate_single_candidate_prompt(topic: str) -> str:
    """Build a prompt requesting exactly ONE candidate object (not a batch/array)."""
    return f"""You are generating ONE synthetic example for training a semantic-change judgment model.

Given the task contract below, invent ONE PLAUSIBLE AI-draft-to-human-edit scenario in the context of: {topic}

Invent:
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
8. reviewNoteTr: a natural, 1-3 sentence TURKISH-language explanation of the
   original->final change and the proposed verdict, written for a Turkish-
   speaking human reviewer who does not read English comfortably. Explain
   what changed and why you chose that verdict, in Turkish, regardless of
   which verdict you chose (including for no_meaningful_change/uncertain).
   This field is REQUIRED and must always be a non-empty Turkish string —
   it is reviewer assistance only, never a substitute for the English
   fields above.

KEY DISCIPLINE:
- Ensure proposedDescription never describes meaning already present in originalText.
- Ensure proposedDescription grounds ONLY in what the originalText->finalText
  transformation introduced, removed, or changed; never in context or pre-existing information.
- Across many independent calls, vary your verdict choice — do not always pick
  the same verdict. Abstention (no_meaningful_change / uncertain) is a valid,
  expected, and CORRECT answer for roughly 40% of realistic scenarios; do not
  avoid it just to seem interesting.
- Also vary whether the scenario is a same-topic shift in hedging/certainty/
  intensity/commitment/directive-strength/qualification/rationale/framing/scope
  (see task contract §2.1) — when it is, the verdict must be
  'meaning_transformed' (or added/removed as appropriate), NEVER
  'no_meaningful_change', even though the topic is unchanged.

TASK CONTRACT:
{TASK_CONTRACT}

Respond with EXACTLY ONE JSON object and nothing else — no array, no
Markdown, no explanation before or after it. The object must have ALL
EIGHT fields above. Example shape (illustrative values only):
{{"kind": "replaced", "originalText": "...", "finalText": "...", "beforeContext": "...", "afterContext": "...", "proposedVerdict": "meaning_transformed", "proposedDescription": "...", "reviewNoteTr": "..."}}
"""


def call_openrouter_api(prompt: str, model: str, api_key: str) -> tuple[bool, str]:
    """Call OpenRouter's chat completions endpoint once and return (success, response_text_or_error)."""
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
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SECONDS) as response:
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
        except Exception:
            pass
        return False, f"HTTP {e.code}: {error_detail}"
    except Exception as e:
        # Covers socket.timeout / urllib.error.URLError(timeout) and any
        # other transport failure — all treated as a retryable failure for
        # this one candidate, not a fatal error for the whole run.
        return False, str(e)


def parse_single_response(response_text: str) -> Optional[dict]:
    """
    Parse a response expected to contain exactly ONE JSON object.

    Deliberately minimal, non-recovering parsing (no batch-repair logic):
    strip surrounding whitespace and, if present, a single wrapping Markdown
    ```json fence — the same harmless-formatting tolerance the extension's
    own untrusted-JSON parsing uses (semantic-revision-judge-wire.ts). Any
    other malformation is treated as an invalid response, not repaired.
    Returns the validated candidate dict, or None if invalid.
    """
    text = response_text.strip()
    if text.startswith("```"):
        lines = text.split("\n")
        if lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].strip() == "```":
            lines = lines[:-1]
        text = "\n".join(lines).strip()

    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return None

    if not isinstance(obj, dict):
        return None

    if not all(k in obj for k in REQUIRED_FIELDS):
        return None

    if obj["proposedVerdict"] not in VALID_VERDICTS:
        return None

    if obj["proposedVerdict"] in ("no_meaningful_change", "uncertain"):
        if obj["proposedDescription"] is not None:
            return None
    else:
        if not obj["proposedDescription"] or not isinstance(obj["proposedDescription"], str):
            return None

    if not obj["reviewNoteTr"] or not isinstance(obj["reviewNoteTr"], str):
        return None

    return obj


def generate_one_candidate_with_retries(topic: str, model: str, api_key: str) -> Optional[dict]:
    """
    Generate exactly one candidate, retrying up to MAX_RETRIES_PER_CANDIDATE
    times on failure/invalid/timeout. Returns a validated candidate dict, or
    None if every attempt failed — the caller treats None as "skip this one
    and continue," never as a reason to abort the whole run.
    """
    prompt = generate_single_candidate_prompt(topic)
    last_error = None
    for attempt in range(1, MAX_RETRIES_PER_CANDIDATE + 1):
        success, response_text = call_openrouter_api(prompt, model, api_key)
        if not success:
            last_error = response_text
            continue
        candidate = parse_single_response(response_text)
        if candidate is not None:
            return candidate
        last_error = "invalid/malformed response"
    print(
        f"  [topic='{topic}'] failed after {MAX_RETRIES_PER_CANDIDATE} attempts: {last_error}",
        file=sys.stderr,
    )
    return None


def output_candidate(out_path: str, candidate_dict: dict, write_lock: threading.Lock) -> None:
    """Append one candidate (with generated ID) to output file as a JSON line.

    Guarded by write_lock so concurrent workers can never interleave or
    corrupt output lines — each append is one atomic, lock-held write+flush.
    """
    output_obj = {
        "id": str(uuid.uuid4()),
        "kind": candidate_dict["kind"],
        "originalText": candidate_dict["originalText"],
        "finalText": candidate_dict["finalText"],
        "beforeContext": candidate_dict["beforeContext"],
        "afterContext": candidate_dict["afterContext"],
        "proposedVerdict": candidate_dict["proposedVerdict"],
        "proposedDescription": candidate_dict["proposedDescription"],
        # Review-assistance only — see spec/schema/trial4-training-candidate.ts's
        # reviewNoteTr field docstring. split_dataset.py deliberately never
        # reads this field, so it structurally cannot leak into training data.
        "reviewNoteTr": candidate_dict["reviewNoteTr"],
        "decision": "pending",
    }
    with write_lock:
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        with open(out_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(output_obj) + "\n")
            f.flush()


def run_generation(
    remaining_target: int,
    model: str,
    api_key: str,
    out_path: str,
    topics_cycle: list[str],
    concurrency: int,
) -> tuple[int, int]:
    """
    Runs a small fixed-size worker pool (concurrency workers) where each
    worker generates exactly one candidate per task. Persists each valid
    result as soon as it's produced; retries/failures are isolated per
    worker and never affect other in-flight workers. Stops once
    remaining_target valid candidates have been persisted, or a bounded
    global failure limit is hit (whichever comes first).

    Returns (persisted_count, failed_count).
    """
    write_lock = threading.Lock()
    state_lock = threading.Lock()
    state = {"persisted": 0, "failed": 0, "topic_idx": 0}
    # Bounded global failure limit — generous enough to absorb transient API
    # flakiness across a long run, but never allows an unbounded/infinite loop.
    max_failures = max(50, remaining_target * 5)

    def next_topic() -> str:
        with state_lock:
            topic = topics_cycle[state["topic_idx"] % len(topics_cycle)]
            state["topic_idx"] += 1
        return topic

    def worker_task() -> Optional[dict]:
        return generate_one_candidate_with_retries(next_topic(), model, api_key)

    stop = False
    with ThreadPoolExecutor(max_workers=concurrency) as executor:
        futures = {executor.submit(worker_task) for _ in range(concurrency)}

        while futures:
            done, futures = wait(futures, return_when=FIRST_COMPLETED)
            for future in done:
                candidate = future.result()
                should_persist = False
                with state_lock:
                    if candidate is not None:
                        # Atomic check-and-increment: a candidate is only
                        # counted/persisted if the target hasn't already
                        # been reached by another worker completing in the
                        # same batch — without this, concurrent workers
                        # finishing together could overshoot remaining_target
                        # (observed in testing: two workers both pass the
                        # "not yet at target" check before either increments).
                        if state["persisted"] < remaining_target:
                            state["persisted"] += 1
                            should_persist = True
                        # else: valid but surplus — discarded, not persisted,
                        # so the on-disk count never exceeds the target.
                    else:
                        state["failed"] += 1
                    reached_target = state["persisted"] >= remaining_target
                    exhausted = state["failed"] >= max_failures
                    stop = reached_target or exhausted

                if should_persist:
                    output_candidate(out_path, candidate, write_lock)
                    print(f"  + persisted candidate ({state['persisted']}/{remaining_target})", flush=True)

                if not stop:
                    futures.add(executor.submit(worker_task))

    return state["persisted"], state["failed"]


def main():
    parser = argparse.ArgumentParser(
        description="Generate Phase 5A Trial 4 candidate examples via OpenRouter (1 request = 1 candidate)."
    )
    parser.add_argument(
        "--count",
        type=int,
        default=500,
        help="Target number of VALID PERSISTED candidates, existing + new (default: 500).",
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
        "--concurrency",
        type=int,
        default=4,
        help="Number of candidate-generation requests to run concurrently (default: 4).",
    )
    parser.add_argument(
        "--seed",
        type=int,
        default=None,
        help="Random seed for topic-seed shuffling (default: unseeded).",
    )
    args = parser.parse_args()

    if args.concurrency < 1:
        print("Error: --concurrency must be at least 1.", file=sys.stderr)
        sys.exit(1)

    # Check API key
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print(
            "Error: OPENROUTER_API_KEY environment variable not set.",
            file=sys.stderr,
        )
        sys.exit(1)

    # Load existing candidates — resumability: already-written candidates are
    # never touched, re-requested, or duplicated.
    existing = load_existing_candidates(args.out)
    remaining = max(0, args.count - len(existing))

    if remaining == 0:
        print(f"Target count ({args.count}) already reached. No generation needed.")
        return

    print(
        f"Generating {remaining} additional candidates (existing: {len(existing)}, "
        f"target: {args.count}, concurrency: {args.concurrency})."
    )

    # Prepare topic cycling
    if args.seed is not None:
        random.seed(args.seed)
    topics_cycle = TOPIC_SEEDS.copy()
    random.shuffle(topics_cycle)

    persisted, failed = run_generation(
        remaining_target=remaining,
        model=args.model,
        api_key=api_key,
        out_path=args.out,
        topics_cycle=topics_cycle,
        concurrency=args.concurrency,
    )

    total = len(existing) + persisted
    print(f"\nGeneration complete. Persisted this run: {persisted}. Failed attempts: {failed}. Total candidates: {total}.")

    if persisted < remaining:
        print(
            f"Warning: target not reached — stopped after hitting the bounded global "
            f"failure limit ({failed} failed attempts). Re-run the same command to "
            f"continue; already-persisted candidates are untouched.",
            file=sys.stderr,
        )
        sys.exit(1)


if __name__ == "__main__":
    main()
