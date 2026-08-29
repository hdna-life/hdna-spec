#!/usr/bin/env python3
"""Offline end-to-end Test 2 pipeline test. No network access."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(LIB_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "phase5a" / "lore"))

from acceptance import decide_acceptance  # noqa: E402
from contamination import filter_contaminated, is_contaminated  # noqa: E402
from dedup import exact_dedup, semantic_near_dedup  # noqa: E402
from ids import candidate_id, normalized_pair_hash  # noqa: E402
from jsonl_io import read_jsonl, write_jsonl  # noqa: E402
from policy import is_valid_dimensions_list, load_policy  # noqa: E402
from providers import MockGeneratorProvider, MockVerifierProvider  # noqa: E402

from budget import BudgetConfig, BudgetTracker, SharedSpend  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
import build_dataset  # noqa: E402
import dedupe as dedupe_stage  # noqa: E402
import generate  # noqa: E402
import smoke  # noqa: E402
import validate  # noqa: E402
import verify  # noqa: E402


POLICY = load_policy()


class DistinctEmbeddingProvider:
    """One-hot per unique text — guarantees zero similarity between
    distinct texts, so this test's real records never look like near-dups."""

    provider_id = "test-distinct"

    def __init__(self):
        self._index: dict[str, int] = {}

    def embed(self, text: str) -> list[float]:
        if text not in self._index:
            self._index[text] = len(self._index)
        i = self._index[text]
        vec = [0.0] * (i + 1)
        vec[i] = 1.0
        return vec


def candidate(kind, before, original, final, after, verdict, dims, language="en"):
    return {
        "kind": kind, "beforeContext": before, "originalText": original, "finalText": final,
        "afterContext": after, "language": language, "proposedVerdict": verdict, "proposedDimensions": dims,
        "proposedExplanation": "test fixture",
    }


class MiniCoveragePlanMixin:
    def build_plan(self, tmp: Path, **overrides) -> Path:
        plan = {
            "coverage_buckets": [{"bucket": b, "quota": 2} for b in ["basic", "boundary"]],
            "policy_spec": "training/phase5a/lore/policy-spec.v1.json",
            "verdict_bands": {v: {"min_fraction": 0.0, "max_fraction": 1.0} for v in POLICY["verdicts"]},
            "operation_minimums": {"added": 0, "removed": 0, "replaced": 0, "reordered": 0},
            "target_accepted_examples": 4,
            "language_mix": {"tr": 0.5, "en": 0.5},
            "language_mix_tolerance_fraction": 0.30,
        }
        plan.update(overrides)
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
        dedup_config = self.data / "dedup_config.json"
        dedupe_stage.run(verified_path, deduped_path, dedup_report, dedup_config, mode="full", embedding_provider=DistinctEmbeddingProvider())
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
            deduped_path, plan_path, registry_path, out_dir, build_failures, run_id="test-run",
            verifier_model_id="mock/verifier-v1", dedup_config_path=dedup_config,
        )
        self.assertEqual(stats_build["accepted"], 4)
        self.assertTrue((out_dir / "accepted.jsonl").exists())
        self.assertTrue((out_dir / "test-run.manifest.json").exists())

    def test_verifier_blindness(self):
        provider = MockVerifierProvider(verdicts_by_id={"c_1": {"verdict": "meaning_added", "dimensions": [], "confidence": 0.95}})
        leaked_input = {"id": "c_1", "kind": "added", "originalText": "", "finalText": "x", "beforeContext": "", "afterContext": "", "proposedVerdict": "meaning_added"}
        with self.assertRaises(ValueError):
            provider.verify(leaked_input)

    def test_spend_cap_stops_generation_safely(self):
        class CountingGeneratorProvider:
            model_id = "test/generator"

            def __init__(self, budget):
                self.budget = budget

            def generate(self, coverage_item):
                self.budget.charge()
                return candidate("replaced", "a", "x", "y", "b", "no_meaningful_change", [])

        plan = json.loads(self.build_plan(self.tmp).read_text())
        budget = BudgetTracker(BudgetConfig(max_requests=2))
        provider = CountingGeneratorProvider(budget)
        generated_path = self.data / "generated.jsonl"
        gen_failures = self.data / "failures" / "generate.jsonl"

        stats = generate.run(provider, plan, generated_path, gen_failures)
        self.assertEqual(stats["generated"], 2)
        self.assertIn("budget_exceeded", stats["stopped_reason"])
        self.assertEqual(sum(1 for _ in read_jsonl(generated_path)), 2)

    def test_spend_cap_stops_verification_safely(self):
        class CountingVerifierProvider:
            model_id = "test/verifier"

            def __init__(self, budget):
                self.budget = budget

            def verify(self, candidate_input):
                self.budget.charge()
                return {"verdict": "no_meaningful_change", "dimensions": [], "confidence": 0.95}

        validated_path = self.tmp / "validated.jsonl"
        from jsonl_io import write_jsonl

        write_jsonl(validated_path, [
            {"id": f"c_{i}", "kind": "replaced", "originalText": "x", "finalText": "y", "beforeContext": "", "afterContext": "",
             "language": "en", "generator": {"proposedVerdict": "no_meaningful_change", "proposedDimensions": []}}
            for i in range(3)
        ])
        budget = BudgetTracker(BudgetConfig(max_requests=1))
        provider = CountingVerifierProvider(budget)
        verified_path = self.tmp / "verified.jsonl"
        verify_failures = self.tmp / "verify_failures.jsonl"

        stats = verify.run(provider, validated_path, verified_path, verify_failures, POLICY)
        self.assertEqual(stats["accepted"], 1)
        self.assertIn("budget_exceeded", stats["stopped_reason"])

    def test_smoke_mode_dedup_disabled_writes_marker(self):
        verified_path = self.tmp / "verified.jsonl"
        from jsonl_io import write_jsonl

        write_jsonl(verified_path, [{"id": "c_1", "originalText": "x", "finalText": "y"}])
        out = self.tmp / "deduped.jsonl"
        report = self.tmp / "report.jsonl"
        config = self.tmp / "dedup_config.json"
        stats = dedupe_stage.run(verified_path, out, report, config, mode="smoke", embedding_provider=None)
        self.assertEqual(stats["semantic_dedup"], "disabled")
        self.assertEqual(json.loads(config.read_text())["mode"], "smoke")

    def test_full_build_fails_closed_when_semantic_dedup_missing(self):
        plan_path = self.build_plan(self.tmp)
        deduped_path = self.tmp / "deduped.jsonl"
        from jsonl_io import write_jsonl

        write_jsonl(deduped_path, [])
        dedup_config = self.tmp / "dedup_config.json"
        dedup_config.write_text(json.dumps({"mode": "smoke", "semantic_dedup": "disabled"}), encoding="utf-8")
        registry_path = self.tmp / "protected-cases.json"
        registry_path.write_text(json.dumps({"protected_pair_hashes": []}), encoding="utf-8")

        with self.assertRaises(SystemExit):
            build_dataset.run(
                deduped_path, plan_path, registry_path, self.tmp / "frozen", self.tmp / "build_failures.jsonl",
                run_id="test-run", verifier_model_id="mock/verifier-v1", dedup_config_path=dedup_config,
            )

    def test_round_robin_coverage_no_single_bucket_dominates(self):
        plan = {
            "coverage_buckets": [{"bucket": b, "quota": 10} for b in ["a", "b", "c"]],
            "language_mix": {"tr": 0.5, "en": 0.5},
        }

        class InfiniteGeneratorProvider:
            model_id = "mock/generator-v1"

            def generate(self, coverage_item):
                return candidate("replaced", "", "x", "y", "", "no_meaningful_change", [], language=coverage_item["language"])

        generated_path = self.data / "generated.jsonl"
        gen_failures = self.data / "failures" / "generate.jsonl"
        stats = generate.run(InfiniteGeneratorProvider(), plan, generated_path, gen_failures, max_total=9)
        self.assertEqual(stats["generated"], 9)
        bucket_counts = Counter(r["coverage_bucket"] for r in read_jsonl(generated_path))
        self.assertEqual(set(bucket_counts), {"a", "b", "c"})
        self.assertLessEqual(max(bucket_counts.values()) - min(bucket_counts.values()), 1)

    def test_language_alternation_is_deterministic_and_respects_mix(self):
        plan = {
            "coverage_buckets": [{"bucket": "a", "quota": 8}],
            "language_mix": {"tr": 0.5, "en": 0.5},
        }

        class LanguageEchoProvider:
            model_id = "mock/generator-v1"

            def generate(self, coverage_item):
                return candidate("replaced", "", "x", "y", "", "no_meaningful_change", [], language=coverage_item["language"])

        generated_path = self.data / "generated.jsonl"
        gen_failures = self.data / "failures" / "generate.jsonl"
        generate.run(LanguageEchoProvider(), plan, generated_path, gen_failures, max_total=8)
        languages = [r["language"] for r in read_jsonl(generated_path)]
        self.assertEqual(languages, ["en", "tr"] * 4)  # deterministic alternation, highest-fraction-first tiebreak

    def test_budget_config_rejects_usd_cap_with_zero_cost_estimate(self):
        with self.assertRaises(ValueError):
            BudgetConfig(max_requests=5, max_usd=1.0, cost_per_request_usd=0.0)

    def test_shared_spend_enforces_one_combined_usd_cap(self):
        shared = SharedSpend()
        generator_budget = BudgetTracker(BudgetConfig(max_requests=10, max_usd=0.05, cost_per_request_usd=0.03), shared)
        verifier_budget = BudgetTracker(BudgetConfig(max_requests=10, max_usd=0.05, cost_per_request_usd=0.03), shared)
        generator_budget.charge()  # shared spend now 0.03, within 0.05
        from budget import BudgetExceeded

        with self.assertRaises(BudgetExceeded):
            verifier_budget.charge()  # would push shared spend to 0.06 > 0.05
        self.assertEqual(generator_budget.requests, 1)
        self.assertEqual(verifier_budget.requests, 0)  # the rejected charge never incremented its own tracker

    def test_run_dir_isolation_and_unsafe_run_id_rejection(self):
        root = self.tmp / "smoke_root"
        dir_a = smoke.resolve_run_dir(root, "run-a")
        dir_b = smoke.resolve_run_dir(root, "run-b")
        self.assertNotEqual(dir_a, dir_b)
        # Same run_id resolves to the same directory both times (resumable).
        self.assertEqual(smoke.resolve_run_dir(root, "run-a"), dir_a)
        with self.assertRaises(SystemExit):
            smoke.resolve_run_dir(root, "../escape")
        with self.assertRaises(SystemExit):
            smoke.resolve_run_dir(root, "")

    def test_contamination_guard_runs_before_verifier_is_ever_called(self):
        protected_hash = normalized_pair_hash("secret original", "secret final")
        protected = {protected_hash}
        records = [
            {"id": "c_clean", "kind": "replaced", "originalText": "ok original", "finalText": "ok final",
             "beforeContext": "", "afterContext": "", "language": "en",
             "generator": {"proposedVerdict": "no_meaningful_change", "proposedDimensions": []}},
            {"id": "c_protected", "kind": "replaced", "originalText": "secret original", "finalText": "secret final",
             "beforeContext": "", "afterContext": "", "language": "en",
             "generator": {"proposedVerdict": "no_meaningful_change", "proposedDimensions": []}},
        ]
        clean, contaminated = filter_contaminated(records, protected)
        self.assertEqual([r["id"] for r in contaminated], ["c_protected"])

        clean_path = self.tmp / "clean.jsonl"
        write_jsonl(clean_path, clean)
        verified_path = self.tmp / "verified.jsonl"
        verify_failures = self.tmp / "verify_failures.jsonl"
        # No fixture for c_protected: if it ever reached the verifier, this
        # provider would raise KeyError and the run would record a
        # provider_error for it instead of silently succeeding.
        provider = MockVerifierProvider(verdicts_by_id={
            "c_clean": {"verdict": "no_meaningful_change", "dimensions": [], "confidence": 0.95},
        })
        verify.run(provider, clean_path, verified_path, verify_failures, POLICY)
        seen_ids = {r["id"] for r in read_jsonl(verified_path)} | {r["id"] for r in read_jsonl(verify_failures)}
        self.assertNotIn("c_protected", seen_ids)
        self.assertIn("c_clean", seen_ids)

    def test_full_build_fails_closed_on_each_coverage_condition(self):
        base_records = []
        for i in range(4):
            base_records.append({
                "id": f"c_{i}",
                "originalText": f"orig {i}", "finalText": f"final {i}",
                "kind": "replaced", "language": "en" if i % 2 == 0 else "tr",
                "coverage_bucket": "basic" if i % 2 == 0 else "boundary",
                "canonical_verdict": "no_meaningful_change",
            })

        def build_valid_run(tmp: Path) -> tuple[Path, Path, Path]:
            plan_path = self.build_plan(tmp)
            deduped_path = tmp / "deduped.jsonl"
            write_jsonl(deduped_path, base_records)
            dedup_config = tmp / "dedup_config.json"
            dedup_config.write_text(json.dumps({"mode": "full", "semantic_dedup": "enabled"}), encoding="utf-8")
            registry_path = tmp / "protected-cases.json"
            registry_path.write_text(json.dumps({"protected_pair_hashes": []}), encoding="utf-8")
            return plan_path, deduped_path, dedup_config, registry_path

        with self.subTest("valid run succeeds"):
            tmp = self.tmp / "ok"
            tmp.mkdir()
            plan_path, deduped_path, dedup_config, registry_path = build_valid_run(tmp)
            stats = build_dataset.run(
                deduped_path, plan_path, registry_path, tmp / "frozen", tmp / "failures.jsonl",
                run_id="ok-run", verifier_model_id="mock/verifier-v1", dedup_config_path=dedup_config,
            )
            self.assertEqual(stats["accepted"], 4)

        with self.subTest("bucket quota not met"):
            tmp = self.tmp / "quota"
            tmp.mkdir()
            plan_path, deduped_path, dedup_config, registry_path = build_valid_run(tmp)
            write_jsonl(deduped_path, base_records[:3])  # boundary bucket short by one
            with self.assertRaises(SystemExit):
                build_dataset.run(
                    deduped_path, plan_path, registry_path, tmp / "frozen", tmp / "failures.jsonl",
                    run_id="quota-run", verifier_model_id="mock/verifier-v1", dedup_config_path=dedup_config,
                )

        with self.subTest("verdict band violated"):
            tmp = self.tmp / "band"
            tmp.mkdir()
            plan_path = self.build_plan(tmp, verdict_bands={"no_meaningful_change": {"min_fraction": 0.0, "max_fraction": 0.1}})
            deduped_path = tmp / "deduped.jsonl"
            write_jsonl(deduped_path, base_records)
            dedup_config = tmp / "dedup_config.json"
            dedup_config.write_text(json.dumps({"mode": "full", "semantic_dedup": "enabled"}), encoding="utf-8")
            registry_path = tmp / "protected-cases.json"
            registry_path.write_text(json.dumps({"protected_pair_hashes": []}), encoding="utf-8")
            with self.assertRaises(SystemExit):
                build_dataset.run(
                    deduped_path, plan_path, registry_path, tmp / "frozen", tmp / "failures.jsonl",
                    run_id="band-run", verifier_model_id="mock/verifier-v1", dedup_config_path=dedup_config,
                )

        with self.subTest("operation minimum violated"):
            tmp = self.tmp / "opmin"
            tmp.mkdir()
            plan_path = self.build_plan(tmp, operation_minimums={"added": 1, "removed": 0, "replaced": 0, "reordered": 0})
            deduped_path = tmp / "deduped.jsonl"
            write_jsonl(deduped_path, base_records)  # no "added" records
            dedup_config = tmp / "dedup_config.json"
            dedup_config.write_text(json.dumps({"mode": "full", "semantic_dedup": "enabled"}), encoding="utf-8")
            registry_path = tmp / "protected-cases.json"
            registry_path.write_text(json.dumps({"protected_pair_hashes": []}), encoding="utf-8")
            with self.assertRaises(SystemExit):
                build_dataset.run(
                    deduped_path, plan_path, registry_path, tmp / "frozen", tmp / "failures.jsonl",
                    run_id="opmin-run", verifier_model_id="mock/verifier-v1", dedup_config_path=dedup_config,
                )

        with self.subTest("language mix violated"):
            tmp = self.tmp / "lang"
            tmp.mkdir()
            plan_path = self.build_plan(tmp, language_mix_tolerance_fraction=0.01)
            deduped_path = tmp / "deduped.jsonl"
            write_jsonl(deduped_path, base_records)  # 50/50 tr/en, but tolerance now near-zero
            dedup_config = tmp / "dedup_config.json"
            dedup_config.write_text(json.dumps({"mode": "full", "semantic_dedup": "enabled"}), encoding="utf-8")
            registry_path = tmp / "protected-cases.json"
            registry_path.write_text(json.dumps({"protected_pair_hashes": []}), encoding="utf-8")
            # 50/50 exactly matches the plan's 50/50 target, so tighten the target instead to force a violation.
            plan = json.loads(plan_path.read_text())
            plan["language_mix"] = {"tr": 0.9, "en": 0.1}
            plan_path.write_text(json.dumps(plan), encoding="utf-8")
            with self.assertRaises(SystemExit):
                build_dataset.run(
                    deduped_path, plan_path, registry_path, tmp / "frozen", tmp / "failures.jsonl",
                    run_id="lang-run", verifier_model_id="mock/verifier-v1", dedup_config_path=dedup_config,
                )

        with self.subTest("target not reached"):
            tmp = self.tmp / "target"
            tmp.mkdir()
            plan_path = self.build_plan(tmp, target_accepted_examples=100)
            deduped_path = tmp / "deduped.jsonl"
            write_jsonl(deduped_path, base_records)
            dedup_config = tmp / "dedup_config.json"
            dedup_config.write_text(json.dumps({"mode": "full", "semantic_dedup": "enabled"}), encoding="utf-8")
            registry_path = tmp / "protected-cases.json"
            registry_path.write_text(json.dumps({"protected_pair_hashes": []}), encoding="utf-8")
            with self.assertRaises(SystemExit):
                build_dataset.run(
                    deduped_path, plan_path, registry_path, tmp / "frozen", tmp / "failures.jsonl",
                    run_id="target-run", verifier_model_id="mock/verifier-v1", dedup_config_path=dedup_config,
                )

    def test_smoke_diagnostics_accounting_invariant(self):
        generate_stats = {"generated": 10, "provider_errors": 1}
        validate_stats = {"passed": 8, "rejected": 2}
        verify_stats = {
            "accepted": 5, "rejected": 3, "provider_errors": 0, "dimension_disagreements": 1,
            "rejection_reasons": {"verdict_disagreement": 2, "low_verifier_confidence": 1},
        }
        dedupe_stats = {"exact_dedup_count": 1, "semantic_near_dedup_count": 0}
        final_records = [
            {"language": "en", "coverage_bucket": "basic", "canonical_verdict": "no_meaningful_change"},
            {"language": "tr", "coverage_bucket": "boundary", "canonical_verdict": "meaning_added"},
            {"language": "en", "coverage_bucket": "basic", "canonical_verdict": "no_meaningful_change"},
        ]
        from smoke_report import build_smoke_diagnostics

        diagnostics = build_smoke_diagnostics(
            generate_stats, validate_stats, pre_verify_contamination_count=1, verify_stats=verify_stats,
            dedupe_stats=dedupe_stats, post_dedup_contamination_count=1, final_records=final_records,
            generator_budget={"spend_usd": 0.1}, verifier_budget={"spend_usd": 0.2},
        )
        # accepted_before_dedup - exact_dups - semantic_dups - post_dedup_contamination == final_accepted
        self.assertEqual(
            diagnostics["accepted_before_dedup_count"]
            - diagnostics["exact_duplicates_dropped"]
            - diagnostics["semantic_near_duplicates_dropped"]
            - diagnostics["post_dedup_contamination_dropped"],
            diagnostics["final_accepted_count"],
        )
        self.assertEqual(diagnostics["contamination_dropped"], 2)
        self.assertAlmostEqual(diagnostics["total_spend_usd"], 0.3)


if __name__ == "__main__":
    unittest.main()
