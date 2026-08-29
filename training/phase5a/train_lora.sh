#!/bin/bash
set -euo pipefail

# Test 1 reproduction script — trains a LoRA adapter on Qwen3-0.6B against
# the 183-example frozen Test 1 dataset using mlx_lm. Not part of Test 2.
#
# Overridable environment variables (with defaults):
#   MODEL              Base model ID (default: Qwen/Qwen3-0.6B)
#   DATA_DIR           Training data directory (default: dataset/prepared)
#   ADAPTER_PATH       Output adapter directory (default: adapters/v1)
#   ITERS              Training iterations (default: 400)
#   CONTRACT_VERSION    task-contract version this run trains against (default: v3)
#   DATASET_SOURCE_PATH frozen source dataset to checksum in the manifest (default: dataset/frozen/trial4-v3-human-183.json)

MODEL="${MODEL:-Qwen/Qwen3-0.6B}"
DATA_DIR="${DATA_DIR:-dataset/prepared}"
ADAPTER_PATH="${ADAPTER_PATH:-adapters/v1}"
ITERS="${ITERS:-400}"
BATCH_SIZE="${BATCH_SIZE:-4}"
LEARNING_RATE="${LEARNING_RATE:-1e-5}"
CONTRACT_VERSION="${CONTRACT_VERSION:-v3}"
DATASET_SOURCE_PATH="${DATASET_SOURCE_PATH:-dataset/frozen/trial4-v3-human-183.json}"

echo "Phase 5A Trial 4 LoRA Training (Test 1 reproduction)"
echo "======================================================"
echo "Model:            $MODEL"
echo "Data directory:   $DATA_DIR"
echo "Adapter path:     $ADAPTER_PATH"
echo "Iterations:       $ITERS"
echo "Contract version: $CONTRACT_VERSION"
echo ""

if [ ! -d "$DATA_DIR" ]; then
    echo "Error: data directory not found: $DATA_DIR" >&2
    exit 1
fi

echo "Starting training..."
mlx_lm.lora \
    --model "$MODEL" \
    --train \
    --data "$DATA_DIR" \
    --fine-tune-type lora \
    --mask-prompt \
    --iters "$ITERS" \
    --adapter-path "$ADAPTER_PATH" \
    --batch-size "$BATCH_SIZE" \
    --learning-rate "$LEARNING_RATE"

echo ""
echo "Training complete."

echo "Writing reproducibility manifest..."
python3 write_manifest.py \
    --contract-version "$CONTRACT_VERSION" \
    --dataset-dir "$DATA_DIR" \
    --adapter-path "$ADAPTER_PATH" \
    --base-model "$MODEL" \
    --out "$ADAPTER_PATH/manifest.json" \
    --policy-spec-path "lore/policy-spec.v1.json" \
    --dataset-source-path "$DATASET_SOURCE_PATH" \
    --iters "$ITERS" \
    --batch-size "$BATCH_SIZE" \
    --learning-rate "$LEARNING_RATE"

echo "Manifest written to $ADAPTER_PATH/manifest.json"
