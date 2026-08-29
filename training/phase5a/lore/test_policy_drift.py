#!/usr/bin/env python3
"""Offline drift check: policy-spec.v1.json vs. task-contract.v3.md vs. the
Python training prompt. Run: python3 training/phase5a/lore/test_policy_drift.py
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "dataset"))

from policy import format_dimension_direction_pairs, is_valid_dimensions_list, load_policy  # noqa: E402
from split_dataset import build_judge_prompt  # noqa: E402

CONTRACT_PATH = Path(__file__).parent / "task-contract.v3.md"


def extract_contract_dimension_table() -> dict[str, list[str]]:
    markdown = CONTRACT_PATH.read_text(encoding="utf-8")
    section = markdown.split("### 3.2. The canonical dimension")[1].split("### 3.3.")[0]
    result: dict[str, list[str]] = {}
    for match in re.finditer(r"^\|\s*`([a-z_]+)`\s*\|\s*(.+?)\s*\|\s*$", section, re.MULTILINE):
        dimension, cell = match.groups()
        result[dimension] = [d.strip().strip("`") for d in cell.split(",") if d.strip()]
    return result


class PolicyDriftTest(unittest.TestCase):
    def test_policy_matches_contract_table(self) -> None:
        policy = load_policy()
        self.assertEqual(policy["dimensions"], extract_contract_dimension_table())

    def test_python_prompt_contains_the_same_pairs_string_as_the_policy(self) -> None:
        policy = load_policy()
        prompt = build_judge_prompt(
            kind="replaced",
            before_context="a",
            original_text="b",
            final_text="c",
            after_context="d",
            policy=policy,
        )
        self.assertIn(format_dimension_direction_pairs(policy), prompt)

    def test_policy_rejects_globally_valid_but_dimension_invalid_pairs(self) -> None:
        policy = load_policy()
        self.assertFalse(is_valid_dimensions_list([{"dimension": "factual_content", "direction": "increased"}], policy))
        self.assertFalse(is_valid_dimensions_list([{"dimension": "politeness", "direction": "changed"}], policy))

    def test_policy_accepts_every_declared_pair(self) -> None:
        policy = load_policy()
        for dimension, directions in policy["dimensions"].items():
            for direction in directions:
                self.assertTrue(is_valid_dimensions_list([{"dimension": dimension, "direction": direction}], policy))


if __name__ == "__main__":
    unittest.main()
