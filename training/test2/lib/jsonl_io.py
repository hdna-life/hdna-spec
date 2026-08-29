"""Resumable JSONL I/O. Every stage reads its input JSONL, skips IDs already
present in its own output JSONL, and appends new results one line at a
time — a crash mid-run loses at most the one in-flight record, never
already-written progress."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterator


def read_jsonl(path: Path) -> Iterator[dict[str, Any]]:
    if not path.exists():
        return
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                yield json.loads(line)


def read_ids(path: Path) -> set[str]:
    return {record["id"] for record in read_jsonl(path)}


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        for record in records:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
