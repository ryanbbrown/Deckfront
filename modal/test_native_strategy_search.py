import hashlib
import inspect
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

    def test_competitive_launch_identity_is_stable_for_restart(self):
        value = {"schemaVersion": 1, "candidateCount": 1, "lookId": "screen-8",
            "loadRequest": {"type": "load_competitive", "payload": {
                "protocolVersion": 1, "scorerVersion": launcher.COMPETITIVE_SCORER_VERSION,
                "startingDraftEnabled": False, "strategies": [{"id": "candidate"}],
                "threads": 4, "cpuRequest": 4, "ruleFingerprint": "rules"}},
            "schedule": [{"seed": 1, "opponentIndex": 0}]}
        value["inputHash"] = launcher._competitive_input_hash(value)
        content = json.dumps(value)
        first = launcher._competitive_launch_data(content, "build", 4, 4, 4, 16, 180, 2, 65_536)
        second = launcher._competitive_launch_data(content, "build", 4, 4, 4, 16, 180, 2, 65_536)
        self.assertEqual(first[2:], second[2:])
        self.assertTrue(first[3].startswith("competitive-build-"))

    def test_competitive_controller_resume_attaches_to_the_recorded_call(self):
        expected = object()
        entry = {"status": "launched", "controllerCallId": "fc-existing"}
        with patch.object(launcher.modal.FunctionCall, "from_id", return_value=expected) as attach, \
                patch.object(launcher, "claim_controller") as claim:
            held = launcher._competitive_controller_call(
                {"run_id": "run", "controller_timeout": 60}, entry)
        self.assertIs(held, expected)
        attach.assert_called_once_with("fc-existing")
        claim.assert_not_called()

    def test_competitive_download_replaces_output_atomically(self):
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / "nested" / "complete.hps"
            with patch.object(launcher.volume, "read_file", return_value=iter([b"HPS1", b"payload"])):
                launcher._download_competitive_artifact("remote/complete.hps", output)
            self.assertEqual(output.read_bytes(), b"HPS1payload")

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

    def test_corrupt_campaign_evidence_is_preserved_by_hash_before_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); source = root / "stage" / "shard.json"
            source.parent.mkdir(); source.write_text("corrupt raw evidence")
            destination = launcher._preserve_corrupt_file(source, root / "control")
            self.assertFalse(source.exists()); self.assertTrue(destination.exists())
            self.assertEqual(destination.read_text(), "corrupt raw evidence")
            self.assertIn(hashlib.sha256(b"corrupt raw evidence").hexdigest(), destination.name)

    def test_campaign_source_identity_recomputes_exact_image_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / "src").mkdir(); (root / "src" / "a.ts").write_text("export {}\n")
            content = (root / "src" / "a.ts").read_bytes()
            files = [{"path": "src/a.ts", "bytes": len(content),
                      "sha256": hashlib.sha256(content).hexdigest()}]
            digest = hashlib.sha256(
                f"src/a.ts\0{len(content)}\0{files[0]['sha256']}\n".encode()).hexdigest()
            self.assertEqual(launcher._campaign_source_digest(files, root), digest)
            files[0]["bytes"] += 1
            with self.assertRaisesRegex(RuntimeError, "source-image file differs"):
                launcher._campaign_source_digest(files, root)

    def test_whole_stage_keeps_one_process_and_commits_each_checkpoint_event(self):
        class HeldVolume:
            def __init__(self): self.commits = 0
            def commit(self): self.commits += 1
        class Pipe:
            def __init__(self, lines): self.lines = lines
            def __iter__(self): return iter(self.lines)
            def read(self): return ""
        class Process:
            def __init__(self):
                self.stdout = Pipe([json.dumps({"type": launcher.CAMPAIGN_CHECKPOINT_EVENT,
                    "stage": "matrix", "eventHash": "a" * 64}) + "\n",
                    json.dumps({"type": launcher.CAMPAIGN_STAGE_STOP_EVENT,
                    "stage": "matrix", "status": "complete", "markerHash": "b" * 64}) + "\n"])
                self.stderr = Pipe([]); self.terminated = False
            def wait(self): return 0
            def terminate(self): self.terminated = True
        held_volume = HeldVolume(); process = Process()
        marker = tempfile.NamedTemporaryFile("w", delete=False)
        json.dump({"status": "complete", "markerHash": "b" * 64,
                   "artifactHashes": {"output/file.json": "d" * 64}}, marker); marker.close()
        config = {"stage": "matrix", "controller_fence": 2, "source_image": {},
            "timeout_seconds": 30, "shutdown_margin_seconds": 5, "campaign_root": "campaign/root",
            "manifest_path": "matrix/manifest.json", "output_path": "matrix/output",
            "control_path": "matrix/control", "threads": 4, "worker_batch_size": 4,
            "stage_id": "c" * 64}
        with patch.object(launcher, "volume", held_volume), \
                patch.object(launcher, "verify_campaign_source_image"), \
                patch.object(launcher, "_campaign_stage_command", return_value=["trusted"]), \
                patch.object(launcher, "_campaign_path", return_value=pathlib.Path(marker.name)), \
                patch.object(launcher, "_reject_campaign_symlinks"), \
                patch.object(launcher.subprocess, "Popen", return_value=process) as spawn:
            result = launcher._run_campaign_stage("matrix", config)
        pathlib.Path(marker.name).unlink()
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["checkpointCommits"], 1)
        self.assertEqual(held_volume.commits, 2)
        spawn.assert_called_once()
        self.assertIsNone(spawn.call_args.kwargs["env"])

    def test_campaign_goldfish_completion_hashes_sidecars_and_uses_stage_timeout(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            ranked, reservoir = root / "ranked.json", root / "reservoir.json"
            ranked.write_text('{"parts":[]}\n'); reservoir.write_text('{"entries":[]}\n')
            ranked_digest = hashlib.sha256(ranked.read_bytes()).hexdigest()
            reservoir_digest = hashlib.sha256(reservoir.read_bytes()).hexdigest()
            ranked.with_suffix(".json.sha256").write_text(f"{ranked_digest}  ranked.json\n")
            reservoir.with_suffix(".json.sha256").write_text(f"{reservoir_digest}  reservoir.json\n")
            hashes = launcher._campaign_goldfish_complete_hashes(ranked, reservoir, {"parts": []})
            self.assertEqual(hashes["output/ranked.json"], ranked_digest)
            self.assertEqual(hashes["output/ranked.json.sha256"], hashlib.sha256(
                ranked.with_suffix(".json.sha256").read_bytes()).hexdigest())
            ranked.with_suffix(".json.sha256").write_text(f"{'0' * 64}  ranked.json\n")
            with self.assertRaisesRegex(RuntimeError, "sidecar differs"):
                launcher._campaign_goldfish_complete_hashes(ranked, reservoir, {"parts": []})
        source = inspect.getsource(launcher.campaign_goldfish_finalize.get_raw_f())
        self.assertIn('timeout=config["timeout_seconds"]', source)
        self.assertNotIn("timeout=300", source)

    def test_campaign_psro_uses_the_built_resident_rust_binary(self):
        class Pipe:
            def __init__(self, lines): self.lines = lines
            def __iter__(self): return iter(self.lines)
            def read(self): return ""
        class Process:
            def __init__(self):
                self.stdout = Pipe([json.dumps({"type": launcher.CAMPAIGN_STAGE_STOP_EVENT,
                    "stage": "psro", "status": "incomplete", "markerHash": "b" * 64}) + "\n"])
                self.stderr = Pipe([])
            def wait(self): return 2
            def terminate(self): pass
        marker = tempfile.NamedTemporaryFile("w", delete=False)
        json.dump({"status": "incomplete", "markerHash": "b" * 64,
                   "reason": "shutdown margin", "artifactHashes": {"output/protocol.json": "d" * 64}}, marker)
        marker.close()
        config = {"stage": "psro", "controller_fence": 2, "source_image": {},
            "timeout_seconds": 30, "shutdown_margin_seconds": 5, "campaign_root": "campaign/root",
            "stage_config_path": "kingdom/psro/config.json", "control_path": "kingdom/psro/control",
            "stage_id": "c" * 64}
        command = launcher._campaign_stage_command("psro", config, 123)
        self.assertEqual(command[:3], ["npx", "tsx", "scripts/strategy_search_campaign_psro.ts"])
        with patch.object(launcher, "verify_campaign_source_image"), \
                patch.object(launcher, "_campaign_stage_command", return_value=command), \
                patch.object(launcher, "_campaign_path", return_value=pathlib.Path(marker.name)), \
                patch.object(launcher, "_reject_campaign_symlinks"), \
                patch.object(launcher.volume, "commit"), \
                patch.object(launcher.subprocess, "Popen", return_value=Process()) as spawn:
            result = launcher._run_campaign_stage("psro", config)
        pathlib.Path(marker.name).unlink()
        self.assertEqual(result["reason"], "shutdown margin")
        self.assertEqual(spawn.call_args.kwargs["env"]["HEXDECK_GOLDFISH_BIN"],
            "/workspace/rust/target/x86_64-unknown-linux-gnu/release/hexdeck-goldfish")

    def test_campaign_call_observation_reattaches_and_isolates_failures(self):
        class Call:
            def __init__(self, result=None, error=None): self.result, self.error = result, error
            def get(self, timeout):
                if self.error: raise self.error
                return self.result
        calls = {"call-ok": Call({"status": "complete"}), "call-bad": Call(error=RuntimeError("failed"))}
        checkpoint = {"tasks": [
            {"taskId": "ok", "status": "active", "callId": "call-ok"},
            {"taskId": "bad", "status": "active", "callId": "call-bad"}]}
        configs = {"ok": {"stage": "matrix"}, "bad": {"stage": "psro"}}
        validated = {"status": "complete", "artifactPaths": ["output/file.json"],
                     "artifactHashes": {"output/file.json": "a" * 64}}
        with patch.object(launcher.modal.FunctionCall, "from_id", side_effect=lambda call_id: calls[call_id]), \
                patch.object(launcher.volume, "reload"), \
                patch.object(launcher, "_deep_validate_campaign_result", return_value=validated):
            observations = launcher._campaign_call_observations(checkpoint, "campaign/root", configs)
        self.assertEqual(observations[0], {"callId": "call-ok", "state": "succeeded",
            "artifactStatus": "complete", "reason": None, "artifactPaths": ["output/file.json"],
            "artifactHashes": {"output/file.json": "a" * 64}})
        self.assertEqual(observations[1]["state"], "failed")
        self.assertIn("RuntimeError", observations[1]["reason"])

    def test_controller_launch_reservation_allows_one_spawn_and_binds_one_call(self):
        class HeldVolume:
            def reload(self): pass
            def commit(self): pass
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(launcher, "volume", HeldVolume()), \
                patch.object(launcher, "_campaign_path",
                    return_value=pathlib.Path(directory) / "controller-call.json"):
            request = {"campaign_root": "campaign/root", "evidence_hash": "a" * 64,
                "operation": "reserve", "call_id": "", "owner_id": "owner-one"}
            first = launcher.campaign_controller_call_mutator.get_raw_f()(request)
            second = launcher.campaign_controller_call_mutator.get_raw_f()({**request, "owner_id": "owner-two"})
            self.assertEqual(first["controllerCall"], second["controllerCall"])
            self.assertIsNone(first["controllerCall"]["callId"])
            bound = launcher.campaign_controller_call_mutator.get_raw_f()({**request,
                "operation": "bind", "call_id": "fc-one"})
            self.assertEqual(bound["controllerCall"]["callId"], "fc-one")
            with self.assertRaisesRegex(RuntimeError, "stale or ambiguous"):
                launcher.campaign_controller_call_mutator.get_raw_f()({**request,
                    "operation": "bind", "call_id": "fc-two"})

    def test_launch_intent_is_durable_before_spawn_and_ambiguous_crash_is_not_bound(self):
        calls = []
        state = {"revision": 1}; checkpoint = {"revision": 2, "checkpointHash": "a" * 64}
        class Mutator:
            @staticmethod
            def remote(request):
                calls.append(request["operation"])
                return {"state": {"revision": 2},
                        "scheduler": {"revision": 3, "checkpointHash": "b" * 64}}
        class Function:
            def with_options(self, **_options): return self
            def spawn(self, _config): raise RuntimeError("crash after paid spawn boundary")
        entry = {"cpu": 4, "memory_mib": 4096, "timeout_seconds": 60,
                 "config": {"stage_key": "k:matrix"}}
        action = {"taskId": "matrix", "stage": "matrix"}
        with patch.object(launcher, "campaign_state_mutator", Mutator), \
                patch.object(launcher, "_campaign_function", return_value=Function()):
            with self.assertRaisesRegex(RuntimeError, "crash after"):
                launcher._durably_spawn_campaign_task(campaign_root="campaign/root", owner_id="owner",
                    fence=3, state=state, checkpoint=checkpoint, action=action, entry=entry,
                    source_image={})
        self.assertEqual(calls, ["launch-intent"])

    def test_saved_call_is_bound_under_the_same_fence_after_spawn(self):
        operations = []
        class Mutator:
            @staticmethod
            def remote(request):
                operations.append(request)
                revision = 2 if request["operation"] == "launch-intent" else 3
                return {"state": {"revision": revision},
                        "scheduler": {"revision": revision + 1, "checkpointHash": "b" * 64}}
        class Call: object_id = "fc-saved"
        class Function:
            def with_options(self, **_options): return self
            def spawn(self, _config): return Call()
        entry = {"cpu": 4, "memory_mib": 4096, "timeout_seconds": 60,
                 "config": {"stage_key": "k:matrix"}}
        with patch.object(launcher, "campaign_state_mutator", Mutator), \
                patch.object(launcher, "_campaign_function", return_value=Function()):
            launcher._durably_spawn_campaign_task(campaign_root="campaign/root", owner_id="owner",
                fence=3, state={"revision": 1}, checkpoint={"revision": 2, "checkpointHash": "a" * 64},
                action={"taskId": "matrix", "stage": "matrix"}, entry=entry, source_image={})
        self.assertEqual([request["operation"] for request in operations], ["launch-intent", "bind-call"])
        self.assertEqual(operations[1]["payload"]["callId"], "fc-saved")
        self.assertEqual(operations[1]["payload"]["fencingToken"], 3)

    def test_campaign_paths_and_task_resources_fail_closed_before_launch(self):
        for unsafe in ["../escape", "/absolute", "a/../../escape", "a\\b"]:
            with self.assertRaises(ValueError): launcher._campaign_path("campaign/root", unsafe)
        safe_run = "campaign/root/kingdom/goldfish"
        self.assertEqual(launcher._campaign_ordered_run_root("campaign/root", safe_run),
            pathlib.Path("/results/campaign/root/kingdom/goldfish"))
        safe_checkpoint = launcher._ordered_product_checkpoint_path({"campaign_root": "campaign/root",
            "run_id": safe_run}, "stage-one", 2)
        self.assertEqual(safe_checkpoint,
            pathlib.Path("/results/campaign/root/kingdom/goldfish/stage-one/shard-000002.json"))
        for unsafe_run in ["../escape", "/absolute", "other-campaign/run", "campaign/root/../../escape"]:
            with self.assertRaises(ValueError):
                launcher._campaign_ordered_run_root("campaign/root", unsafe_run)
        checkpoint = {"tasks": [{"taskId": "task", "kingdomId": "k", "stage": "matrix",
            "cpus": 4, "containers": 1}]}
        valid = {"task_id": "task", "kingdom_id": "k", "stage": "matrix", "cpu": 4,
            "memory_mib": 4096, "timeout_seconds": 60, "stage_terminal": True,
            "config": {}, "validation": {}}
        self.assertEqual(launcher._validate_campaign_task_configs(checkpoint, [valid])["task"], valid)
        with self.assertRaisesRegex(ValueError, "differs"):
            launcher._validate_campaign_task_configs(checkpoint, [{**valid, "cpu": 8}])
        goldfish_checkpoint = {"tasks": [{"taskId": "goldfish", "kingdomId": "k", "stage": "goldfish",
            "cpus": 4, "containers": 1}]}
        unsafe_goldfish = {"task_id": "goldfish", "kingdom_id": "k", "stage": "goldfish", "cpu": 4,
            "memory_mib": 4096, "timeout_seconds": 60, "stage_terminal": False,
            "config": {"campaign_root": "campaign/root", "run_id": "outside/run",
                       "ordered_stage": "stage-one"}, "validation": {}}
        with self.assertRaisesRegex(ValueError, "escapes"):
            launcher._validate_campaign_task_configs(goldfish_checkpoint, [unsafe_goldfish])

    def test_terminal_psro_does_not_stop_unrelated_kingdom_work(self):
        terminal = {"taskId": "k1-psro", "status": "terminal-incomplete", "reason": "look cap",
            "artifactPaths": ["k1/look.json"], "artifactHashes": {"k1/look.json": "a" * 64}}
        ready = {"taskId": "k2-matrix", "status": "ready", "reason": None,
            "artifactPaths": [], "artifactHashes": {}}
        self.assertIsNone(launcher._terminal_campaign_outcome({"tasks": [terminal, ready]}))
        complete = {"taskId": "k2-psro", "status": "complete", "reason": None,
            "artifactPaths": ["k2/report.json"], "artifactHashes": {"k2/report.json": "b" * 64}}
        outcome = launcher._terminal_campaign_outcome({"tasks": [terminal, complete]})
        self.assertEqual(outcome["taskId"], "k1-psro")
        self.assertEqual(outcome["reason"], "look cap")

    def test_successful_incomplete_call_keeps_exact_marker_reason_and_hashes(self):
        class Call:
            def get(self, timeout): return {"status": "incomplete", "reason": "shutdown margin"}
        validated = {"status": "incomplete", "reason": "shutdown margin",
            "artifactPaths": ["output/chunk.json"],
            "artifactHashes": {"output/chunk.json": "a" * 64}}
        checkpoint = {"tasks": [{"taskId": "matrix", "status": "active", "callId": "fc"}]}
        with patch.object(launcher.modal.FunctionCall, "from_id", return_value=Call()), \
                patch.object(launcher.volume, "reload"), \
                patch.object(launcher, "_deep_validate_campaign_result", return_value=validated):
            observations = launcher._campaign_call_observations(checkpoint, "campaign/root",
                {"matrix": {"stage": "matrix"}})
        self.assertEqual(observations[0]["reason"], "shutdown margin")
        self.assertEqual(observations[0]["artifactHashes"], validated["artifactHashes"])

    def test_campaign_controller_has_no_cost_ledger_gate(self):
        source = inspect.getsource(launcher.campaign_controller.get_raw_f())
        for forbidden in ["reserve_cost", "LEDGER_PATH", "GROSS_BUDGET_USD", "max_cost_usd"]:
            self.assertNotIn(forbidden, source)
        self.assertIn('launch_actions[:config["dispatch_batch_size"]]', source)

    def test_campaign_status_is_bounded_and_read_only(self):
        source = inspect.getsource(launcher.campaign_read_status.get_raw_f())
        for forbidden in ["campaign_controller", "campaign_matrix_stage", "campaign_psro_stage",
                          "ordered_product_stage_one", "ordered_product_stage_two", ".spawn("]:
            self.assertNotIn(forbidden, source)
        self.assertIn("content-index.json", source)

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
