# Phase 5A Trial 4: Human-Filtered Specialization

A concept-validation experiment testing whether a tiny local LLM (Qwen3-0.6B) can be specialized via LoRA fine-tuning on a small human-filtered dataset to judge localized semantic changes in text revisions.

## Overview

This pipeline generates synthetic training examples via OpenRouter (routed to a DeepSeek model by default, per Operator Decision 1: DeepSeek generates candidates, it never validates/decides inclusion — see `docs/decisions/0017`), imports them into the HDNA browser extension for human review, fine-tunes a local Qwen model on accepted examples, and benchmarks the trained model's verdict accuracy against a held-out test set.

**Ground truth:** `training/phase5a/lore/task-contract.v1.md` — the versioned specification all generated examples must follow.

## Pipeline Steps

### 1. Generate Candidate Examples

Generate ~500 synthetic semantic-change scenarios via OpenRouter:

```bash
export OPENROUTER_API_KEY=sk-or-...
python3 dataset/generate_candidates.py --count 500
```

**Output:** `dataset/generated/candidates.json` (one JSON object per line, appended incrementally)

**Options:**
- `--count N`: Total candidates to generate (default: 500)
- `--out FILE`: Output path (default: `dataset/generated/candidates.json`)
- `--model MODEL_ID`: OpenRouter model id (default: `deepseek/deepseek-chat` — a DeepSeek model routed through OpenRouter; verify current availability/pricing at https://openrouter.ai/models, and substitute any other OpenRouter-hosted model if desired)
- `--batch-size N`: Candidates per API call (default: 8)
- `--seed N`: Random seed for topic cycling (optional)

**Resumption:** If the script crashes, re-run the same command — it loads existing candidates and continues from where it left off, without overwriting or duplicating.

### 2. Human Review (Browser Extension)

The HDNA browser extension's **Trial 4 Training Review** panel imports the generated candidates:

1. Open the extension popup
2. Navigate to "Trial 4 Training Review"
3. Import `dataset/generated/candidates.json`
4. Review each candidate; mark accept/reject/uncertain
5. Export accepted examples as `accepted.json`

This step is built separately in the TypeScript extension; see `extension/` for implementation.

### 3. Convert to Training Format

Split accepted examples into train/valid/test sets and convert to mlx_lm format:

```bash
python3 dataset/split_dataset.py --accepted /path/to/accepted.json --out dataset/prepared/
```

**Output files:**
- `dataset/prepared/train.jsonl` (80% of accepted examples)
- `dataset/prepared/valid.jsonl` (10% of accepted examples)
- `dataset/prepared/test.jsonl` (10% of accepted examples)

**Options:**
- `--accepted FILE`: Path to accepted candidates export (required)
- `--out DIR`: Output directory (default: `dataset/prepared/`)
- `--seed N`: Seed for reproducible shuffling (default: 42)

**Format:** Each line is a JSON object with two fields:
```json
{
  "prompt": "<narrow semantic-change judge prompt>",
  "completion": "<single-line JSON string with verdict, description, confidence>"
}
```

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

Both servers will serve the narrow semantic-change judge prompt and return verdict/description/confidence.

### 6. Blind Benchmark (Browser Extension)

The extension's **Trial 4 Blind Benchmark** panel runs the held-out benchmark:

1. Configure both server URLs (8080, 8081) in the extension
2. Configure DeepSeek API credentials (for a reference model if desired)
3. Import the held-out benchmark cases (operator-supplied, separate from training data)
4. Run blind comparison; record verdict accuracy for each model
5. Analyze results

**Evaluation-integrity requirement:** The held-out benchmark must remain completely separate from the training data pipeline. See `benchmark/sample_case.README.md` for the strict requirements.

## File Structure

```
training/phase5a/
├── README.md                              (this file)
├── .gitignore                             (ignore generated data, models, cache)
├── lore/
│   └── task-contract.v1.md               (ground truth specification)
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
3. **Train/valid/test split:** `split_dataset.py` divides accepted examples (80/10/10), separately from the external benchmark.
4. **Operator supplies ground truth:** The benchmark grading is done manually by the human operator, comparing the trained model's predictions against their own judgments recorded independently.

See `benchmark/sample_case.README.md` for the full evaluation-integrity contract.

## Troubleshooting

**Generation fails:** Check `OPENROUTER_API_KEY` is set and valid, and that the configured `--model` is available on your OpenRouter account. Review error message; the script logs failures per batch and includes error details.

**Resuming after crash:** Re-run `generate_candidates.py` with the same arguments — it loads existing candidates and continues appending new ones.

**Training runs out of memory:** Reduce `--batch-size` or `--iters` via environment variables in `train_lora.sh`.

**Inference servers fail to start:** Ensure `mlx_lm` is installed and ports 8080/8081 are available.

## References

- Task contract (ground truth): `training/phase5a/lore/task-contract.v1.md`
- Phase 5A overview: `docs/decisions/0016-phase5-persona-evidence-utility-validation.md`
- Trial 3 context: same document, "Trial 3" sections
- Trial 4 design: `docs/decisions/0017-phase5a-trial4-human-filtered-specialization.md` (if exists)
- Extension implementation: `extension/src/persona/` (semantic delta extraction and UI panels)
