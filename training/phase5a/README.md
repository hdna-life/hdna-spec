# Phase 5A Trial 4: Human-Filtered Specialization

A concept-validation experiment testing whether a tiny local LLM (Qwen3-0.6B) can be specialized via LoRA fine-tuning on a small human-filtered dataset to judge localized semantic changes in text revisions.

## Overview

This pipeline generates synthetic training examples via OpenRouter (routed to a DeepSeek model by default, per Operator Decision 1: DeepSeek generates candidates, it never validates/decides inclusion — see `docs/decisions/0017`), imports them into the HDNA browser extension for human review, fine-tunes a local Qwen model on accepted examples, and benchmarks the trained model's verdict accuracy against a held-out test set.

**Ground truth:** `training/phase5a/lore/task-contract.v3.md` — the versioned specification all generated examples must follow (Test 1's two-axis redesign: a `verdict` plus orthogonal `dimensions`; supersedes `task-contract.v2.md`, preserved unchanged as history).

## Pipeline Steps

### 1. Generate Candidate Examples

Generate ~500 synthetic semantic-change scenarios via OpenRouter. **Generation model: 1 API request = 1 candidate** — earlier batched generation (N candidates per request) proved unreliable in practice (batches of 8 sometimes returned as few as 1 valid candidate, some returned 0, some requests timed out). Each request now asks for exactly one candidate, is validated independently, and retries independently on failure — one bad response can never affect any other candidate. Up to `--concurrency` (default 4) requests run at once via a small fixed thread pool; workers are fully independent (one worker's failure/retry never affects another), and output writes are serialized so concurrent workers can never corrupt or duplicate lines.

Validate with a small run first, before spending the full budget:

```bash
export OPENROUTER_API_KEY=sk-or-...
python3 dataset/generate_candidates.py --count 10
```

Confirm exactly 10 valid candidate objects were persisted to `dataset/generated/candidates.json`, then proceed to the full run:

```bash
python3 dataset/generate_candidates.py --count 500
```

**Output:** `dataset/generated/candidates.json` (one JSON object per line, appended incrementally as each candidate is validated)

**Options:**
- `--count N`: Target number of **valid persisted candidates** — existing + new, NOT a request/API-call count (default: 500). The script keeps issuing individual requests (retrying each up to 3 times on failure/invalid output before skipping it) until either `N` valid candidates exist on disk, or a bounded global failure limit is hit.
- `--out FILE`: Output path (default: `dataset/generated/candidates.json`)
- `--model MODEL_ID`: OpenRouter model id (default: `deepseek/deepseek-chat` — a DeepSeek model routed through OpenRouter; verify current availability/pricing at https://openrouter.ai/models, and substitute any other OpenRouter-hosted model if desired)
- `--concurrency N`: Number of candidate-generation requests to run concurrently (default: 4). Validate a small run at your intended concurrency first, e.g. `--count 20 --concurrency 4`, and confirm exactly 20 valid candidates are persisted before the full run.
- `--seed N`: Random seed for topic cycling (optional)

**Resumption:** If the script crashes or is interrupted, re-run the same command — it loads existing candidates from `--out` and continues from where it left off. Already-persisted candidates are never re-requested, overwritten, or duplicated.

**Turkish review assistance:** each generated candidate also carries a `reviewNoteTr` field — a short Turkish-language explanation of the change and proposed verdict, generated in the same request (no second translation call). This is review assistance only for the extension's Training Review panel; it is never read by `split_dataset.py` and never enters the training dataset — see `spec/schema/trial4-training-candidate.ts`'s `reviewNoteTr` docstring.

### 2. Human Review (Browser Extension)

The HDNA browser extension's **Dashboard → Training Review** page (open via the popup's "Open HDNA Dashboard" button) imports the generated candidates:

1. Open the Dashboard
2. Navigate to "Training Review"
3. Import `dataset/generated/candidates.json` (append or replace mode)
4. Review each candidate: pick the six-option composite verdict (1-6, keyboard shortcuts), select any observable-behavior dimensions under "NE DEĞİŞTİ?", mark "eğitime dahil" vs. an exclusion reason, and optionally flag it lore-important — this sets `humanVerdict`/`humanDimensions`/`includeInTraining` independently of DeepSeek's `proposedVerdict`/`proposedDimensions`, which are never overwritten (docs/decisions/0017's structured-decisions addendum)
5. Export the training dataset from Dashboard → Data/Exports as `training-dataset.json`

This step is built separately in the TypeScript extension; see `extension/` for implementation.

### 3. Convert to Training Format

Convert the human-reviewed, included examples into train/valid/test sets in mlx_lm format:

```bash
python3 dataset/split_dataset.py --training-dataset /path/to/training-dataset.json --out dataset/prepared/
```

Only candidates with `includeInTraining == true AND humanVerdict != null` are used — the human's reviewed judgment, never DeepSeek's `proposedVerdict`/`proposedDimensions`/`proposedDescription`, is the training target (see `split_dataset.py`'s module docstring for the ground-truth discipline this enforces).

**Output files:**
- `dataset/prepared/train.jsonl` (80% of included, human-reviewed examples)
- `dataset/prepared/valid.jsonl` (10%)
- `dataset/prepared/test.jsonl` (10%)

**Options:**
- `--training-dataset FILE`: Path to the training-dataset export JSON file (required)
- `--out DIR`: Output directory (default: `dataset/prepared/`)
- `--seed N`: Seed for reproducible shuffling (default: 42)

**Format:** Each line is a JSON object with two fields:
```json
{
  "prompt": "<narrow semantic-change judge prompt, v3 two-axis format>",
  "completion": "<single-line JSON string with verdict, dimensions, description, confidence>"
}
```
`description` is derived deterministically from the human's structured `verdict`/`dimensions` labels, never copied from any operator/model prose field.

The prompt and completion format **exactly matches** what the extension's judge model was trained on, ensuring the model learns the correct input distribution.

### 4. Train LoRA Adapter

Fine-tune Qwen3-0.6B on the training examples using mlx_lm:

```bash
./train_lora.sh
```

This is a wrapper around `mlx_lm.lora` with sensible defaults for Phase 5A:

- Model: `Qwen/Qwen3-0.6B`
- Training data: `dataset/prepared/`
- Output adapter: `adapters/v1`
- Iterations: 400
- Batch size: 4
- Learning rate: 1e-5

**Overridable environment variables:**
```bash
MODEL=Qwen/Qwen3-0.6B DATA_DIR=dataset/prepared ADAPTER_PATH=adapters/v1 ITERS=400 ./train_lora.sh
```

**Output:**
- `adapters/v1/` — trained LoRA weights
- `adapters/v1/manifest.json` — reproducibility metadata (git commit, timestamp, dataset counts)

### 5. Start Inference Servers

Run two instances of `mlx_lm.server` for blind benchmarking:

**Base model (port 8080):**
```bash
mlx_lm.server --model Qwen/Qwen3-0.6B --host 127.0.0.1 --port 8080 \
  --chat-template-args '{"enable_thinking": false}'
```

**Trained model with LoRA (port 8081):**
```bash
mlx_lm.server --model Qwen/Qwen3-0.6B --host 127.0.0.1 --port 8081 \
  --adapter-path $(pwd)/adapters/v1 \
  --chat-template-args '{"enable_thinking": false}'
```

Both servers will serve the narrow semantic-change judge prompt and return verdict/dimensions/description/confidence.

### 6. Blind Benchmark (Browser Extension)

The extension's Dashboard **Benchmark** page runs the held-out benchmark (Test 1 evaluation-stage addendum, docs/decisions/0017 — DeepSeek is a frontier reference, not a success condition; Test 1's primary metric is 5-way semantic verdict exact accuracy, trained vs. base):

1. Configure both server URLs (8080, 8081) and an **OpenRouter API key** in the extension — DeepSeek's frontier-reference role is reached via OpenRouter (`https://openrouter.ai/api/v1/chat/completions`), never DeepSeek's own direct API; the model id (e.g. `deepseek/deepseek-chat-v3.1`) is configurable
2. Import the held-out benchmark cases (operator-supplied, separate from training data). Cases do **not** need ground truth in the import file — see `benchmark/sample_case.json`
3. For each imported case, enter its semantic verdict + observable-behavior dimensions under "Ground truth" and click **LOCK GROUND TRUTH**. Locked ground truth cannot be changed afterward through the normal UI, and only locked cases become eligible to run
4. Click "Run next case" to run base/trained/DeepSeek against the next locked case
5. Blind-grade the A/B/C responses: mark each acceptable/unacceptable, then rank the acceptable ones (1 = best) — an unacceptable response is never ranked. Submitting commits the judgment
6. Only after a case is judged does "Reveal models" become available for it, under "Judged cases" — revealing never changes any recorded judgment
7. Analyze aggregate results: semantic exact accuracy (primary metric, trained vs. base), dimension exact-set accuracy / micro-F1, acceptable rate, rank-1 count/rate, and provider error counts, per role

**Evaluation-integrity requirement:** The held-out benchmark must remain completely separate from the training data pipeline. See `benchmark/sample_case.README.md` for the strict requirements.

## File Structure

```
training/phase5a/
├── README.md                              (this file)
├── .gitignore                             (ignore generated data, models, cache)
├── lore/
│   ├── task-contract.v1.md                (superseded, preserved as history)
│   ├── task-contract.v2.md                (superseded, preserved as history)
│   └── task-contract.v3.md                (ground truth specification)
├── dataset/
│   ├── generate_candidates.py            (OpenRouter API client)
│   ├── split_dataset.py                  (JSONL converter)
│   ├── sample_candidate.json             (format fixture)
│   ├── sample_candidate.README.md        (fixture documentation)
│   ├── generated/                        (output of generate_candidates.py)
│   │   └── candidates.json
│   └── prepared/                         (output of split_dataset.py)
│       ├── train.jsonl
│       ├── valid.jsonl
│       └── test.jsonl
├── benchmark/
│   ├── sample_case.json                  (format fixture)
│   └── sample_case.README.md             (evaluation-integrity requirements)
├── train_lora.sh                         (mlx_lm.lora wrapper)
├── write_manifest.py                     (reproducibility metadata)
└── adapters/                             (output of train_lora.sh)
    └── v1/
        ├── adapters.safetensors          (trained weights)
        └── manifest.json                 (metadata)
```

## Dependencies

**Python:**
- Python 3.8+
- Standard library only (urllib, json, argparse, random, subprocess, pathlib, datetime)
- No additional `pip` dependencies required

**Machine learning:**
- `mlx-lm==0.29.1` (installed separately; provides `mlx_lm.lora` CLI)
- Apple Silicon Mac (required for MLX)

## Evaluation Integrity

**Critical:** This pipeline is designed to prevent data leakage and ensure the held-out benchmark remains independent:

1. **Generation is synthetic:** `generate_candidates.py` invents plausible scenarios; it never reads or reproduces the held-out benchmark.
2. **No benchmark in training data:** The operator supplies the real benchmark separately and **never** commits it to the `benchmark/` directory in the repository.
3. **Train/valid/test split:** `split_dataset.py` divides included, human-reviewed examples (80/10/10), separately from the external benchmark.
4. **Operator supplies ground truth:** The benchmark grading is done manually by the human operator, comparing the trained model's predictions against their own judgments recorded independently.

See `benchmark/sample_case.README.md` for the full evaluation-integrity contract.

## Troubleshooting

**Generation fails:** Check `OPENROUTER_API_KEY` is set and valid, and that the configured `--model` is available on your OpenRouter account. Review error message; the script logs failures per batch and includes error details.

**Resuming after crash:** Re-run `generate_candidates.py` with the same arguments — it loads existing candidates and continues appending new ones.

**Training runs out of memory:** Reduce `--batch-size` or `--iters` via environment variables in `train_lora.sh`.

**Inference servers fail to start:** Ensure `mlx_lm` is installed and ports 8080/8081 are available.

## References

- Task contract (ground truth): `training/phase5a/lore/task-contract.v3.md`
- Phase 5A overview: `docs/decisions/0016-phase5-persona-evidence-utility-validation.md`
- Trial 3 context: same document, "Trial 3" sections
- Trial 4 design: `docs/decisions/0017-phase5a-trial4-human-filtered-specialization.md` (if exists)
- Extension implementation: `extension/src/persona/` (semantic delta extraction and UI panels)
