import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import native_strategy_search as launcher


class NativeStrategySearchLauncherTest(unittest.TestCase):
    @staticmethod
    def launch_limits(**overrides):
        values = {"count": 5_000, "start_position": 0, "shard_size": 2_500,
                  "cpu": 4, "memory_gib": 4, "threads": 4, "max_containers": 2,
                  "timeout_seconds": 600, "max_cost_usd": 100, "chunk_size": 250,
                  "shuffles": 1, "scorer": "rust", "product": False}
        values.update(overrides)
        if values.get("ordered_product") and "shuffle_seeds" not in overrides:
            values["shuffle_seeds"] = launcher.ORDERED_PRODUCT_SEEDS
        return launcher.validate_launch_limits(**values)

    def test_worst_case_includes_all_retry_attempts(self):
        value = launcher.projected_cost_usd(2, 4, 4, 600, 2)
        expected = (2 * 3 * (630 / 3600) * (4 * 0.0473 + 4 * 0.008)
                    + (3 * 1 * 630 + 300) / 3600 * (0.0473 + 0.008))
        self.assertAlmostEqual(value, expected)

    def test_ordered_cpu_cap_includes_the_one_cpu_controller(self):
        self.assertEqual(self.launch_limits(cpu=191, threads=1, max_containers=1)["aggregate_cpu"], 192)
        with self.assertRaisesRegex(ValueError, "192 physical cores"):
            self.launch_limits(cpu=192, threads=1, max_containers=1)
        self.assertEqual(self.launch_limits(product=True, count=20_000, cpu=192, threads=1,
                                            max_containers=1)["aggregate_cpu"], 192)

    def test_launch_rejects_max_cost_threads_and_mode_specific_limits(self):
        with self.assertRaisesRegex(ValueError, "worst-case cost"):
            self.launch_limits(max_cost_usd=0.001)
        with self.assertRaisesRegex(ValueError, "threads cannot exceed"):
            self.launch_limits(cpu=4, threads=5)
        with self.assertRaisesRegex(ValueError, "product count"):
            self.launch_limits(product=True, count=19_999, max_containers=1)
        with self.assertRaisesRegex(ValueError, "ordered product coordinator"):
            self.launch_limits(product=True, count=20_000, max_containers=2)
        with self.assertRaisesRegex(ValueError, "ordered space"):
            self.launch_limits(start_position=launcher.FULL_CANDIDATE_COUNT, count=1)
        with self.assertRaisesRegex(ValueError, "cannot exceed \\$5"):
            self.launch_limits(count=launcher.FULL_CANDIDATE_COUNT,
                               shard_size=150_000, max_containers=47, max_cost_usd=11)

    def test_ordered_product_requires_exact_scope_authorization_and_bounded_counts(self):
        values = self.launch_limits(count=launcher.FULL_CANDIDATE_COUNT, shard_size=250_000,
            cpu=2, threads=2, max_containers=95, timeout_seconds=420, max_cost_usd=5, ordered_product=True,
            retained_count=500_000, reservoir_count=20_000,
            authorization=launcher.ORDERED_PRODUCT_AUTHORIZATION)
        expected = launcher.projected_ordered_product_cost_usd(52, 2, 2, 4, 420, 95)
        self.assertAlmostEqual(values["projected"], expected)
        self.assertAlmostEqual(values["projected"], 2.885033333333333)
        self.assertLess(3 * values["projected"], launcher.GROSS_BUDGET_USD)
        self.assertTrue(values["full_run"])
        with self.assertRaisesRegex(ValueError, "authorization does not match"):
            self.launch_limits(count=launcher.FULL_CANDIDATE_COUNT, ordered_product=True,
                retained_count=500_000, reservoir_count=20_000)
        with self.assertRaisesRegex(ValueError, "retained and reservoir"):
            self.launch_limits(count=launcher.FULL_CANDIDATE_COUNT, ordered_product=True,
                retained_count=10, reservoir_count=20,
                authorization=launcher.ORDERED_PRODUCT_AUTHORIZATION)
        with self.assertRaisesRegex(ValueError, "complete ordered"):
            self.launch_limits(count=20_000, ordered_product=True,
                authorization=launcher.ORDERED_PRODUCT_AUTHORIZATION)
        for kingdom, authorization in launcher.ORDERED_PRODUCT_AUTHORIZATIONS.items():
            with self.subTest(kingdom=kingdom):
                accepted = self.launch_limits(kingdom=kingdom,
                    count=launcher.FULL_CANDIDATE_COUNT, shard_size=250_000,
                    max_containers=47, timeout_seconds=420, max_cost_usd=5,
                    ordered_product=True, authorization=authorization)
                self.assertTrue(accepted["full_run"])
                wrong_authorization = (launcher.ORDERED_PRODUCT_AUTHORIZATION
                    if kingdom != launcher.DEFAULT_ORDERED_PRODUCT_KINGDOM
                    else launcher.ORDERED_PRODUCT_AUTHORIZATIONS["deep-beam-tuning-001"])
                with self.assertRaisesRegex(ValueError, "authorization does not match"):
                    self.launch_limits(kingdom=kingdom, count=launcher.FULL_CANDIDATE_COUNT,
                        shard_size=250_000, max_containers=47, timeout_seconds=420,
                        max_cost_usd=5, ordered_product=True, authorization=wrong_authorization)
        for index in range(1, 4):
            authorization = f"k007-ordered-product-seed-replication-{index}-v1"
            seeds = [4_100_000 + index * 1_000_000 + offset for offset in range(4)]
            accepted = self.launch_limits(kingdom="deep-beam-tuning-007",
                count=launcher.FULL_CANDIDATE_COUNT, shard_size=250_000,
                cpu=2, threads=2, max_containers=95, timeout_seconds=420, max_cost_usd=5,
                ordered_product=True, authorization=authorization, shuffle_seeds=seeds)
            self.assertEqual(accepted["shuffle_seeds"], seeds)
            with self.assertRaisesRegex(ValueError, "authorization does not match"):
                self.launch_limits(kingdom="deep-beam-tuning-007",
                    count=launcher.FULL_CANDIDATE_COUNT, ordered_product=True,
                    authorization=authorization, shuffle_seeds=launcher.ORDERED_PRODUCT_SEEDS)
        with self.assertRaisesRegex(ValueError, "unsupported ordered product kingdom"):
            self.launch_limits(kingdom="deep-beam-tuning-002")
        with self.assertRaisesRegex(ValueError, "not valid for this mode"):
            self.launch_limits(authorization=launcher.ORDERED_PRODUCT_AUTHORIZATION)

    def test_ordered_subprocess_timeouts_fit_below_the_modal_timeout(self):
        generation, scoring = launcher.ordered_subprocess_timeouts(600)
        self.assertLessEqual(generation + scoring, 630)
        self.assertGreater(generation, 0)
        self.assertGreater(scoring, 0)

    def test_competitive_shards_adapt_from_candidates_to_schedule_ranges(self):
        broad = launcher.adaptive_competitive_shards(20_000, 8, 48)
        self.assertEqual(len(broad), 3)
        self.assertTrue(all(shard["schedule_start"] == 0 and shard["schedule_end"] == 8
                            for shard in broad))
        narrow = launcher.adaptive_competitive_shards(2, 6_400, 16, target_blocks=1_000)
        self.assertGreater(len(narrow), 2)
        covered = {(candidate, schedule) for shard in narrow
                   for candidate in range(shard["candidate_start"], shard["candidate_end"])
                   for schedule in range(shard["schedule_start"], shard["schedule_end"])}
        self.assertEqual(covered, {(candidate, schedule) for candidate in range(2)
                                   for schedule in range(6_400)})
        self.assertEqual(sum((shard["candidate_end"] - shard["candidate_start"])
                             * (shard["schedule_end"] - shard["schedule_start"])
                             for shard in narrow), 2 * 6_400)

    def test_competitive_artifact_is_compact_restart_safe_and_digest_checked(self):
        spec = {"run_id": "run", "look_id": "look-8", "input_hash": "a" * 64,
                "shard_id": 0, "candidate_start": 0, "candidate_end": 2,
                "schedule_start": 0, "schedule_end": 3}
        header = {"schemaVersion": 1, "runId": "run", "lookId": "look-8",
                  "inputHash": "a" * 64, "shardId": 0,
                  "candidateStart": 0, "candidateEnd": 2,
                  "scheduleStart": 0, "scheduleEnd": 3,
                  "scorerVersion": launcher.COMPETITIVE_SCORER_VERSION}
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "shard.hps"
            launcher._write_competitive_artifact(path, header, bytes([0, 1, 2, 3, 4, 2]), bytes([2] * 6))
            self.assertTrue(launcher.valid_competitive_artifact(path, spec))
            held, scores, played = launcher._read_competitive_artifact(path)
            self.assertEqual((held["scoreCount"], scores, played),
                             (6, bytes([0, 1, 2, 3, 4, 2]), bytes([2] * 6)))
            raw = bytearray(path.read_bytes())
            raw[-1] ^= 1
            path.write_bytes(raw)
            self.assertFalse(launcher.valid_competitive_artifact(path, spec))

    def test_competitive_artifact_assembly_restores_candidate_major_order(self):
        base = {"run_id": "run", "look_id": "look", "input_hash": "b" * 64}
        shards = [{**base, **shard} for shard in
                  launcher.adaptive_competitive_shards(2, 5, 4, target_blocks=3)]
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            artifacts = []
            for spec in shards:
                scores = bytes((candidate * 5 + schedule) % 5
                    for candidate in range(spec["candidate_start"], spec["candidate_end"])
                    for schedule in range(spec["schedule_start"], spec["schedule_end"]))
                path = root / f"{spec['shard_id']}.hps"
                header = {"schemaVersion": 1, "runId": "run", "lookId": "look",
                    "inputHash": "b" * 64, "shardId": spec["shard_id"],
                    "candidateStart": spec["candidate_start"], "candidateEnd": spec["candidate_end"],
                    "scheduleStart": spec["schedule_start"], "scheduleEnd": spec["schedule_end"]}
                launcher._write_competitive_artifact(path, header, scores, bytes([2] * len(scores)))
                artifacts.append((path, spec))
            complete = root / "complete.hps"
            digest = launcher.assemble_competitive_artifacts(artifacts, complete, 2, 5,
                {"schemaVersion": 1, "runId": "run", "lookId": "look",
                 "inputHash": "b" * 64, "candidateCount": 2, "scheduleCount": 5})
            held, scores, played = launcher._read_competitive_artifact(complete)
            self.assertEqual(held["digest"], digest)
            self.assertEqual(scores, bytes([0, 1, 2, 3, 4, 0, 1, 2, 3, 4]))
            self.assertEqual(played, bytes([2] * 10))

    def test_competitive_cost_controls_keep_the_two_dollar_hard_cap(self):
        limits = launcher.validate_competitive_launch(candidate_count=20_000, schedule_count=8,
            cpu=4, memory_gib=4, threads=4, max_containers=16, timeout_seconds=180,
            max_cost_usd=2)
        self.assertLessEqual(limits["projected"], 2)
        with self.assertRaisesRegex(ValueError, "cannot exceed \\$2"):
            launcher.validate_competitive_launch(candidate_count=20_000, schedule_count=8,
                cpu=4, memory_gib=4, threads=4, max_containers=16, timeout_seconds=180,
                max_cost_usd=2.01)

    def test_product_controller_reloads_remote_stage_commits_before_each_merge(self):
        class SnapshotVolume:
            remote_version = 0
            visible_version = 0
            reload_count = 0

            def reload(self):
                self.visible_version = self.remote_version
                self.reload_count += 1

            def commit(self):
                pass

        held_volume = SnapshotVolume()
        config = {"run_id": "run", "kingdom": launcher.DEFAULT_ORDERED_PRODUCT_KINGDOM,
                  "build_version": "build", "rule_fingerprint": "rules",
                  "retained_count": 500_000, "reservoir_count": 20_000,
                  "shuffle_seeds": launcher.ORDERED_PRODUCT_SEEDS,
                  "shard_size": 250_000, "cpu": 2, "memory_gib": 4,
                  "timeout_seconds": 420, "max_containers": 95}

        def complete_stage(_function, specs, _config):
            held_volume.remote_version += 1
            stage = "stage-one" if len(specs) == 52 else "stage-two"
            return [{"status": "success", "stage": stage, "shardId": spec["shard_id"],
                     "contentDigest": f"digest-{spec['shard_id']}", "reused": True}
                    for spec in specs]

        def require_visible_snapshot(command, _label, **_kwargs):
            required = 1 if "merge-stage-one" in command else 2
            if held_volume.visible_version < required:
                raise RuntimeError("remote stage commit is not visible")
            return subprocess.CompletedProcess(command, 0, "", "")

        with patch.object(launcher, "volume", held_volume), \
                patch.object(launcher, "_run_product_stage", side_effect=complete_stage), \
                patch.object(launcher, "_run_checked", side_effect=require_visible_snapshot), \
                patch.object(launcher, "_atomic_json"):
            summary = launcher.ordered_product_controller.get_raw_f()(config)

        self.assertEqual(summary["status"], "success")
        self.assertEqual(held_volume.reload_count, 3)
        self.assertEqual(held_volume.visible_version, 2)

    def test_controller_subprocess_failure_exposes_stderr(self):
        failure = subprocess.CalledProcessError(1, ["command"], stderr="exact child failure\n")
        with patch.object(launcher.subprocess, "run", side_effect=failure):
            with self.assertRaisesRegex(RuntimeError, "stage-one merge failed: exact child failure"):
                launcher._run_checked(["command"], "stage-one merge", text=True, capture_output=True)

    def test_reservation_is_atomic_and_resume_does_not_reserve_twice(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = pathlib.Path(directory) / "ledger.json"
            with patch.object(launcher, "LEDGER_PATH", ledger):
                config = {"a": 1}
                first = launcher.reserve_cost("run", 1.25, False, config)
                second = launcher.reserve_cost("run", 1.25, False, config)
                self.assertEqual(first, second)
                held = json.loads(ledger.read_text())
                self.assertEqual(len(held["runs"]), 1)
                self.assertEqual(held["runs"]["run"]["reservedUsd"], 1.25)

    def test_reservation_enforces_cumulative_budget_and_three_full_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = pathlib.Path(directory) / "ledger.json"
            with patch.object(launcher, "LEDGER_PATH", ledger):
                launcher.reserve_cost("budget-a", 24.5, False, {"run": "a"})
                launcher.reserve_cost("budget-b", 0.5, False, {"run": "b"})
                with self.assertRaisesRegex(RuntimeError, "cumulative reservation"):
                    launcher.reserve_cost("budget-c", 0.01, False, {"run": "c"})
        with tempfile.TemporaryDirectory() as directory:
            ledger = pathlib.Path(directory) / "ledger.json"
            with patch.object(launcher, "LEDGER_PATH", ledger):
                for index in range(3):
                    launcher.reserve_cost(f"full-{index}", 1, True, {"run": index})
                with self.assertRaisesRegex(RuntimeError, "full-space run limit"):
                    launcher.reserve_cost("full-3", 1, True, {"run": 3})

    def test_each_product_authorization_is_one_use_and_bypasses_only_the_full_run_cap(self):
        for authorization, contract in launcher.ORDERED_PRODUCT_AUTHORIZATION_CONTRACTS.items():
            kingdom = contract["kingdom"]
            with self.subTest(authorization=authorization), tempfile.TemporaryDirectory() as directory:
                ledger = pathlib.Path(directory) / "ledger.json"
                with patch.object(launcher, "LEDGER_PATH", ledger):
                    for index in range(3):
                        launcher.reserve_cost(f"full-{index}", 1, True, {"run": index})
                    config = {"kind": "ordered-product", "kingdom": kingdom,
                              "authorization": authorization,
                              "shuffle_seeds": contract["shuffle_seeds"]}
                    launcher.reserve_cost("authorized", 1, True, config)
                    self.assertEqual(launcher.reserve_cost("authorized", 1, True, config)["runId"],
                                     "authorized")
                    with self.assertRaisesRegex(RuntimeError, "already used"):
                        launcher.reserve_cost("authorized-again", 1, True, config)

    def test_correction_continuation_replaces_failed_reservation_with_actual_spend(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = pathlib.Path(directory) / "ledger.json"
            with patch.object(launcher, "LEDGER_PATH", ledger):
                authorization = launcher.ORDERED_PRODUCT_AUTHORIZATION
                launcher.reserve_cost("failed", 2.8, True,
                    {"kind": "ordered-product", "kingdom": launcher.DEFAULT_ORDERED_PRODUCT_KINGDOM,
                     "authorization": authorization, "shuffle_seeds": launcher.ORDERED_PRODUCT_SEEDS})
                continued = {"kind": "ordered-product",
                    "kingdom": launcher.DEFAULT_ORDERED_PRODUCT_KINGDOM,
                    "authorization": authorization, "shuffle_seeds": launcher.ORDERED_PRODUCT_SEEDS,
                    "continuation_run_id": "failed",
                    "prior_actual_usd": 0.43796662}
                launcher.reserve_cost("continued", 2.9, True, continued)
                held = json.loads(ledger.read_text())
                self.assertEqual(held["runs"]["failed"]["reservedUsd"], 0.43796662)
                self.assertEqual(held["runs"]["failed"]["status"], "superseded")
                self.assertEqual(held["runs"]["continued"]["reservedUsd"], 2.9)

    def test_production_typescript_helper_generates_each_supported_ordered_shard(self):
        expected = {
            "deep-beam-tuning-001": "fe10624e178e8",
            "deep-beam-tuning-007": "65257033178f5",
            "deep-beam-tuning-008": "fea778e71849c",
            "deep-beam-tuning-009": "fa0328fb18315",
        }
        for kingdom, digest in expected.items():
            with self.subTest(kingdom=kingdom), tempfile.TemporaryDirectory() as directory:
                request = pathlib.Path(directory) / "request.jsonl"
                metadata = pathlib.Path(directory) / "metadata.json"
                seeds = [5_100_000, 5_100_001, 5_100_002, 5_100_003] \
                    if kingdom == "deep-beam-tuning-007" else [4_100_000]
                subprocess.run(["npx", "tsx", "scripts/native_ordered_shard_input.ts",
                    "--kingdom", kingdom, "--start-position", "0", "--end-position", "500",
                    "--threads", "1", "--cpu", "1", "--seeds", ",".join(map(str, seeds)),
                    "--request", str(request), "--metadata", str(metadata)], check=True)
                payload = json.loads(request.read_text())["payload"]
                held = json.loads(metadata.read_text())
                self.assertEqual(payload["kingdom"]["id"], kingdom)
                self.assertEqual(len(payload["strategies"]), 500)
                self.assertEqual(held["kingdomId"], kingdom)
                self.assertEqual(held["candidateDigest"], digest)
                self.assertEqual(held["completeCount"], 500)
                self.assertEqual(payload["seeds"], seeds)
                self.assertEqual(held["shuffleSeeds"], seeds)

    def test_controller_claim_blocks_duplicates_and_allows_failed_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = pathlib.Path(directory) / "ledger.json"
            with patch.object(launcher, "LEDGER_PATH", ledger):
                launcher.reserve_cost("run", 1.0, False, {"a": 1})
                self.assertTrue(launcher.claim_controller("run", 60))
                self.assertFalse(launcher.claim_controller("run", 60))
                launcher.update_run_status("run", "reserved")
                self.assertTrue(launcher.claim_controller("run", 60))

    def test_atomic_write_keeps_the_previous_checkpoint_when_rename_is_interrupted(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "checkpoint.json"
            launcher._atomic_json(target, {"complete": True})
            with patch.object(launcher.os, "replace", side_effect=OSError("interrupted")):
                with self.assertRaises(OSError):
                    launcher._atomic_json(target, {"complete": False})
            self.assertEqual(json.loads(target.read_text()), {"complete": True})

    def test_result_validation_rejects_partial_corrupt_and_stale_checkpoints(self):
        spec = {"run_id": "run", "kingdom": launcher.DEFAULT_ORDERED_PRODUCT_KINGDOM,
                "shard_id": 1, "start_position": 10, "end_position": 20,
                "rule_fingerprint": "rules", "build_version": "build",
                "shuffle_seeds": [4_100_000], "cpu": 1, "threads": 1}
        result = {"schemaVersion": 1, "status": "success", "runId": "run",
                  "kingdomId": launcher.DEFAULT_ORDERED_PRODUCT_KINGDOM, "shardId": 1,
                  "startPosition": 10, "endPosition": 20, "completeCount": 10,
                  "candidateDigest": "123456789", "scoreDigest": "abcdefabc",
                  "ruleFingerprint": "rules", "scorerVersion": launcher.SCORER_VERSION,
                  "buildVersion": "build", "shuffleSeeds": [4_100_000],
                  "movementProfiles": ["stationary", "chaser", "kiter"],
                  "requestedCpu": 1, "threads": 1}
        result["resultHash"] = launcher._result_hash(result)
        self.assertTrue(launcher.valid_result(result, spec))
        self.assertFalse(launcher.valid_result({**result, "completeCount": 9}, spec))
        self.assertFalse(launcher.valid_result({**result, "buildVersion": "stale"}, spec))
        self.assertFalse(launcher.valid_result({**result, "resultHash": "corrupt"}, spec))
        mutations = {"kingdomId": "deep-beam-tuning-001", "shuffleSeeds": [9],
                     "movementProfiles": ["stationary"], "requestedCpu": 2, "threads": 2}
        for key, mutation in mutations.items():
            changed = {**result, key: mutation}
            changed["resultHash"] = launcher._result_hash(changed)
            self.assertFalse(launcher.valid_result(changed, spec), key)


if __name__ == "__main__":
    unittest.main()
