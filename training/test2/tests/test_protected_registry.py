#!/usr/bin/env python3
"""Offline tests for the protected-case registry readiness gate: strict
schema/hash validation, duplicate-safe counting, and the
add_protected_case.py / check_protected_registry.py CLIs. No network."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
PIPELINE_DIR = Path(__file__).resolve().parent.parent / "pipeline"
sys.path.insert(0, str(LIB_DIR))

from ids import normalized_pair_hash  # noqa: E402
from protected_registry import RegistryError, load_registry_strict, registry_status, require_ready  # noqa: E402

ADD_SCRIPT = PIPELINE_DIR / "add_protected_case.py"
CHECK_SCRIPT = PIPELINE_DIR / "check_protected_registry.py"


def _write(path: Path, obj: dict) -> None:
    path.write_text(json.dumps(obj), encoding="utf-8")


class TestNormalizedPairHashing(unittest.TestCase):
    def test_deterministic_across_calls(self):
        h1 = normalized_pair_hash("The report is due Friday.", "The report is due Monday.")
        h2 = normalized_pair_hash("The report is due Friday.", "The report is due Monday.")
        self.assertEqual(h1, h2)

    def test_whitespace_and_unicode_normalization_still_matches(self):
        h1 = normalized_pair_hash("Café opens at 9.", "Café closes at 5.")
        h2 = normalized_pair_hash("  Café opens at 9.  ", "  Café closes at 5.  ")
        self.assertEqual(h1, h2)

    def test_different_pairs_hash_differently(self):
        h1 = normalized_pair_hash("original A", "final A")
        h2 = normalized_pair_hash("original B", "final B")
        self.assertNotEqual(h1, h2)

    def test_swapped_original_and_final_hash_differently(self):
        h1 = normalized_pair_hash("A", "B")
        h2 = normalized_pair_hash("B", "A")
        self.assertNotEqual(h1, h2)


class TestRegistryValidation(unittest.TestCase):
    def setUp(self):
        self._tmp_ctx = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp_ctx.name)

    def tearDown(self):
        self._tmp_ctx.cleanup()

    def test_missing_file_is_a_registry_error(self):
        with self.assertRaises(RegistryError):
            load_registry_strict(self.tmp / "does-not-exist.json")

    def test_wrong_version_is_rejected(self):
        path = self.tmp / "reg.json"
        _write(path, {"version": "v2", "protected_pair_hashes": []})
        with self.assertRaises(RegistryError):
            load_registry_strict(path)

    def test_missing_version_is_rejected(self):
        path = self.tmp / "reg.json"
        _write(path, {"protected_pair_hashes": []})
        with self.assertRaises(RegistryError):
            load_registry_strict(path)

    def test_malformed_hash_entry_is_rejected(self):
        path = self.tmp / "reg.json"
        _write(path, {"version": "v1", "protected_pair_hashes": ["not-a-real-sha256-hash"]})
        with self.assertRaises(RegistryError):
            load_registry_strict(path)

    def test_raw_looking_text_entry_is_rejected(self):
        path = self.tmp / "reg.json"
        _write(path, {"version": "v1", "protected_pair_hashes": ["The report is due Friday."]})
        with self.assertRaises(RegistryError):
            load_registry_strict(path)

    def test_non_list_hashes_field_is_rejected(self):
        path = self.tmp / "reg.json"
        _write(path, {"version": "v1", "protected_pair_hashes": "not-a-list"})
        with self.assertRaises(RegistryError):
            load_registry_strict(path)

    def test_valid_registry_loads(self):
        h = normalized_pair_hash("x", "y")
        path = self.tmp / "reg.json"
        _write(path, {"version": "v1", "protected_pair_hashes": [h]})
        registry = load_registry_strict(path)
        self.assertEqual(registry["protected_pair_hashes"], [h])


class TestRegistryStatus(unittest.TestCase):
    def setUp(self):
        self._tmp_ctx = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp_ctx.name)

    def tearDown(self):
        self._tmp_ctx.cleanup()

    def test_duplicates_are_not_double_counted(self):
        h = normalized_pair_hash("x", "y")
        path = self.tmp / "reg.json"
        _write(path, {"version": "v1", "protected_pair_hashes": [h, h, h]})
        status = registry_status(path, expected_count=1)
        self.assertEqual(status["total_entries"], 3)
        self.assertEqual(status["unique_count"], 1)
        self.assertEqual(status["duplicate_count"], 2)
        self.assertTrue(status["ready"])

    def test_incomplete_registry_is_not_ready(self):
        hashes = [normalized_pair_hash(str(i), str(i)) for i in range(3)]
        path = self.tmp / "reg.json"
        _write(path, {"version": "v1", "protected_pair_hashes": hashes})
        status = registry_status(path, expected_count=10)
        self.assertFalse(status["ready"])
        with self.assertRaises(SystemExit):
            require_ready(path, expected_count=10)

    def test_complete_ten_case_registry_is_ready(self):
        hashes = [normalized_pair_hash(f"orig {i}", f"final {i}") for i in range(10)]
        path = self.tmp / "reg.json"
        _write(path, {"version": "v1", "protected_pair_hashes": hashes})
        status = registry_status(path, expected_count=10)
        self.assertTrue(status["ready"])
        require_ready(path, expected_count=10)  # must not raise

    def test_malformed_registry_reports_not_ready_without_raising(self):
        path = self.tmp / "reg.json"
        _write(path, {"version": "v1", "protected_pair_hashes": ["bad"]})
        status = registry_status(path, expected_count=1)
        self.assertFalse(status["ok"])
        self.assertFalse(status["ready"])
        self.assertIn("error", status)


class TestAddProtectedCaseCLI(unittest.TestCase):
    def setUp(self):
        self._tmp_ctx = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp_ctx.name)
        self.registry_path = self.tmp / "protected-cases.v1.json"

    def tearDown(self):
        self._tmp_ctx.cleanup()

    def _run(self, *args: str) -> subprocess.CompletedProcess:
        return subprocess.run(
            [sys.executable, str(ADD_SCRIPT), "--registry", str(self.registry_path), *args],
            capture_output=True, text=True, check=False,
        )

    def test_single_pair_add_and_duplicate_is_idempotent(self):
        result1 = self._run("--original-text", "hello", "--final-text", "world")
        self.assertEqual(result1.returncode, 0, result1.stderr)
        registry = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.assertEqual(len(registry["protected_pair_hashes"]), 1)

        result2 = self._run("--original-text", "hello", "--final-text", "world")
        self.assertEqual(result2.returncode, 0, result2.stderr)
        registry_again = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.assertEqual(len(registry_again["protected_pair_hashes"]), 1)  # no duplicate entry

    def test_pairs_file_json_array_populates_registry_with_hashes_only(self):
        pairs_path = self.tmp / "pairs.json"
        pairs = [{"originalText": f"orig {i}", "finalText": f"final {i}"} for i in range(10)]
        pairs_path.write_text(json.dumps(pairs), encoding="utf-8")

        result = self._run("--pairs-file", str(pairs_path))
        self.assertEqual(result.returncode, 0, result.stderr)

        registry = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.assertEqual(len(registry["protected_pair_hashes"]), 10)
        raw_text = json.dumps(registry)
        self.assertNotIn("orig 0", raw_text)
        self.assertNotIn("final 0", raw_text)

        expected_hashes = {normalized_pair_hash(p["originalText"], p["finalText"]) for p in pairs}
        self.assertEqual(set(registry["protected_pair_hashes"]), expected_hashes)

    def test_pairs_file_jsonl_with_duplicate_lines_dedupes(self):
        pairs_path = self.tmp / "pairs.jsonl"
        lines = [json.dumps({"originalText": "same orig", "finalText": "same final"})] * 3
        pairs_path.write_text("\n".join(lines) + "\n", encoding="utf-8")

        result = self._run("--pairs-file", str(pairs_path))
        self.assertEqual(result.returncode, 0, result.stderr)
        registry = json.loads(self.registry_path.read_text(encoding="utf-8"))
        self.assertEqual(len(registry["protected_pair_hashes"]), 1)

    def test_malformed_pairs_file_entry_fails_closed(self):
        pairs_path = self.tmp / "pairs.json"
        pairs_path.write_text(json.dumps([{"originalText": "only original, no final"}]), encoding="utf-8")

        result = self._run("--pairs-file", str(pairs_path))
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.registry_path.exists())

    def test_refuses_to_modify_corrupt_existing_registry(self):
        self.registry_path.write_text(
            json.dumps({"version": "v1", "protected_pair_hashes": ["not-a-hash"]}), encoding="utf-8"
        )
        result = self._run("--original-text", "a", "--final-text", "b")
        self.assertNotEqual(result.returncode, 0)


class TestCheckProtectedRegistryCLI(unittest.TestCase):
    def setUp(self):
        self._tmp_ctx = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp_ctx.name)
        self.registry_path = self.tmp / "protected-cases.v1.json"

    def tearDown(self):
        self._tmp_ctx.cleanup()

    def _run(self, expected_count: int = 10) -> subprocess.CompletedProcess:
        return subprocess.run(
            [
                sys.executable, str(CHECK_SCRIPT),
                "--registry", str(self.registry_path),
                "--expected-count", str(expected_count),
            ],
            capture_output=True, text=True, check=False,
        )

    def test_exits_nonzero_when_incomplete(self):
        hashes = [normalized_pair_hash(str(i), str(i)) for i in range(3)]
        _write(self.registry_path, {"version": "v1", "protected_pair_hashes": hashes})
        result = self._run(expected_count=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("NOT READY", result.stdout)

    def test_exits_zero_when_ten_cases_populated(self):
        hashes = [normalized_pair_hash(f"o{i}", f"f{i}") for i in range(10)]
        _write(self.registry_path, {"version": "v1", "protected_pair_hashes": hashes})
        result = self._run(expected_count=10)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn("READY", result.stdout)


class TestContaminationDetectionAgainstProtectedPair(unittest.TestCase):
    """Confirms the same normalized-hash contract used to populate the
    registry is what contamination.py matches against at generation time."""

    def test_protected_pair_is_flagged_contaminated(self):
        sys.path.insert(0, str(LIB_DIR))
        from contamination import is_contaminated  # noqa: E402

        protected = {normalized_pair_hash("The meeting moved to Friday.", "The meeting moved to Monday.")}
        contaminated_record = {"originalText": "The meeting moved to Friday.", "finalText": "The meeting moved to Monday."}
        clean_record = {"originalText": "The meeting moved to Friday.", "finalText": "The meeting moved to Tuesday."}

        self.assertTrue(is_contaminated(contaminated_record, protected))
        self.assertFalse(is_contaminated(clean_record, protected))


if __name__ == "__main__":
    unittest.main()
