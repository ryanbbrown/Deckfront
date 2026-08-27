import hashlib
import inspect
import json
import os
import pathlib
import struct
import subprocess
import tempfile
import unittest
import sys
from unittest.mock import patch

import native_strategy_search as launcher
import strategy_search_runtime as runtime_launcher
import strategy_search_status as status_launcher


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

    def test_subprocess_failure_exposes_only_the_bounded_stderr_tail(self):
        failure = subprocess.CalledProcessError(1, ["command"], stderr="x" * (128 * 1024) + "exact-tail")
        with patch.object(launcher.subprocess, "run", side_effect=failure):
            with self.assertRaises(RuntimeError) as raised:
                launcher._run_checked(["command"], "stage-two checkpoint", text=True, capture_output=True)
        message = str(raised.exception)
        self.assertIn("stderr tail", message)
        self.assertTrue(message.endswith("exact-tail"))
        self.assertLess(len(message), 66 * 1024)

    def test_stage_two_requests_the_streaming_rust_score_protocol(self):
        with tempfile.TemporaryDirectory() as directory:
            request = pathlib.Path(directory) / "request.json"
            response = pathlib.Path(directory) / "response.ndjson"
            request.write_text("{}\n")
            with patch.object(launcher.subprocess, "run",
                    return_value=subprocess.CompletedProcess([], 0, "", "")) as run:
                launcher._run_rust(request, response, 4, 4, 60, stream_scores=True)
            command = run.call_args.args[0]
            self.assertIn("--stream-score-batch", command)
            self.assertEqual(run.call_args.kwargs["stdout"].name, str(response))

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


    def test_strategy_search_image_uses_the_exact_committed_allowlist(self):
        source = inspect.getsource(launcher)
        self.assertIn("strategy-search-image-files.json", source)
        self.assertNotIn("image.add_local_file", source)
        self.assertEqual(source.count("image.add_local_dir"), 3)
        layered = launcher._NODE_DEPENDENCY_FILES | launcher._RUST_IMAGE_FILES \
            | launcher._APPLICATION_IMAGE_FILES
        self.assertEqual(layered, set(launcher._SOURCE_IMAGE_FILES))
        self.assertFalse(launcher._ignore_image_paths_except({"src/sim/file.ts"})(
            launcher.PROJECT_ROOT / "src"))
        self.assertFalse(launcher._ignore_image_paths_except({"src/sim/file.ts"})(
            launcher.PROJECT_ROOT / "src/sim/file.ts"))
        self.assertTrue(launcher._ignore_image_paths_except({"src/sim/file.ts"})(
            launcher.PROJECT_ROOT / "src/other.ts"))
        campaign_source = inspect.getsource(launcher.verify_strategy_search_source)
        self.assertIn("_strategy_search_source_digest", campaign_source)

    def test_deployed_container_layout_imports_and_runs_readiness_from_workspace(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            container_module = root / "root" / "native_strategy_search.py"
            workspace = root / "workspace"
            container_module.parent.mkdir()
            container_module.write_bytes(pathlib.Path(launcher.__file__).read_bytes())
            allowlist = json.loads(pathlib.Path("strategy-search-image-files.json").read_text())
            for relative in allowlist:
                target = workspace / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                if relative == "strategy-search-image-files.json":
                    target.write_bytes(pathlib.Path(relative).read_bytes())
                elif relative == "modal/native_strategy_search.py":
                    target.write_bytes(container_module.read_bytes())
                else:
                    target.write_text(f"container fixture: {relative}\n")
            script = """
import hashlib, json, modal, runpy
modal.is_local = lambda: False
namespace = runpy.run_path(%r)
root = namespace["RUNTIME_WORKSPACE_ROOT"]
paths = namespace["_SOURCE_IMAGE_FILES"]
files = []
for relative in sorted(paths):
    content = (root / relative).read_bytes()
    files.append({"path": relative, "bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest()})
lines = "".join(f"{entry['path']}\\0{entry['bytes']}\\0{entry['sha256']}\\n" for entry in files)
identity = {"digest": hashlib.sha256(lines.encode()).hexdigest(), "files": files}
result = namespace["strategy_search_compute_ready"].get_raw_f()(identity)
print(json.dumps(result))
""" % str(container_module)
            completed = subprocess.run([sys.executable, "-c", script], text=True, capture_output=True,
                env={**os.environ, "HEXDECK_STRATEGY_WORKSPACE": str(workspace)}, timeout=30)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertTrue(json.loads(completed.stdout.splitlines()[-1])["ready"])

    def test_strategy_search_execution_reuses_pinned_partitions_when_capacity_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            state_file = root / "state.json"
            def execution_file(_execution_id):
                return state_file
            state_file.write_text(json.dumps({"schemaVersion": 2, "campaignExecutionId": "a" * 64,
                "orderedEvidenceIds": ["b" * 64], "partitions": {"one": [1]},
                "jobs": [{"taskId": "old"}], "tasks": [{"taskId": "old"}],
                "maxActiveCpus": 400, "admissionLimitCpus": 400, "revision": 0,
                "computePreflight": {"sourceDigest": "c" * 64}}))
            request = {"operation": "execution-init", "campaignExecutionId": "a" * 64,
                "orderedEvidenceIds": ["b" * 64], "partitions": {"different": [2]},
                "jobs": [{"taskId": "new"}], "tasks": [{"taskId": "new"}], "maxActiveCpus": 800,
                "sourceDigest": "c" * 64}
            with patch.object(launcher, "_strategy_search_execution_file", execution_file), \
                    patch.object(launcher.volume, "reload"), patch.object(launcher.volume, "commit"):
                raw = launcher.strategy_search_publisher.get_raw_f()
                changed = raw(request)
                with self.assertRaisesRegex(RuntimeError, "compute identity"):
                    raw({**request, "sourceDigest": "d" * 64})
            self.assertEqual(changed["partitions"], {"one": [1]})
            self.assertEqual(changed["jobs"], [{"taskId": "old"}])
            self.assertEqual(changed["maxActiveCpus"], 800)

    def test_strategy_search_controller_startup_is_accepted_only_after_fenced_useful_work(self):
        with tempfile.TemporaryDirectory() as directory:
            state_file = pathlib.Path(directory) / "state.json"
            state = {"schemaVersion": 2, "campaignExecutionId": "a" * 64,
                "orderedEvidenceIds": ["b" * 64], "partitions": {}, "tasks": [],
                "jobs": [{"taskId": "task", "stage": "goldfish-one", "status": "active",
                    "cpu": 4}], "maxActiveCpus": 400, "revision": 1, "controllerFence": 1,
                "controller": {"ownerId": "owner", "fence": 1, "leaseUntilMs": 1000},
                "status": "running", "report": None, "startedMs": 100,
                "usefulWorkStartedMs": None}
            state_file.write_text(json.dumps(state))
            with patch.object(launcher, "_strategy_search_execution_file", return_value=state_file), \
                    patch.object(launcher.volume, "reload"), patch.object(launcher.volume, "commit"):
                saved = launcher.strategy_search_publisher.get_raw_f()({"operation": "execution-save",
                    "campaignExecutionId": "a" * 64, "fence": 1, "ownerId": "owner",
                    "nowMs": 200, "leaseMs": 100, "state": state})
            self.assertEqual(saved["usefulWorkStartedMs"], 200)
            with patch.object(runtime_launcher, "_execution_file", return_value=state_file), \
                    patch.object(runtime_launcher.volume, "reload"):
                progress = runtime_launcher.read_startup.get_raw_f()("a" * 64)
            self.assertTrue(progress["usefulWorkStarted"])
            self.assertEqual(progress["activeTaskCount"], 1)
            self.assertEqual(progress["activeCpus"], 4)

    def test_strategy_search_controller_requires_verified_preflight_state(self):
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(launcher, "_strategy_search_execution_file",
                    return_value=pathlib.Path(directory) / "missing.json"), \
                patch.object(launcher.volume, "reload"):
            with self.assertRaisesRegex(RuntimeError, "verified compute preflight"):
                launcher.strategy_search_publisher.get_raw_f()({"operation": "execution-init",
                    "campaignExecutionId": "a" * 64, "orderedEvidenceIds": ["b" * 64],
                    "partitions": {}, "jobs": [], "tasks": [], "maxActiveCpus": 400,
                    "sourceDigest": "c" * 64})

    def test_strategy_search_publisher_batches_exact_bytes_and_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            evidence, execution_id = "b" * 64, "a" * 64
            state_file, execution_file = root / "publication.json", root / "execution.json"
            execution_file.write_text(json.dumps({"controller": {"ownerId": "owner", "fence": 1, "leaseUntilMs": 100}}))
            paths = {}
            def held_path(relative):
                return paths.setdefault(relative, root / relative.replace("/", "_"))
            raw = launcher.strategy_search_publisher.get_raw_f()
            controller = {"campaignExecutionId": execution_id, "controllerOwnerId": "owner", "controllerFence": 1}
            common = {"evidenceId": evidence, "taskId": "task", "ownerId": "owner", **controller}
            with patch.object(launcher, "_strategy_search_evidence_state", return_value=state_file), \
                    patch.object(launcher, "_strategy_search_execution_file", return_value=execution_file), \
                    patch.object(launcher, "_strategy_search_path", side_effect=held_path), \
                    patch.object(launcher, "_strategy_search_validate_publication"), \
                    patch.object(launcher.volume, "reload"), patch.object(launcher.volume, "commit") as commit:
                lease = raw({"operation": "claim", **common, "nowMs": 0, "leaseMs": 100})
                raw({"operation": "intent", **common, "fence": lease["fence"], "launchId": "launch",
                    "artifactPath": "evidence/final", "temporaryPath": "temporary/launch", "nowMs": 1})
                temporary = held_path("temporary/launch")
                temporary.write_bytes(b"scientific")
                digest = hashlib.sha256(b"scientific").hexdigest()
                publication = {"evidenceId": evidence, "taskId": "task", "fence": lease["fence"],
                    "launchId": "launch", "sha256": digest, "stage": "goldfish-one",
                    "range": {"start": 0, "end": 1}, **controller}
                result = raw({"operation": "publish-batch", "nowMs": 1, "publications": [publication]})
                self.assertEqual(result["receipts"]["task"]["sha256"], digest)
                self.assertEqual(held_path("evidence/final").read_bytes(), b"scientific")
                self.assertGreaterEqual(commit.call_count, 4)
                held_path("temporary/launch").write_bytes(b"conflict")
                with self.assertRaisesRegex(RuntimeError, "receipt conflicts"):
                    raw({"operation": "publish-batch", "nowMs": 2, "publications": [
                        {**publication, "sha256": hashlib.sha256(b"conflict").hexdigest()}]})

    def test_strategy_search_shared_lease_joins_receipt_and_refences_takeover(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            evidence, first_execution, second_execution = "b" * 64, "a" * 64, "c" * 64
            state_file = root / "publication.json"
            execution_files = {first_execution: root / "first.json", second_execution: root / "second.json"}
            execution_files[first_execution].write_text(json.dumps({"controller": {"ownerId": "one", "fence": 1, "leaseUntilMs": 100}}))
            execution_files[second_execution].write_text(json.dumps({"controller": {"ownerId": "two", "fence": 1, "leaseUntilMs": 100}}))
            artifact = root / "artifact"
            raw = launcher.strategy_search_publisher.get_raw_f()
            def execution_file(execution_id):
                return execution_files[execution_id]
            def held_path(relative):
                return artifact if relative == "evidence/final" else root / relative.replace("/", "_")
            first = {"campaignExecutionId": first_execution, "controllerOwnerId": "one", "controllerFence": 1}
            second = {"campaignExecutionId": second_execution, "controllerOwnerId": "two", "controllerFence": 1}
            with patch.object(launcher, "_strategy_search_evidence_state", return_value=state_file), \
                    patch.object(launcher, "_strategy_search_execution_file", side_effect=execution_file), \
                    patch.object(launcher, "_strategy_search_path", side_effect=held_path), \
                    patch.object(launcher.volume, "reload"), patch.object(launcher.volume, "commit"):
                lease = raw({"operation": "claim", "evidenceId": evidence, "taskId": "task", "ownerId": "one",
                    "nowMs": 0, "leaseMs": 100, **first})
                busy = raw({"operation": "claim", "evidenceId": evidence, "taskId": "task", "ownerId": "two",
                    "nowMs": 1, "leaseMs": 100, **second})
                self.assertTrue(busy["busy"])
                execution_files[first_execution].write_text(json.dumps({"controller": {"ownerId": "new", "fence": 2, "leaseUntilMs": 100}}))
                taken = raw({"operation": "claim", "evidenceId": evidence, "taskId": "task", "ownerId": "two",
                    "nowMs": 2, "leaseMs": 100, **second})
                self.assertEqual(taken["fence"], lease["fence"] + 1)
                with self.assertRaisesRegex(RuntimeError, "fenced"):
                    raw({"operation": "heartbeat", "evidenceId": evidence, "taskId": "task", "ownerId": "one",
                        "fence": lease["fence"], "nowMs": 3, "leaseMs": 100, **first})
                digest = hashlib.sha256(b"done").hexdigest()
                artifact.write_bytes(b"done")
                state = json.loads(state_file.read_text())
                state["receipts"]["task"] = {"taskId": "task", "evidenceId": evidence,
                    "artifactPath": "evidence/final", "sha256": digest, "fence": taken["fence"]}
                state_file.write_text(json.dumps(state))
                joined = raw({"operation": "claim", "evidenceId": evidence, "taskId": "task", "ownerId": "two",
                    "nowMs": 4, "leaseMs": 100, **second})
                self.assertTrue(joined["complete"])

    def test_strategy_search_compact_validator_checks_semantic_coverage_and_checksum(self):
        with tempfile.TemporaryDirectory() as directory:
            file = pathlib.Path(directory) / "job.hgs"
            metrics = [1, 1, 30, 10, 5] * 3
            record = struct.pack(">I15I", 7, *metrics) + "sg-0000000007".encode("utf-16-be") + bytes(6)
            digest = hashlib.sha256(record).hexdigest()
            header = {"schemaVersion": 1, "magic": "HGS1", "stage": "stage-one", "evidenceId": "b" * 64,
                "semanticStart": 7, "semanticEnd": 8, "recordCount": 1, "recordBytes": 96,
                "payloadSha256": digest}
            encoded = json.dumps(header, separators=(",", ":")).encode()
            file.write_bytes(b"HGS1" + struct.pack(">I", len(encoded)) + encoded
                + bytes(512 - 8 - len(encoded)) + record)
            publication = {"stage": "goldfish-one", "evidenceId": "b" * 64,
                "range": {"start": 7, "end": 8}}
            launcher._strategy_search_validate_compact(publication, file)
            changed = bytearray(file.read_bytes())
            changed[-1] = 1
            file.write_bytes(changed)
            with self.assertRaisesRegex(RuntimeError, "padding differs"):
                launcher._strategy_search_validate_compact(publication, file)

    def test_strategy_search_status_uses_only_its_bounded_control_app(self):
        status_source = inspect.getsource(status_launcher)
        self.assertNotIn("native_strategy_search", status_source)
        self.assertNotIn("strategy_search_publisher", status_source)
        self.assertNotIn("run_commands", status_source)
        self.assertIn("@app.function(image=control_image, cpu=0.25, memory=512, timeout=30", status_source)
        compute_source = inspect.getsource(launcher)
        self.assertNotIn("strategy_search_status_entry", compute_source)
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(status_launcher, "_execution_file",
                    return_value=pathlib.Path(directory) / "state.json"), \
                patch.object(status_launcher.volume, "reload"), \
                patch.object(status_launcher.volume, "commit"):
            raw = status_launcher.read_status.get_raw_f()
            missing = raw("a" * 64)
            self.assertEqual(missing["phase"], "missing")
            pathlib.Path(directory, "compute-preflight.json").write_text(json.dumps({
                "phase": "image-preparing", "operatorStartedMs": 1, "computeAppName": "compute",
                "sourceDigest": "b" * 64}))
            preparing = raw("a" * 64)
            self.assertEqual(preparing["status"], "preparing")
            self.assertEqual(preparing["phase"], "image-preparing")
            status_launcher.fail_compute_preflight.get_raw_f()(
                "a" * 64, "b" * 64, "compute", "FileNotFoundError: /strategy-search-image-files.json")
            failed = raw("a" * 64)
            self.assertEqual(failed["status"], "failed")
            self.assertEqual(failed["phase"], "startup-failed")
            self.assertIn("FileNotFoundError", failed["failure"])
            state_file = pathlib.Path(directory, "state.json")
            state_file.write_text(json.dumps({"status": "ready", "report": None, "jobs": []}))
            starting = raw("a" * 64)
            self.assertEqual(starting["status"], "starting")
            self.assertEqual(starting["phase"], "controller-starting")
            state_file.write_text(json.dumps({"status": "running", "report": None,
                "usefulWorkStartedMs": 2, "controllerFence": 1,
                "jobs": [{"stage": "goldfish-one", "status": "active", "cpu": 4}]}))
            running = raw("a" * 64)
            self.assertEqual(running["phase"], "controller-running")
            self.assertEqual(running["activeTaskCount"], 1)
            self.assertEqual(running["activeCpus"], 4)

    def test_strategy_search_run_prepares_state_only_after_verified_compute_deployment(self):
        bundle = {"schemaVersion": 2, "campaignExecutionId": "a" * 64,
            "executionRoot": "executions/" + "a" * 64,
            "request": {"kingdomIds": ["kingdom"], "maxActiveCpus": 400},
            "sourceImage": {"digest": "b" * 64, "files": []}, "partitions": {"one": []},
            "jobs": [{"taskId": "task", "status": "ready"}],
            "tasks": [{"taskId": "task", "stage": "psro", "evidenceId": "c" * 64}],
            "controller": {"timeoutSeconds": 1140}}
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(status_launcher, "_execution_file",
                    return_value=pathlib.Path(directory) / "state.json"), \
                patch.object(status_launcher.volume, "reload"), \
                patch.object(status_launcher.volume, "commit") as commit:
            compute_app = "hexdeck-strategy-" + "b" * 24
            begun = status_launcher.begin_compute_preflight.get_raw_f()(
                "a" * 64, "b" * 64, compute_app)
            self.assertEqual(begun["phase"], "image-preparing")
            self.assertFalse(pathlib.Path(directory, "state.json").exists())
            self.assertEqual(json.loads(pathlib.Path(directory,
                "compute-preflight.json").read_text())["computeAppName"], compute_app)
            raw = status_launcher.prepare_execution.get_raw_f()
            preflight = {"ready": True, "sourceDigest": "b" * 64, "readyMs": 10,
                "computeAppName": compute_app, "preflightElapsedMs": 20.0}
            first = raw(bundle, preflight)
            self.assertTrue(first["prepared"])
            state = json.loads(pathlib.Path(directory, "state.json").read_text())
            self.assertEqual(state["status"], "ready")
            self.assertEqual(state["orderedEvidenceIds"], ["c" * 64])
            self.assertEqual(state["computePreflight"], preflight)
            changed = {**bundle, "partitions": {"different": []},
                "jobs": [{"taskId": "different"}]}
            self.assertFalse(raw(changed, preflight)["prepared"])
            self.assertEqual(json.loads(pathlib.Path(directory, "state.json").read_text())["jobs"],
                [{"taskId": "task", "status": "ready"}])
            self.assertEqual(commit.call_count, 2)

    def test_strategy_search_campaign_has_no_legacy_recovery_or_budget_gate(self):
        controller_source = inspect.getsource(launcher.strategy_search_controller.get_raw_f())
        self.assertNotIn("GROSS_BUDGET_USD", controller_source)
        self.assertNotIn("MAX_FULL_RUNS", controller_source)
        module_source = inspect.getsource(launcher)
        runtime_source = inspect.getsource(runtime_launcher)
        self.assertIn("strategy_search_compute_ready", module_source)
        self.assertNotIn("strategy_search_run_entry", module_source)
        self.assertIn('Function.from_name(compute_app_name, "strategy_search_controller")', runtime_source)
        self.assertIn("strategy-search-useful-work-started", runtime_source)
        self.assertIn("_NODE_DEPENDENCY_FILES", module_source)
        self.assertIn("_RUST_IMAGE_FILES", module_source)
        self.assertIn("_APPLICATION_IMAGE_FILES", module_source)
        self.assertEqual(module_source.count("image.add_local_dir"), 3)
        self.assertNotIn("image.add_local_file", module_source)
        self.assertIn('from_registry("rust:1.98.0-slim-bookworm"', module_source)
        self.assertNotIn("rustup toolchain install", module_source)
        self.assertLess(module_source.index('npm ci'), module_source.index(
            'ignore=_ignore_image_paths_except(_APPLICATION_IMAGE_FILES)'))
        for removed in ["campaign_recover_entry", "campaign_source_repair", "resume-plan"]:
            self.assertNotIn(removed, module_source)


if __name__ == "__main__":
    unittest.main()
