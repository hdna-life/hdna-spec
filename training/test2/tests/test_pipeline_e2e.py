#!/usr/bin/env python3
"""Offline end-to-end Test 2 pipeline test. No network access."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(LIB_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "phase5a" / "lore"))

from acceptance import decide_acceptance  # noqa: E402
from contamination import is_contaminated  # noqa: E402
from dedup import exact_dedup, semantic_near_dedup  # noqa: E402
from ids import candidate_id, normalized_pair_hash  # noqa: E402
from jsonl_io import read_jsonl  # noqa: E402
from policy import is_valid_dimensions_list, load_policy  # noqa: E402
from providers import MockGeneratorProvider, MockVerifierProvider  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
import build_dataset  # noqa: E402
import dedupe as dedupe_stage  # noqa: E402
import generate  # noqa: E402
import validate  # noqa: E402
import verify  # noqa: E402


POLICY = load_policy()


def candidate(kind, before, original, final, after, verdict, dims, language="en"):
    return {
        "kind": kind, "beforeContext": before, "originalText": original, "finalText": final,
        "afterContext": after, "language": language, "proposedVerdict": verdict, "proposedDimensions": dims,
        "proposedExplanation": "test fixture",
    }


class MiniCoveragePlanMixin:
    def build_plan(self, tmp: Path) -> Path:
        plan = {
            "coverage_buckets": [{"bucket": b, "quota": 2} for b in ["basic", "boundary"]],
            "policy_spec": "training/phase5a/lore/policy-spec.v1.json",
            "verdict_bands": {v: {"min_fraction": 0.0, "max_fraction": 1.0} for v in POLICY["verdicts"]},
            "operation_minimums": {"added": 0, "removed": 0, "replaced": 0, "reordered": 0},
        }
        path = tmp / "coverage-plan.json"
        path.write_text(json.dumps(plan), encoding="utf-8")
        return path


class TestPipelineE2E(unittest.TestCase, MiniCoveragePlanMixin):
    def setUp(self):
        self._tmp_ctx = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp_ctx.name)
        self.data = self.tmp / "data"

    def tearDown(self):
        self._tmp_ctx.cleanup()

    def test_valid_agreement_is_accepted(self):
        cand = candidate("replaced", "a", "maybe I will go", "I will go", "b", "meaning_transformed", [{"dimension": "certainty", "direction": "increased"}])
        record = {
            "generator": {"proposedVerdict": cand["proposedVerdict"], "proposedDimensions": cand["proposedDimensions"]},
            "verifier": {"verdict": "meaning_transformed", "dimensions": [{"dimension": "certainty", "direction": "increased"}], "confidence": 0.95},
        }
        decision = decide_acceptance(record)
        self.assertTrue(decision["accepted"])
        self.assertTrue(decision["dimension_sets_equal"])

    def test_semantic_disagreement_is_rejected(self):
        record = {
            "generator": {"proposedVerdict": "meaning_transformed", "proposedDimensions": []},
            "verifier": {"verdict": "no_meaningful_change", "dimensions": [], "confidence": 0.95},
        }
        decision = decide_acceptance(record)
        self.assertFalse(decision["accepted"])
        self.assertEqual(decision["reason"], "verdict_disagreement")

    def test_low_verifier_confidence_is_rejected(self):
        record = {
            "generator": {"proposedVerdict": "meaning_transformed", "proposedDimensions": []},
            "verifier": {"verdict": "meaning_transformed", "dimensions": [], "confidence": 0.5},
        }
        decision = decide_acceptance(record)
        self.assertFalse(decision["accepted"])
        self.assertEqual(decision["reason"], "low_verifier_confidence")

    def test_dimension_disagreement_alone_does_not_reject(self):
        record = {
            "generator": {"proposedVerdict": "meaning_transformed", "proposedDimensions": [{"dimension": "certainty", "direction": "increased"}]},
            "verifier": {"verdict": "meaning_transformed", "dimensions": [{"dimension": "commitment", "direction": "increased"}], "confidence": 0.95},
        }
        decision = decide_acceptance(record)
        self.assertTrue(decision["accepted"])
        self.assertFalse(decision["dimension_sets_equal"])
        self.assertEqual(decision["canonical_dimensions"], [{"dimension": "commitment", "direction": "increased"}])

    def test_invalid_dimension_direction_pair_rejected_at_validate(self):
        cand = candidate("replaced", "", "x", "y", "", "no_meaningful_change", [{"dimension": "factual_content", "direction": "increased"}])
        record = {"id": "c_x", "kind": cand["kind"], "originalText": cand["originalText"], "finalText": cand["finalText"],
                  "beforeContext": cand["beforeContext"], "afterContext": cand["afterContext"], "language": "en",
                  "generator": {"proposedVerdict": cand["proposedVerdict"], "proposedDimensions": cand["proposedDimensions"]}}
        reason = validate.validate_candidate(record, POLICY)
        self.assertEqual(reason, "invalid_dimensions")

    def test_uncertain_with_nonempty_dimensions_rejected_at_validate(self):
        record = {"id": "c_y", "kind": "replaced", "originalText": "x", "finalText": "y", "beforeContext": "", "afterContext": "",
                  "language": "en", "generator": {"proposedVerdict": "uncertain", "proposedDimensions": [{"dimension": "certainty", "direction": "increased"}]}}
        reason = validate.validate_candidate(record, POLICY)
        self.assertEqual(reason, "uncertain_with_nonempty_dimensions")

    def test_exact_duplicate_is_deduped(self):
        r1 = {"id": "c_1", "originalText": "The report is due Friday.", "finalText": "The report is due Monday."}
        r2 = {"id": "c_2", "originalText": "The report is due Friday.", "finalText": "The report is due Monday."}
        kept, drops = exact_dedup([r1, r2])
        self.assertEqual(len(kept), 1)
        self.assertEqual(len(drops), 1)
        self.assertEqual(drops[0].kept_id, "c_1")
        self.assertEqual(drops[0].removed_id, "c_2")
        self.assertEqual(drops[0].similarity, 1.0)

    def test_near_duplicate_path_with_configured_embedding_provider(self):
        class FixedEmbeddingProvider:
            provider_id = "fixture"

            def embed(self, text):
                return [1.0, 0.0] if "run the tests" in text else [0.0, 1.0]

        r1 = {"id": "c_a", "originalText": "run the tests", "finalText": "run the tests now"}
        r2 = {"id": "c_b", "originalText": "run the tests", "finalText": "run the tests soon"}
        kept, drops = semantic_near_dedup([r1, r2], FixedEmbeddingProvider(), threshold=0.9)
        self.assertEqual(len(kept), 1)
        self.assertEqual(len(drops), 1)
        self.assertEqual(drops[0].method, "semantic")

    def test_near_duplicate_survives_with_no_embedding_provider_configured(self):
        r1 = {"id": "c_a", "originalText": "run the tests", "finalText": "run the tests now"}
        r2 = {"id": "c_b", "originalText": "run the tests", "finalText": "run the tests soon"}
        kept, drops = semantic_near_dedup([r1, r2], None, threshold=0.9)
        self.assertEqual(len(kept), 2)
        self.assertEqual(len(drops), 0)

    def test_contamination_guard(self):
        protected = {normalized_pair_hash("The report is due Friday.", "The report is due Monday.")}
        contaminated = {"originalText": "The report is due Friday.", "finalText": "The report is due Monday."}
        clean = {"originalText": "other text", "finalText": "different text"}
        self.assertTrue(is_contaminated(contaminated, protected))
        self.assertFalse(is_contaminated(clean, protected))

    def test_full_pipeline_offline_with_resumability_and_partial_restart(self):
        plan_path = self.build_plan(self.tmp)
        plan = json.loads(plan_path.read_text())

        candidates = [
            candidate("replaced", "a", "maybe I will go", "I will go", "b", "meaning_transformed",
                      [{"dimension": "certainty", "direction": "increased"}]),
            candidate("added", "a", "", "please review this", "b", "meaning_added", [], language="tr"),
            candidate("removed", "c", "obviously this is true", "", "d", "meaning_removed", []),
            candidate("reordered", "e", "first do X then Y", "first do Y then X", "f", "meaning_transformed",
                      [{"dimension": "scope", "direction": "narrowed"}]),
        ]
        gen_provider = MockGeneratorProvider(candidates=candidates)

        generated_path = self.data / "generated.jsonl"
        gen_failures = self.data / "failures" / "generate.jsonl"
        stats1 = generate.run(gen_provider, plan, generated_path, gen_failures)
        self.assertEqual(stats1["generated"], 4)  # 2 buckets x quota 2

        # Resumability: calling again with the same provider generates nothing new.
        stats2 = generate.run(gen_provider, plan, generated_path, gen_failures)
        self.assertEqual(stats2["generated"], 0)
        self.assertEqual(sum(1 for _ in read_jsonl(generated_path)), 4)

        validated_path = self.data / "validated.jsonl"
        validate_failures = self.data / "failures" / "validate.jsonl"
        validate.run(generated_path, validated_path, validate_failures, POLICY)
        validated_ids = [r["id"] for r in read_jsonl(validated_path)]
        self.assertEqual(len(validated_ids), 4)

        # Partial stage restart: verifier fixtures cover only half the IDs at first,
        # each agreeing with that record's own generator proposal.
        validated_by_id = {r["id"]: r for r in read_jsonl(validated_path)}
        first_half = validated_ids[:2]
        verifier_fixtures = {
            vid: {
                "verdict": validated_by_id[vid]["generator"]["proposedVerdict"],
                "dimensions": validated_by_id[vid]["generator"]["proposedDimensions"],
                "confidence": 0.95,
            }
            for vid in first_half
        }
        verify_provider = MockVerifierProvider(verdicts_by_id=verifier_fixtures)
        verified_path = self.data / "verified.jsonl"
        verify_failures = self.data / "failures" / "verify.jsonl"
        stats_verify_1 = verify.run(verify_provider, validated_path, verified_path, verify_failures, POLICY)
        self.assertEqual(stats_verify_1["provider_errors"], 2)  # missing fixtures for the other half

        # Restart with full fixture coverage: the two errored records must be retried, not skipped.
        for vid in validated_ids:
            verifier_fixtures.setdefault(
                vid,
                {
                    "verdict": validated_by_id[vid]["generator"]["proposedVerdict"],
                    "dimensions": validated_by_id[vid]["generator"]["proposedDimensions"],
                    "confidence": 0.95,
                },
            )
        verify_provider2 = MockVerifierProvider(verdicts_by_id=verifier_fixtures)
        stats_verify_2 = verify.run(verify_provider2, validated_path, verified_path, verify_failures, POLICY)
        self.assertEqual(stats_verify_2["provider_errors"], 0)
        self.assertEqual(sum(1 for _ in read_jsonl(verified_path)), 4)

        deduped_path = self.data / "deduped.jsonl"
        dedup_report = self.data / "dedup_report.jsonl"
        dedupe_stage.run(verified_path, deduped_path, dedup_report)
        self.assertEqual(sum(1 for _ in read_jsonl(deduped_path)), 4)

        registry_path = self.tmp / "protected-cases.json"
        registry_path.write_text(json.dumps({"protected_pair_hashes": []}), encoding="utf-8")
        # add coverage_bucket to each deduped record for build_dataset's selection
        deduped = list(read_jsonl(deduped_path))
        for i, r in enumerate(deduped):
            r["coverage_bucket"] = "basic" if i % 2 == 0 else "boundary"
        from jsonl_io import write_jsonl

        write_jsonl(deduped_path, deduped)

        out_dir = self.data / "frozen"
        build_failures = self.data / "failures" / "build_dataset.jsonl"
        stats_build = build_dataset.run(
            deduped_path, plan_path, registry_path, out_dir, build_failures, run_id="test-run", verifier_model_id="mock/verifier-v1",
        )
        self.assertEqual(stats_build["accepted"], 4)
        self.assertTrue((out_dir / "accepted.jsonl").exists())
        self.assertTrue((out_dir / "test-run.manifest.json").exists())


if __name__ == "__main__":
    unittest.main()
