#!/usr/bin/env python3
"""Offline integrity check: dataset/frozen/trial4-v3-human-183.json must
match its own manifest exactly. Catches silent edits to the frozen Test 1
corpus. Run: python3 training/phase5a/tests/test_frozen_dataset_integrity.py
"""

from __future__ import annotations

import hashlib
import json
import unittest
from collections import Counter
from pathlib import Path

FROZEN_DIR = Path(__file__).resolve().parent.parent / "dataset" / "frozen"
DATASET_PATH = FROZEN_DIR / "trial4-v3-human-183.json"
MANIFEST_PATH = FROZEN_DIR / "trial4-v3-human-183.manifest.json"


class FrozenDatasetIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
        self.raw_bytes = DATASET_PATH.read_bytes()
        self.rows = json.loads(self.raw_bytes)

    def test_sha256_matches(self):
        self.assertEqual(hashlib.sha256(self.raw_bytes).hexdigest(), self.manifest["sha256"])

    def test_row_count_matches(self):
        self.assertEqual(len(self.rows), self.manifest["row_count"])
        self.assertEqual(len(self.rows), 183)

    def test_language_distribution_matches(self):
        actual = dict(Counter(r.get("language") for r in self.rows))
        self.assertEqual(actual, self.manifest["language_distribution"])

    def test_verdict_distribution_matches(self):
        actual = dict(Counter(r.get("humanVerdict") for r in self.rows))
        self.assertEqual(actual, self.manifest["verdict_distribution"])

    def test_kind_distribution_matches(self):
        actual = dict(Counter(r.get("kind") for r in self.rows))
        self.assertEqual(actual, self.manifest["kind_distribution"])


if __name__ == "__main__":
    unittest.main()
