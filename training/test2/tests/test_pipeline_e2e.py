#!/usr/bin/env python3
"""Offline end-to-end Test 2 pipeline test. No network access."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from collections import Counter
from pathlib import Path
from unittest.mock import patch

LIB_DIR = Path(__file__).resolve().parent.parent / "lib"
sys.path.insert(0, str(LIB_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "phase5a" / "lore"))

from acceptance import decide_acceptance, validate_verifier_output_structure  # noqa: E402
from contamination import filter_contaminated, is_contaminated  # noqa: E402
from dedup import exact_dedup, semantic_near_dedup  # noqa: E402
from ids import candidate_id, normalized_pair_hash  # noqa: E402
from jsonl_io import read_jsonl, write_jsonl  # noqa: E402
from policy import is_valid_dimensions_list, load_policy  # noqa: E402
from providers import MockGeneratorProvider, MockVerifierProvider  # noqa: E402

from budget import BudgetConfig, BudgetExceeded, BudgetTracker, SharedSpend, restore_tracker, shared_spend_from_persisted  # noqa: E402
from run_state import build_run_config, load_or_create_run_config  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))
import build_dataset  # noqa: E402
import dedupe as dedupe_stage  # noqa: E402
import full_run  # noqa: E402
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
            dedup_config_path=dedup_config,
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
                run_id="test-run", dedup_config_path=dedup_config,
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
            BudgetConfig(max_requests=5, max_budget_usd=1.0, max_cost_per_request_usd=0.0)

    def test_shared_spend_enforces_one_combined_usd_cap(self):
        shared = SharedSpend()
        generator_budget = BudgetTracker(BudgetConfig(max_requests=10, max_budget_usd=0.05, max_cost_per_request_usd=0.03), shared)
        verifier_budget = BudgetTracker(BudgetConfig(max_requests=10, max_budget_usd=0.05, max_cost_per_request_usd=0.03), shared)
        generator_budget.charge()  # shared spend now 0.03, within 0.05
        from budget import BudgetExceeded

        with self.assertRaises(BudgetExceeded):
            verifier_budget.charge()  # would push shared spend to 0.06 > 0.05
        self.assertEqual(generator_budget.requests, 1)
        self.assertEqual(verifier_budget.requests, 0)  # the rejected charge never incremented its own tracker

    def test_reserved_spend_is_the_pre_request_safety_cap_not_actual_cost(self):
        # max_cost_per_request_usd=0.05 is the conservative worst-case
        # reservation; max_budget_usd=0.10 allows exactly 2 requests worth
        # of reservation.
        tracker = BudgetTracker(BudgetConfig(max_requests=100, max_budget_usd=0.10, max_cost_per_request_usd=0.05))
        tracker.charge()  # reserved 0.05
        tracker.record_actual_cost(0.001)  # actual much CHEAPER than estimate
        tracker.charge()  # reserved 0.10 — still allowed, cap is on reserved not actual
        with self.assertRaises(BudgetExceeded):
            tracker.charge()  # reserved would be 0.15 > 0.10 — blocked BEFORE the request
        self.assertEqual(tracker.requests, 2)
        # A cheaper-than-estimated actual cost never loosens the reserved cap.
        self.assertAlmostEqual(tracker.reserved_spend_usd, 0.10)

    def test_actual_cost_higher_than_estimate_cannot_unlock_later_unsafe_requests(self):
        tracker = BudgetTracker(BudgetConfig(max_requests=100, max_budget_usd=0.10, max_cost_per_request_usd=0.05))
        tracker.charge()  # reserved 0.05
        tracker.record_actual_cost(5.00)  # actual FAR above the estimate
        # Reserved total is untouched by the actual-cost report — it is
        # provenance only and never feeds the pre-request safety check.
        self.assertAlmostEqual(tracker.reserved_spend_usd, 0.05)
        tracker.charge()  # reserved 0.10 — exactly at the cap, still safe
        with self.assertRaises(BudgetExceeded):
            tracker.charge()  # would be 0.15 — refused regardless of the earlier overrun

    def test_resumed_run_cannot_exceed_original_request_cap(self):
        config = BudgetConfig(max_requests=3)
        shared = SharedSpend()
        first = restore_tracker(config, shared, None)
        first.charge()
        first.charge()
        first.charge()
        persisted = first.state_for_persistence()
        with self.assertRaises(BudgetExceeded):
            first.charge()

        # Simulates a process restart: a brand new tracker restored from the
        # persisted state must inherit the exhausted cap, not reset it.
        resumed = restore_tracker(config, SharedSpend(), persisted)
        with self.assertRaises(BudgetExceeded):
            resumed.charge()
        self.assertEqual(resumed.requests, 3)

    def test_resumed_run_cannot_exceed_original_usd_cap(self):
        config = BudgetConfig(max_requests=100, max_budget_usd=0.10, max_cost_per_request_usd=0.05)
        shared = SharedSpend()
        first = restore_tracker(config, shared, None)
        first.charge()
        first.charge()  # reserved 0.10 — at cap
        persisted = first.state_for_persistence()
        shared_persisted = {"reserved_usd": shared.reserved_usd, "actual_usd": shared.actual_usd}

        resumed_shared = SharedSpend(reserved_usd=shared_persisted["reserved_usd"], actual_usd=shared_persisted["actual_usd"])
        resumed = restore_tracker(config, resumed_shared, persisted)
        with self.assertRaises(BudgetExceeded):
            resumed.charge()

    def test_cumulative_generator_and_verifier_spend_shared_across_resume(self):
        generator_state = {"requests": 2, "reserved_spend_usd": 0.06, "actual_spend_usd": 0.05}
        verifier_state = {"requests": 1, "reserved_spend_usd": 0.03, "actual_spend_usd": 0.02}
        shared = shared_spend_from_persisted(generator_state, verifier_state)
        self.assertAlmostEqual(shared.reserved_usd, 0.09)
        self.assertAlmostEqual(shared.actual_usd, 0.07)

        config = BudgetConfig(max_requests=100, max_budget_usd=0.10, max_cost_per_request_usd=0.02)
        verifier_tracker = restore_tracker(config, shared, verifier_state)
        with self.assertRaises(BudgetExceeded):
            # 0.09 (restored combined reserved spend) + 0.02 > 0.10 — the
            # verifier's own persisted state (0.03) is smaller than the
            # shared total, proving the cap is enforced against the SHARED
            # cumulative reservation, not the component's own.
            verifier_tracker.charge()

    def test_run_config_persists_and_rejects_incompatible_resume(self):
        path = self.tmp / "run_config.json"
        base_kwargs = dict(
            generator_model_id="gen/a", verifier_model_id="ver/a",
            coverage_plan_path=self.build_plan(self.tmp), policy_spec_path=Path("training/phase5a/lore/policy-spec.v1.json"),
            max_output_tokens=800, verifier_confidence_threshold=0.90,
            generator_budget_requests=30, verifier_budget_requests=30,
            max_budget_usd=None, max_cost_per_request_usd=0.0,
            protected_registry_override_used=False,
        )
        config = build_run_config(**base_kwargs)
        first = load_or_create_run_config(path, config)
        self.assertEqual(first, config)

        # Same config again — resumes cleanly.
        second = load_or_create_run_config(path, config)
        self.assertEqual(second, config)

        # Different generator model — refused.
        changed_kwargs = dict(base_kwargs, generator_model_id="gen/b")
        with self.assertRaises(SystemExit):
            load_or_create_run_config(path, build_run_config(**changed_kwargs))

        # Different budget configuration — also refused.
        changed_budget = dict(base_kwargs, max_budget_usd=5.0, max_cost_per_request_usd=0.01)
        with self.assertRaises(SystemExit):
            load_or_create_run_config(path, build_run_config(**changed_budget))

    def test_cumulative_max_candidates_across_invocations(self):
        import smoke

        generated_path = self.tmp / "generated.jsonl"
        self.assertEqual(smoke.compute_remaining_total(generated_path, max_candidates=30), 30)

        write_jsonl(generated_path, [{"id": f"g{i}", "coverage_bucket": "basic"} for i in range(12)])
        self.assertEqual(smoke.compute_remaining_total(generated_path, max_candidates=30), 18)

        write_jsonl(generated_path, [{"id": f"g{i}", "coverage_bucket": "basic"} for i in range(30)])
        # Already at (or past) the total — a resume must generate nothing more.
        self.assertEqual(smoke.compute_remaining_total(generated_path, max_candidates=30), 0)

    def test_verifier_output_structural_validation(self):
        valid_other = {"verdict": "meaning_transformed", "dimensions": [{"dimension": "certainty", "direction": "increased"}], "confidence": 0.95}
        self.assertIsNone(validate_verifier_output_structure(valid_other, POLICY))

        valid_uncertain = {"verdict": "uncertain", "dimensions": [], "confidence": 0.5}
        self.assertIsNone(validate_verifier_output_structure(valid_uncertain, POLICY))

        with self.subTest("confidence below 0"):
            bad = {"verdict": "no_meaningful_change", "dimensions": [], "confidence": -0.01}
            self.assertEqual(validate_verifier_output_structure(bad, POLICY), "invalid_confidence")

        with self.subTest("confidence above 1"):
            bad = {"verdict": "no_meaningful_change", "dimensions": [], "confidence": 1.01}
            self.assertEqual(validate_verifier_output_structure(bad, POLICY), "invalid_confidence")

        with self.subTest("uncertain with non-empty dimensions"):
            bad = {"verdict": "uncertain", "dimensions": [{"dimension": "certainty", "direction": "increased"}], "confidence": 0.5}
            self.assertEqual(validate_verifier_output_structure(bad, POLICY), "uncertain_with_nonempty_dimensions")

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
                run_id="ok-run", dedup_config_path=dedup_config,
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
                    run_id="quota-run", dedup_config_path=dedup_config,
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
                    run_id="band-run", dedup_config_path=dedup_config,
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
                    run_id="opmin-run", dedup_config_path=dedup_config,
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
                    run_id="lang-run", dedup_config_path=dedup_config,
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
                    run_id="target-run", dedup_config_path=dedup_config,
                )

    def test_smoke_diagnostics_accounting_invariant_for_a_resumed_run(self):
        # Artifacts as they'd exist on disk after TWO invocations of the same
        # run_id — stage files are cumulative (append-only / full-recompute),
        # so diagnostics built from them describe the whole run_id, not just
        # the latest invocation.
        from smoke_report import build_smoke_diagnostics

        out_dir = self.tmp / "smoke_artifacts"
        write_jsonl(out_dir / "generated.jsonl", [{"id": f"g{i}"} for i in range(10)])
        write_jsonl(out_dir / "failures" / "generate.jsonl", [{"coverage_bucket": "basic", "error": "boom"}])
        write_jsonl(out_dir / "validated.jsonl", [{"id": f"g{i}"} for i in range(8)])
        write_jsonl(out_dir / "failures" / "validate.jsonl", [{"id": "g8", "reason": "invalid_kind"}, {"id": "g9", "reason": "invalid_kind"}])
        write_jsonl(out_dir / "failures" / "contamination.jsonl", [
            {"id": "g_pre", "reason": "contamination_pre_verify"},
            {"id": "g_post", "reason": "contamination_post_dedup"},
        ])
        write_jsonl(out_dir / "verified.jsonl", [
            {"id": "v0", "language": "en", "canonical_verdict": "no_meaningful_change", "dimension_sets_equal": True},
            {"id": "v1", "language": "tr", "canonical_verdict": "meaning_added", "dimension_sets_equal": False},
            {"id": "v2", "language": "en", "canonical_verdict": "no_meaningful_change", "dimension_sets_equal": True},
        ])
        write_jsonl(out_dir / "failures" / "verify.jsonl", [
            {"id": "g_a", "reason": "verdict_disagreement"},
            {"id": "g_b", "reason": "verdict_disagreement"},
            {"id": "g_c", "reason": "low_verifier_confidence"},
            {"id": "g_d", "reason": "provider_error"},
        ])
        write_jsonl(out_dir / "deduped.jsonl", [
            {"id": "v0", "language": "en", "coverage_bucket": "basic", "canonical_verdict": "no_meaningful_change"},
            {"id": "v2", "language": "en", "coverage_bucket": "basic", "canonical_verdict": "no_meaningful_change"},
        ])
        dedupe_stats = {"exact_dedup_count": 0, "semantic_near_dedup_count": 0}
        generator_budget = {"requests": 10, "reserved_spend_usd": 0.10, "actual_spend_usd": 0.08}
        verifier_budget = {"requests": 7, "reserved_spend_usd": 0.07, "actual_spend_usd": 0.05}

        diagnostics = build_smoke_diagnostics(out_dir, dedupe_stats, generator_budget, verifier_budget)

        self.assertEqual(diagnostics["generated_count"], 10)
        self.assertEqual(diagnostics["generator_provider_errors"], 1)
        self.assertEqual(diagnostics["schema_valid_count"], 8)
        self.assertEqual(diagnostics["schema_invalid_count"], 2)
        self.assertEqual(diagnostics["pre_verify_contamination_dropped"], 1)
        self.assertEqual(diagnostics["post_dedup_contamination_dropped"], 1)
        self.assertEqual(diagnostics["contamination_dropped"], 2)
        self.assertEqual(diagnostics["accepted_before_dedup_count"], 3)
        self.assertEqual(diagnostics["verifier_request_count"], 3 + 4)  # accepted + failed verify attempts
        self.assertEqual(diagnostics["verifier_provider_errors"], 1)
        self.assertEqual(diagnostics["semantic_verdict_disagreement_count"], 2)
        self.assertEqual(diagnostics["low_verifier_confidence_count"], 1)
        self.assertEqual(diagnostics["dimension_disagreement_count"], 1)
        self.assertEqual(diagnostics["final_accepted_count"], 2)
        # accepted_before_dedup - exact - semantic - post_dedup_contamination == final_accepted
        self.assertEqual(
            diagnostics["accepted_before_dedup_count"]
            - diagnostics["exact_duplicates_dropped"]
            - diagnostics["semantic_near_duplicates_dropped"]
            - diagnostics["post_dedup_contamination_dropped"],
            diagnostics["final_accepted_count"],
        )
        self.assertAlmostEqual(diagnostics["total_reserved_spend_usd"], 0.17)
        self.assertAlmostEqual(diagnostics["total_actual_spend_usd"], 0.13)

        # Re-reading the same (unchanged) artifacts a second time — as a
        # no-op resume would — yields identical cumulative diagnostics.
        diagnostics_again = build_smoke_diagnostics(out_dir, dedupe_stats, generator_budget, verifier_budget)
        self.assertEqual(diagnostics, diagnostics_again)

    def test_full_run_refuses_with_empty_protected_registry_and_no_override(self):
        plan = {"coverage_buckets": [{"bucket": "b1", "quota": 1}], "language_mix": {"en": 1.0}}

        class UnusedProvider:
            model_id = "unused"

            def generate(self, coverage_item):
                raise AssertionError("must never be called with an empty registry")

        registry_path = self.tmp / "protected-cases-empty.json"
        registry_path.write_text(json.dumps({"version": "v1", "protected_pair_hashes": []}), encoding="utf-8")

        with self.assertRaises(SystemExit):
            full_run.replenish_to_accepted_quota(
                UnusedProvider(), UnusedProvider(), plan, protected_registry_path=registry_path, policy=POLICY,
                out_dir=self.data, max_total_requests=10, max_attempts_per_bucket=5,
            )

    def test_full_run_refuses_with_partially_populated_protected_registry(self):
        plan = {"coverage_buckets": [{"bucket": "b1", "quota": 1}], "language_mix": {"en": 1.0}}

        class UnusedProvider:
            model_id = "unused"

            def generate(self, coverage_item):
                raise AssertionError("must never be called with a partially populated registry")

        nine_hashes = [normalized_pair_hash(f"unrelated {i}", f"unrelated final {i}") for i in range(9)]
        registry_path = self.tmp / "protected-cases-partial.json"
        registry_path.write_text(json.dumps({"version": "v1", "protected_pair_hashes": nine_hashes}), encoding="utf-8")

        with self.assertRaises(SystemExit):
            full_run.replenish_to_accepted_quota(
                UnusedProvider(), UnusedProvider(), plan, protected_registry_path=registry_path, policy=POLICY,
                out_dir=self.data, max_total_requests=10, max_attempts_per_bucket=5,
            )

    def test_full_run_refuses_with_malformed_protected_registry(self):
        plan = {"coverage_buckets": [{"bucket": "b1", "quota": 1}], "language_mix": {"en": 1.0}}

        class UnusedProvider:
            model_id = "unused"

            def generate(self, coverage_item):
                raise AssertionError("must never be called with a malformed registry")

        registry_path = self.tmp / "protected-cases-malformed.json"
        registry_path.write_text(
            json.dumps({"version": "v1", "protected_pair_hashes": ["not-a-real-sha256-hash"]}), encoding="utf-8"
        )

        with self.assertRaises(SystemExit):
            full_run.replenish_to_accepted_quota(
                UnusedProvider(), UnusedProvider(), plan, protected_registry_path=registry_path, policy=POLICY,
                out_dir=self.data, max_total_requests=10, max_attempts_per_bucket=5,
            )


class ScriptedReplenishGenerator:
    """Fails a bucket's first `fail_for` attempts with a schema-invalid
    `kind`, then produces distinct valid candidates forever after — proves
    replenishment recovers from upstream rejection instead of stalling."""

    model_id = "mock/replenish-generator-v1"

    def __init__(self, fail_for_by_bucket: dict[str, int]):
        self.fail_for_by_bucket = fail_for_by_bucket
        self.counters: Counter[str] = Counter()

    def generate(self, coverage_item: dict) -> dict:
        bucket = coverage_item["bucket"]
        language = coverage_item["language"]
        n = self.counters[bucket]
        self.counters[bucket] += 1
        fail_for = self.fail_for_by_bucket.get(bucket, 0)
        if n < fail_for:
            return candidate("invalid_kind_value", "", "x", "y", "", "no_meaningful_change", [], language=language)
        unique = f"unique text {bucket} {n}"
        return candidate("replaced", "", unique, unique + " revised", "", "no_meaningful_change", [], language=language)


class AlwaysAgreesVerifier:
    model_id = "mock/replenish-verifier-v1"

    def verify(self, candidate_input: dict) -> dict:
        return {"verdict": "no_meaningful_change", "dimensions": [], "confidence": 0.95}


class TestFullRunReplenishment(unittest.TestCase):
    def setUp(self):
        self._tmp_ctx = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp_ctx.name)
        self.out_dir = self.tmp / "full_run"
        # A ready (10 unique, well-formed, unrelated) protected-case registry —
        # these tests exercise replenishment behavior, not the registry gate,
        # so it must pass require_ready() without matching any real candidate.
        self.protected_hashes = [normalized_pair_hash(f"unrelated {i}", f"unrelated final {i}") for i in range(10)]
        self.registry_path = self.tmp / "protected-cases-ready.json"
        self.registry_path.write_text(
            json.dumps({"version": "v1", "protected_pair_hashes": self.protected_hashes}), encoding="utf-8"
        )

    def tearDown(self):
        self._tmp_ctx.cleanup()

    def test_rejected_examples_are_replenished_until_bucket_reaches_quota(self):
        plan = {
            "coverage_buckets": [{"bucket": "b1", "quota": 3}],
            "language_mix": {"en": 1.0},
        }
        generator = ScriptedReplenishGenerator(fail_for_by_bucket={"b1": 4})  # 4 schema-invalid, then all valid
        verifier = AlwaysAgreesVerifier()

        result = full_run.replenish_to_accepted_quota(
            generator, verifier, plan, self.registry_path, POLICY, self.out_dir,
            max_total_requests=50, max_attempts_per_bucket=20,
        )
        self.assertEqual(result["missing_quotas"], {})
        self.assertEqual(result["accepted_counts"]["b1"], 3)
        self.assertGreater(result["total_attempts"], 3)  # more attempts than accepted, proving replenishment happened

    def test_safety_ceiling_stops_an_impossible_bucket_without_infinite_loop(self):
        plan = {
            "coverage_buckets": [
                {"bucket": "good", "quota": 2},
                {"bucket": "impossible", "quota": 2},
            ],
            "language_mix": {"en": 1.0},
        }
        # "impossible" always fails schema validation — can never be satisfied.
        generator = ScriptedReplenishGenerator(fail_for_by_bucket={"good": 0, "impossible": 10_000})
        verifier = AlwaysAgreesVerifier()

        result = full_run.replenish_to_accepted_quota(
            generator, verifier, plan, self.registry_path, POLICY, self.out_dir,
            max_total_requests=200, max_attempts_per_bucket=5,
        )
        self.assertEqual(result["accepted_counts"].get("good"), 2)  # the satisfiable bucket still completes
        self.assertIn("impossible", result["missing_quotas"])
        self.assertEqual(result["missing_quotas"]["impossible"], 2)
        self.assertEqual(result["attempts_by_bucket"]["impossible"], 5)  # stopped exactly at the ceiling, not beyond
        self.assertIsNotNone(result["stopped_reason"])

    def test_corpus_does_not_freeze_with_missing_accepted_quotas(self):
        plan_path = self.tmp / "coverage-plan.json"
        plan = {
            "coverage_buckets": [{"bucket": "b1", "quota": 5}],
            "language_mix": {"en": 1.0},
            "policy_spec": "training/phase5a/lore/policy-spec.v1.json",
            "verdict_bands": {v: {"min_fraction": 0.0, "max_fraction": 1.0} for v in POLICY["verdicts"]},
            "operation_minimums": {"added": 0, "removed": 0, "replaced": 0, "reordered": 0},
            "target_accepted_examples": 5,
        }
        plan_path.write_text(json.dumps(plan), encoding="utf-8")

        # A ceiling far too low to ever reach the quota of 5.
        generator = ScriptedReplenishGenerator(fail_for_by_bucket={"b1": 0})
        verifier = AlwaysAgreesVerifier()
        result = full_run.replenish_to_accepted_quota(
            generator, verifier, plan, self.registry_path, POLICY, self.out_dir,
            max_total_requests=2, max_attempts_per_bucket=2,
        )
        self.assertIn("b1", result["missing_quotas"])

        with self.assertRaises(SystemExit):
            build_dataset.run(
                self.out_dir / "deduped.jsonl", plan_path, self.registry_path, self.tmp / "frozen",
                self.tmp / "build_failures.jsonl", run_id="incomplete-run", dedup_config_path=self.out_dir / "dedup_config.json",
            )


class TestSmokeProtectedRegistryGate(unittest.TestCase, MiniCoveragePlanMixin):
    """Proves smoke.py's registry readiness gate — not just the standalone
    checker — actually blocks real generation, and does so before any
    network call. urllib.request.urlopen is patched to raise if reached at
    all; a SystemExit (not that AssertionError) proves the gate fired
    first."""

    def setUp(self):
        self._tmp_ctx = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp_ctx.name)
        self.plan_path = self.build_plan(self.tmp)
        self.env_patch = patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key-not-real"})
        self.env_patch.start()
        self.urlopen_patch = patch(
            "urllib.request.urlopen", side_effect=AssertionError("must never reach the network")
        )
        self.mock_urlopen = self.urlopen_patch.start()

    def tearDown(self):
        self.urlopen_patch.stop()
        self.env_patch.stop()
        self._tmp_ctx.cleanup()

    def _run_smoke(self, registry_path: Path, run_id: str, allow_empty: bool = False) -> None:
        smoke.run_smoke(
            self.plan_path, registry_path, self.tmp / "data" / "smoke", run_id,
            generator_model_id="mock/gen", verifier_model_id="mock/verify",
            max_candidates=5, generator_budget_requests=5, verifier_budget_requests=5,
            allow_empty_protected_registry=allow_empty,
        )

    def _write_registry(self, name: str, hashes: list[str], version: str = "v1") -> Path:
        path = self.tmp / name
        path.write_text(json.dumps({"version": version, "protected_pair_hashes": hashes}), encoding="utf-8")
        return path

    def test_zero_of_ten_refuses_without_override(self):
        registry_path = self._write_registry("reg-0.json", [])
        with self.assertRaises(SystemExit):
            self._run_smoke(registry_path, "smoke-0-of-10")
        self.mock_urlopen.assert_not_called()

    def test_zero_of_ten_passes_gate_with_explicit_empty_override(self):
        registry_path = self._write_registry("reg-0-override.json", [])
        # The override permits proceeding past the gate. generate.py treats
        # a per-candidate provider exception (our patched urlopen raising)
        # as a recorded failure, not a crash, so this call completes
        # normally — the network attempt itself is what proves the gate
        # was passed.
        self._run_smoke(registry_path, "smoke-0-of-10-override", allow_empty=True)
        self.mock_urlopen.assert_called()

    def test_one_of_ten_refuses(self):
        hashes = [normalized_pair_hash("o", "f")]
        registry_path = self._write_registry("reg-1.json", hashes)
        with self.assertRaises(SystemExit):
            self._run_smoke(registry_path, "smoke-1-of-10")
        self.mock_urlopen.assert_not_called()

    def test_one_of_ten_refuses_even_with_override_flag(self):
        hashes = [normalized_pair_hash("o", "f")]
        registry_path = self._write_registry("reg-1-override.json", hashes)
        with self.assertRaises(SystemExit):
            self._run_smoke(registry_path, "smoke-1-of-10-override", allow_empty=True)
        self.mock_urlopen.assert_not_called()

    def test_nine_of_ten_refuses(self):
        hashes = [normalized_pair_hash(f"o{i}", f"f{i}") for i in range(9)]
        registry_path = self._write_registry("reg-9.json", hashes)
        with self.assertRaises(SystemExit):
            self._run_smoke(registry_path, "smoke-9-of-10")
        self.mock_urlopen.assert_not_called()

    def test_malformed_registry_refuses(self):
        registry_path = self._write_registry("reg-bad.json", ["not-a-real-sha256-hash"])
        with self.assertRaises(SystemExit):
            self._run_smoke(registry_path, "smoke-malformed")
        self.mock_urlopen.assert_not_called()

    def test_malformed_registry_refuses_even_with_override_flag(self):
        registry_path = self._write_registry("reg-bad-override.json", ["not-a-real-sha256-hash"])
        with self.assertRaises(SystemExit):
            self._run_smoke(registry_path, "smoke-malformed-override", allow_empty=True)
        self.mock_urlopen.assert_not_called()

    def test_wrong_version_refuses(self):
        registry_path = self._write_registry("reg-wrong-version.json", [], version="v2")
        with self.assertRaises(SystemExit):
            self._run_smoke(registry_path, "smoke-wrong-version")
        self.mock_urlopen.assert_not_called()

    def test_ten_of_ten_passes_gate(self):
        hashes = [normalized_pair_hash(f"o{i}", f"f{i}") for i in range(10)]
        registry_path = self._write_registry("reg-10.json", hashes)
        # Past the gate, generation proceeds to the network — the patched
        # urlopen being called (its exception is swallowed per-candidate
        # by generate.py, not propagated) proves the registry gate passed.
        self._run_smoke(registry_path, "smoke-10-of-10")
        self.mock_urlopen.assert_called()


class TestFullRunProtectedRegistryGate(unittest.TestCase):
    """Proves full_run.py's readiness gate blocks generation before any
    provider call — the provider fixture raises if ever invoked, and
    there is no override path at all."""

    def setUp(self):
        self._tmp_ctx = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp_ctx.name)
        self.plan = {"coverage_buckets": [{"bucket": "b1", "quota": 1}], "language_mix": {"en": 1.0}}

    def tearDown(self):
        self._tmp_ctx.cleanup()

    def _write_registry(self, name: str, hashes: list[str], version: str = "v1") -> Path:
        path = self.tmp / name
        path.write_text(json.dumps({"version": version, "protected_pair_hashes": hashes}), encoding="utf-8")
        return path

    def _assert_refuses_before_any_provider_call(self, registry_path: Path) -> None:
        class ProviderThatMustNeverBeCalled:
            model_id = "unused"

            def generate(self, coverage_item):
                raise AssertionError("must never be called before the registry gate passes")

        with self.assertRaises(SystemExit):
            full_run.replenish_to_accepted_quota(
                ProviderThatMustNeverBeCalled(), ProviderThatMustNeverBeCalled(), self.plan,
                registry_path, POLICY, self.tmp / "full_run", max_total_requests=10, max_attempts_per_bucket=5,
            )

    def test_zero_of_ten_refuses(self):
        self._assert_refuses_before_any_provider_call(self._write_registry("reg-0.json", []))

    def test_one_of_ten_refuses(self):
        hashes = [normalized_pair_hash("o", "f")]
        self._assert_refuses_before_any_provider_call(self._write_registry("reg-1.json", hashes))

    def test_nine_of_ten_refuses(self):
        hashes = [normalized_pair_hash(f"o{i}", f"f{i}") for i in range(9)]
        self._assert_refuses_before_any_provider_call(self._write_registry("reg-9.json", hashes))

    def test_malformed_registry_refuses(self):
        self._assert_refuses_before_any_provider_call(
            self._write_registry("reg-bad.json", ["not-a-real-sha256-hash"])
        )

    def test_ten_of_ten_passes_gate(self):
        hashes = [normalized_pair_hash(f"o{i}", f"f{i}") for i in range(10)]
        registry_path = self._write_registry("reg-10.json", hashes)

        class OneShotGenerator:
            model_id = "mock/gen"

            def generate(self, coverage_item):
                return candidate("replaced", "", "x", "y", "", "no_meaningful_change", [], language="en")

        class AgreesVerifier:
            model_id = "mock/verify"

            def verify(self, candidate_input):
                return {"verdict": "no_meaningful_change", "dimensions": [], "confidence": 0.95}

        result = full_run.replenish_to_accepted_quota(
            OneShotGenerator(), AgreesVerifier(), self.plan, registry_path, POLICY,
            self.tmp / "full_run", max_total_requests=10, max_attempts_per_bucket=5,
        )
        self.assertEqual(result["missing_quotas"], {})


if __name__ == "__main__":
    unittest.main()
