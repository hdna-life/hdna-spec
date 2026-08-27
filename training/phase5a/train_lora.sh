#!/bin/bash
set -euo pipefail

# Phase 5A Trial 4: Train a LoRA adapter on Qwen3-0.6B using mlx_lm.
#
# Overridable environment variables (with defaults):
#   MODEL              Base model ID (default: Qwen/Qwen3-0.6B)
#   DATA_DIR           Training data directory (default: dataset/prepared)
#   ADAPTER_PATH       Output adapter directory (default: adapters/v1)
#   ITERS              Training iterations (default: 400)

MODEL="${MODEL:-Qwen/Qwen3-0.6B}"
DATA_DIR="${DATA_DIR:-dataset/prepared}"
ADAPTER_PATH="${ADAPTER_PATH:-adapters/v1}"
ITERS="${ITERS:-400}"

echo "Phase 5A Trial 4 LoRA Training"
echo "=============================="
echo "Model:          $MODEL"
echo "Data directory: $DATA_DIR"
echo "Adapter path:   $ADAPTER_PATH"
echo "Iterations:     $ITERS"
echo ""

# Verify data directory exists
if [ ! -d "$DATA_DIR" ]; then
    echo "Error: data directory not found: $DATA_DIR" >&2
    exit 1
fi

# Run mlx_lm.lora training
echo "Starting training..."
mlx_lm.lora \
    --model "$MODEL" \
    --train \
    --data "$DATA_DIR" \
    --fine-tune-type lora \
    --mask-prompt \
    --iters "$ITERS" \
    --adapter-path "$ADAPTER_PATH" \
    --batch-size 4 \
    --learning-rate 1e-5

echo ""
echo "Training complete."

# Write reproducibility manifest
echo "Writing reproducibility manifest..."
python3 write_manifest.py \
    --lore-version v1 \
    --dataset-dir "$DATA_DIR" \
    --adapter-path "$ADAPTER_PATH" \
    --base-model "$MODEL" \
    --out "$ADAPTER_PATH/manifest.json"

echo "Manifest written to $ADAPTER_PATH/manifest.json"
