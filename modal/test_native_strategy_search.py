import copy
import hashlib
import inspect
import json
import os
import pathlib
import shutil
import struct
import subprocess
import tempfile
import time
import unittest
import sys
from unittest.mock import MagicMock, patch

import native_strategy_search as launcher
import strategy_search_runtime as runtime_launcher
import strategy_search_status as status_launcher
from modal.exception import FunctionTimeoutError


class NativeStrategySearchLauncherTest(unittest.TestCase):
    def goldfish_only_bundle(self):
        evidence_id = "a" * 64
        request = {"kingdomIds": ["balance-tuning-005"], "workerCores": 64,
            "maxActiveCpus": 64, "maxWallSeconds": 3600, "maxCostUsd": 100}
        task_counts = {"scoreOne": 1, "reduceOne": 1, "scoreTwo": 1,
            "reduceTwo": 1, "total": 4}
        cost = launcher._strategy_search_goldfish_worst_case_cost(request, task_counts)
        controller = {"route": launcher.GOLDFISH_MODAL_ROUTE, "maxActiveCpus": 64,
            "timeoutSeconds": 3600, "maxWallSeconds": 3600, "goldfishWorkerCores": 64,
            "goldfishScoreMemoryMiB": 4096, "goldfishScoreTimeoutSeconds": 180,
            "goldfishReducerCores": 4, "goldfishReduceMemoryMiB": 8192,
            "goldfishReduceOneTimeoutSeconds": 600, "goldfishReduceTwoTimeoutSeconds": 300,
            "executionPlanHash": "d" * 64, "costGuard": {
                "cpuUsdPerCoreSecond": 0.00003942,
                "memoryUsdPerGibSecond": 0.00000667, "attemptCount": 3,
                "hardMaximumCostUsd": 100, "requestedMaximumCostUsd": 100,
                "worstCaseModalComputeUsd": cost, "taskCounts": task_counts}}
        partitions = {
            f"{evidence_id}:goldfish-one": {"stage": "goldfish-one", "evidenceId": evidence_id,
                "total": 12_972_960, "jobs": [{"start": 0, "end": 12_972_960}]},
            f"{evidence_id}:goldfish-two": {"stage": "goldfish-two", "evidenceId": evidence_id,
                "total": 500_000, "jobs": [{"start": 0, "end": 500_000}]}}
        job = {"taskId": "task", "evidenceId": evidence_id, "kingdomId": "balance-tuning-005",
            "stage": "goldfish-one", "range": {"start": 0, "end": 12_972_960}}
        task = {**job, "cpu": 64, "memoryMiB": 4096, "timeoutSeconds": 180}
        return {"schemaVersion": 3, "campaignExecutionId": "b" * 64,
            "executionRoot": "executions/" + "b" * 64, "request": request,
            "sourceImage": {"digest": "c" * 64}, "partitions": partitions,
            "jobs": [job], "tasks": [task], "controller": controller}

    def test_worst_case_includes_all_retry_attempts(self):
        value = launcher.projected_cost_usd(2, 4, 4, 600, 2)
        expected = (2 * 3 * (630 / 3600) * (4 * 0.0473 + 4 * 0.008)
                    + (3 * 1 * 630 + 300) / 3600 * (0.0473 + 0.008))
        self.assertAlmostEqual(value, expected)

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
        self.assertIn("subprocess output tail", message)
        self.assertTrue(message.endswith("exact-tail"))
        self.assertLess(len(message), 66 * 1024)

    def test_artifact_validator_failure_exposes_captured_stdout_and_stderr(self):
        failure = subprocess.CalledProcessError(1, ["validator"], output="validation started\n",
                                                stderr="Unknown kingdom: deep-beam-tuning-007\n")
        publication = {"stage": "goldfish-one-reduce", "evidenceId": "b" * 64,
                       "kingdomId": "deep-beam-tuning-007"}
        with patch.object(launcher.subprocess, "run", side_effect=failure), \
                patch.object(launcher, "_strategy_search_path", return_value=pathlib.Path("/evidence")):
            with self.assertRaises(RuntimeError) as raised:
                launcher._strategy_search_validate_publication(publication, pathlib.Path("/temporary/top.hgf"))
        message = str(raised.exception)
        self.assertIn("[stdout]\nvalidation started", message)
        self.assertIn("[stderr]\nUnknown kingdom: deep-beam-tuning-007", message)

    def test_called_process_diagnostic_is_nonblank_and_includes_captured_output(self):
        failure = subprocess.CalledProcessError(1, ["validator"], output="", stderr="exact validator failure")
        diagnostic = launcher._strategy_search_exception_diagnostic(failure)
        self.assertIn("subprocess.CalledProcessError", diagnostic["error"])
        self.assertIn("exact validator failure", diagnostic["error"])

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


    def test_goldfish_only_cost_guard_uses_current_rates_and_fails_closed(self):
        bundle = self.goldfish_only_bundle()
        result = launcher._strategy_search_validate_goldfish_only_bundle(bundle)
        self.assertEqual(launcher.GOLDFISH_MODAL_CPU_RATE_PER_CORE_SECOND, 0.00003942)
        self.assertEqual(launcher.GOLDFISH_MODAL_MEMORY_RATE_PER_GIB_SECOND, 0.00000667)
        self.assertEqual(result["taskCounts"], {"scoreOne": 1, "reduceOne": 1,
            "scoreTwo": 1, "reduceTwo": 1, "total": 4})
        self.assertEqual(result["worstCaseModalComputeUsd"],
            bundle["controller"]["costGuard"]["worstCaseModalComputeUsd"])
        measured = launcher._strategy_search_attempt_cost({"modalWorkerElapsedMs": 1000,
            "submittedMs": 0, "cpu": 1, "memoryMiB": 1024}, 1000,
            launcher.GOLDFISH_MODAL_CPU_RATE_PER_CORE_SECOND * 3600,
            launcher.GOLDFISH_MODAL_MEMORY_RATE_PER_GIB_SECOND * 3600)
        self.assertAlmostEqual(measured["costUsd"], 0.00003942 + 0.00000667)
        mutations = []
        stale_rate = copy.deepcopy(bundle)
        stale_rate["controller"]["costGuard"]["cpuUsdPerCoreSecond"] = 0.00001314
        mutations.append(stale_rate)
        stale_cost = copy.deepcopy(bundle)
        stale_cost["controller"]["costGuard"]["worstCaseModalComputeUsd"] -= 0.01
        mutations.append(stale_cost)
        downstream = copy.deepcopy(bundle)
        downstream["tasks"][0]["stage"] = "matrix-score"
        mutations.append(downstream)
        excess_capacity = copy.deepcopy(bundle)
        excess_capacity["request"]["maxActiveCpus"] = 193
        excess_capacity["controller"]["maxActiveCpus"] = 193
        mutations.append(excess_capacity)
        for held in mutations:
            with self.assertRaises(ValueError):
                launcher._strategy_search_validate_goldfish_only_bundle(held)

    def test_goldfish_only_materialization_uses_requested_score_cores_and_fixed_reducer_shape(self):
        evidence = "a" * 64
        one = [{"start": 0, "end": 10}, {"start": 10, "end": 20}]
        state = {"maxActiveCpus": 64, "partitions": {
            f"{evidence}:goldfish-one": {"jobs": one},
            f"{evidence}:goldfish-two": {"jobs": [{"start": 0, "end": 10}]}
        }, "jobs": [{"taskId": launcher._strategy_search_goldfish_task_id(
                evidence, "goldfish-one", one[0]), "evidenceId": evidence,
            "kingdomId": "balance-tuning-005", "stage": "goldfish-one",
            "range": one[0], "cpus": 64, "status": "ready", "dependencyTaskIds": []}],
            "tasks": []}
        bundle = {"controller": {"readyWindowWaves": 2, "goldfishWorkerCores": 64,
            "goldfishScoreMemoryMiB": 4096, "goldfishScoreTimeoutSeconds": 180,
            "goldfishReducerCores": 4, "goldfishReduceMemoryMiB": 8192,
            "goldfishReduceOneTimeoutSeconds": 600, "goldfishReduceTwoTimeoutSeconds": 300}}
        self.assertTrue(launcher._strategy_search_materialize_goldfish(state, bundle))
        scores = [task for task in state["tasks"] if task["stage"] == "goldfish-one"]
        self.assertEqual(len(scores), 1)
        self.assertEqual((scores[0]["cpu"], scores[0]["timeoutSeconds"]), (64, 180))
        reducer = next(task for task in state["tasks"] if task["stage"] == "goldfish-one-reduce")
        self.assertEqual((reducer["cpu"], reducer["memoryMiB"], reducer["timeoutSeconds"]),
            (4, 8192, 600))
        self.assertFalse(any(task["stage"].startswith("matrix") or task["stage"].startswith("psro")
            for task in state["tasks"]))

    def test_goldfish_only_completion_records_only_verified_final_goldfish_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            evidence = "a" * 64
            state_file = root / "publication.json"
            paths = {}
            receipts = {}
            task_ids = {stage: f"task-{stage}" for stage in
                ["goldfish-one-reduce", "goldfish-two-reduce"]}
            for stage, task_id in task_ids.items():
                artifact = root / f"{stage}.hgf"
                artifact.write_bytes(stage.encode())
                relative = f"evidence/{evidence}/{stage}.hgf"
                paths[relative] = artifact
                receipts[task_id] = {"taskId": task_id, "evidenceId": evidence,
                    "artifactPath": relative,
                    "sha256": hashlib.sha256(stage.encode()).hexdigest(), "fence": 1}
            state_file.write_text(json.dumps({"schemaVersion": 1, "evidenceId": evidence,
                "leases": {}, "intents": {}, "receipts": receipts}))
            with patch.object(launcher, "_strategy_search_evidence_state", return_value=state_file), \
                    patch.object(launcher, "_strategy_search_path", side_effect=lambda relative: paths[relative]), \
                    patch.object(launcher.volume, "reload"), patch.object(launcher.volume, "commit"):
                raw = launcher.strategy_search_publisher.get_raw_f()
                completion = raw({"operation": "goldfish-evidence-finalize", "evidenceId": evidence,
                    "taskIds": task_ids, "nowMs": 10})
                reusable = raw({"operation": "goldfish-evidence-complete", "evidenceId": evidence})
            self.assertEqual(set(completion["receipts"]), set(task_ids))
            self.assertTrue(reusable["complete"])
            self.assertNotIn("completion", json.loads(state_file.read_text()))
            self.assertEqual(set(json.loads(state_file.read_text())["goldfishCompletion"]["receipts"]),
                set(task_ids))

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

    def deployed_worker_readiness(self, omitted=(), binary=None):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            container_module = root / "root" / "native_strategy_search.py"
            workspace = root / "workspace"
            container_module.parent.mkdir()
            container_module.write_bytes(pathlib.Path(launcher.__file__).read_bytes())
            allowlist = [relative for relative in json.loads(
                pathlib.Path("strategy-search-image-files.json").read_text()) if relative not in omitted]
            scientific = [relative for relative in json.loads(
                pathlib.Path("strategy-search-scientific-files.json").read_text()) if relative not in omitted]
            for relative in allowlist:
                target = workspace / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                if relative == "modal/native_strategy_search.py":
                    target.write_bytes(container_module.read_bytes())
                else:
                    shutil.copyfile(relative, target)
            (workspace / "strategy-search-image-files.json").write_text(json.dumps(allowlist))
            (workspace / "strategy-search-scientific-files.json").write_text(json.dumps(scientific))
            (workspace / "node_modules").symlink_to(pathlib.Path("node_modules").resolve(), target_is_directory=True)
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
scientific_paths = sorted(json.loads((root / "strategy-search-scientific-files.json").read_text()))
scientific = [entry for entry in files if entry["path"] in scientific_paths]
scientific_lines = "".join(f"{entry['path']}\\0{entry['bytes']}\\0{entry['sha256']}\\n" for entry in scientific)
identity = {"digest": hashlib.sha256(lines.encode()).hexdigest(),
    "scientificDigest": hashlib.sha256(scientific_lines.encode()).hexdigest(),
    "scientificPaths": scientific_paths, "files": files}
result = namespace["_strategy_search_compute_readiness_impl"](identity, False)
print(json.dumps(result))
""" % str(container_module)
            return subprocess.run([sys.executable, "-c", script], text=True, capture_output=True,
                env={**os.environ, "HEXDECK_STRATEGY_WORKSPACE": str(workspace),
                    "HEXDECK_GOLDFISH_BIN": binary or str(pathlib.Path(
                        "rust/target/release/hexdeck-goldfish").resolve())}, timeout=60)

    def test_deployed_container_readiness_starts_the_real_goldfish_module_path(self):
        completed = self.deployed_worker_readiness()
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertTrue(json.loads(completed.stdout.splitlines()[-1])["ready"])

    def test_deployed_container_readiness_fails_when_the_rust_binary_is_absent(self):
        completed = self.deployed_worker_readiness(binary="/missing/hexdeck-goldfish")
        self.assertNotEqual(completed.returncode, 0)
        self.assertIn("No such file or directory", completed.stderr)
        self.assertIn("/missing/hexdeck-goldfish", completed.stderr)

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
            self.assertEqual(progress["submittedTaskCount"], 1)
            self.assertEqual(progress["submittedCpus"], 4)

    def test_strategy_search_admission_recovery_distinguishes_failures_and_probes_upward(self):
        self.assertTrue(launcher._strategy_search_is_admission_error(
            RuntimeError("workspace CPU limit reached")))
        self.assertFalse(launcher._strategy_search_is_admission_error(
            RuntimeError("workspace source file is missing")))
        limit = 4
        observed = []
        while limit < 400:
            limit = launcher._strategy_search_recover_admission(limit, 400, 4)
            observed.append(limit)
        self.assertEqual(observed[-1], 400)
        self.assertLessEqual(len(observed), 12)
        self.assertEqual(launcher._strategy_search_recover_admission(396, 400, 4), 400)

    def test_strategy_search_poll_treats_builtin_timeout_as_pending_and_keeps_empty_failures_diagnostic(self):
        class PendingCall:
            def get(self, timeout):
                self.timeout = timeout
                raise TimeoutError()
        pending = PendingCall()
        self.assertEqual(launcher._strategy_search_poll_function_call(pending), {"state": "pending"})
        self.assertEqual(pending.timeout, 0)

        class RemoteTimeoutCall:
            def get(self, timeout):
                raise FunctionTimeoutError()
        remote_timeout = launcher._strategy_search_poll_function_call(RemoteTimeoutCall())
        self.assertEqual(remote_timeout["state"], "failed")
        self.assertIn("modal.exception.FunctionTimeoutError", remote_timeout["diagnostic"]["error"])

        class EmptyWorkerFailure(Exception):
            pass
        class FailedCall:
            def get(self, timeout):
                raise EmptyWorkerFailure()
        failed = launcher._strategy_search_poll_function_call(FailedCall())
        self.assertEqual(failed["state"], "failed")
        self.assertIsInstance(failed["exception"], EmptyWorkerFailure)
        self.assertIn("EmptyWorkerFailure", failed["diagnostic"]["error"])
        self.assertIn("<empty message>", failed["diagnostic"]["error"])
        self.assertEqual(failed["diagnostic"]["errorRepr"], "EmptyWorkerFailure()")
        self.assertIn("test_strategy_search_poll", failed["diagnostic"]["errorTraceback"])

    def test_strategy_search_readiness_runs_one_remote_worker_canary_through_poll_and_completion(self):
        class CanaryCall:
            object_id = "fc-canary"
            def __init__(self):
                self.timeouts = []
            def get(self, timeout):
                self.timeouts.append(timeout)
                if timeout == 0:
                    raise TimeoutError()
                return {"sha256": "a" * 64, "validatedSha256": "a" * 64}
        call, worker = CanaryCall(), MagicMock()
        worker.with_options.return_value.spawn.return_value = call
        identity = {"digest": "b" * 64, "scientificDigest": "c" * 64}
        with patch.object(launcher, "strategy_search_goldfish_job", worker), \
                patch.object(launcher.volume, "reload"), patch.object(launcher.volume, "commit"):
            launcher._strategy_search_remote_goldfish_canary(identity)
        self.assertEqual(call.timeouts, [0, 120])
        config = worker.with_options.return_value.spawn.call_args.args[0]
        self.assertEqual(config["range"], {"start": 0, "end": 1})
        self.assertEqual(config["mode"], "score-one")
        worker.with_options.assert_called_once_with(cpu=1, memory=4096, timeout=120, retries=0)

    def test_strategy_search_worker_startup_failures_are_terminal_and_retries_are_bounded(self):
        self.assertTrue(launcher._strategy_search_is_terminal_worker_error(
            RuntimeError("ERR_MODULE_NOT_FOUND: /workspace/src/game-data/cards.json")))
        self.assertTrue(launcher._strategy_search_is_terminal_worker_error(
            RuntimeError("Cannot find package tsx")))
        self.assertFalse(launcher._strategy_search_is_terminal_worker_error(
            RuntimeError("temporary network error")))
        attempts = [{"status": "failed"}, {"status": "admission-failed"}, {"status": "launch-failed"}]
        self.assertEqual(launcher._strategy_search_retryable_failure_count({"attempts": attempts}), 2)
        self.assertEqual(launcher.STRATEGY_SEARCH_MAX_JOB_ATTEMPTS, 3)
        controller = inspect.getsource(launcher._strategy_search_controller_impl)
        self.assertIn("cancel(terminate_containers=True)", controller)
        self.assertIn("cancelled-terminal-sibling", controller)
        self.assertIn("worker retry limit exhausted", controller)

    def test_strategy_search_controller_failure_persists_terminal_state(self):
        with tempfile.TemporaryDirectory() as directory:
            state_file = pathlib.Path(directory) / "state.json"
            state_file.write_text(json.dumps({"status": "running", "revision": 2,
                "jobs": [{"attempts": [{"submittedMs": 10, "finishedMs": 40, "cpu": 4,
                    "memoryMiB": 4096, "status": "failed"}]}]}))
            with patch.object(launcher, "_strategy_search_execution_file", return_value=state_file), \
                    patch.object(launcher.volume, "reload"), patch.object(launcher.volume, "commit"):
                failed = launcher.strategy_search_publisher.get_raw_f()({"operation": "execution-fail",
                    "campaignExecutionId": "a" * 64, "nowMs": 50, "failure": "worker exploded"})
            self.assertEqual(failed["status"], "failed")
            self.assertEqual(failed["failedMs"], 50)
            self.assertEqual(failed["failure"], "worker exploded")
            self.assertEqual(failed["failureAttemptCosts"][0]["basis"], "submitted-upper-bound")
            self.assertGreater(failed["failureAttemptCostUsdUpperBound"], 0)

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
                    "launchId": "launch", "sha256": digest, "validatedSha256": digest, "stage": "goldfish-one",
                    "range": {"start": 0, "end": 1}, **controller}
                result = raw({"operation": "publish-batch", "nowMs": 1, "publications": [publication]})
                self.assertEqual(result["receipts"]["task"]["sha256"], digest)
                self.assertEqual(held_path("evidence/final").read_bytes(), b"scientific")
                self.assertGreaterEqual(commit.call_count, 4)
                held_path("temporary/launch").write_bytes(b"conflict")
                with self.assertRaisesRegex(RuntimeError, "receipt conflicts"):
                    raw({"operation": "publish-batch", "nowMs": 2, "publications": [
                        {**publication, "sha256": hashlib.sha256(b"conflict").hexdigest(),
                            "validatedSha256": hashlib.sha256(b"conflict").hexdigest()}]})

    def test_strategy_search_publication_retries_after_artifact_commit_before_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            evidence, execution_id = "b" * 64, "a" * 64
            state_file, execution_file = root / "publication.json", root / "execution.json"
            execution_file.write_text(json.dumps({"controller": {
                "ownerId": "owner", "fence": 1, "leaseUntilMs": 100}}))
            paths = {}
            def held_path(relative):
                return paths.setdefault(relative, root / relative.replace("/", "_"))
            controller = {"campaignExecutionId": execution_id,
                "controllerOwnerId": "owner", "controllerFence": 1}
            common = {"evidenceId": evidence, "taskId": "task", "ownerId": "owner", **controller}
            raw = launcher.strategy_search_publisher.get_raw_f()
            with patch.object(launcher, "_strategy_search_evidence_state", return_value=state_file), \
                    patch.object(launcher, "_strategy_search_execution_file", return_value=execution_file), \
                    patch.object(launcher, "_strategy_search_path", side_effect=held_path), \
                    patch.object(launcher.volume, "reload"), \
                    patch.object(launcher.volume, "commit") as commit:
                lease = raw({"operation": "claim", **common, "nowMs": 0, "leaseMs": 100})
                raw({"operation": "intent", **common, "fence": lease["fence"], "launchId": "launch",
                    "artifactPath": "evidence/final", "temporaryPath": "temporary/launch", "nowMs": 1})
                temporary, destination = held_path("temporary/launch"), held_path("evidence/final")
                temporary.write_bytes(b"scientific")
                digest = hashlib.sha256(b"scientific").hexdigest()
                publication = {"evidenceId": evidence, "taskId": "task", "fence": lease["fence"],
                    "launchId": "launch", "sha256": digest, "validatedSha256": digest,
                    "stage": "goldfish-one", "range": {"start": 0, "end": 1}, **controller}
                commit.side_effect = RuntimeError("commit interrupted")
                with self.assertRaisesRegex(RuntimeError, "commit interrupted"):
                    raw({"operation": "publish-batch", "nowMs": 1, "publications": [publication]})
                self.assertEqual(destination.read_bytes(), b"scientific")
                self.assertFalse(temporary.exists())
                temporary.write_bytes(b"scientific")
                commit.side_effect = None
                result = raw({"operation": "publish-batch", "nowMs": 2, "publications": [publication]})
            self.assertEqual(result["receipts"]["task"]["sha256"], digest)
            self.assertFalse(temporary.exists())
            self.assertEqual(destination.read_bytes(), b"scientific")

    def test_strategy_search_prepare_preserves_stale_psro_receipts_and_rematerializes_only_them(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            evidence, execution_id = "b" * 64, "a" * 64
            state_file, execution_file = root / "publication.json", root / "execution.json"
            execution_file.write_text(json.dumps({"revision": 0, "controller": {
                "ownerId": "owner", "fence": 1, "leaseUntilMs": 100}}))
            paths, receipts, items = {}, {}, []
            for index in range(5):
                task_id, relative = f"score-{index}", f"evidence/{evidence}/score-{index}.json"
                artifact = root / f"score-{index}.json"
                artifact.write_text(json.dumps({"schemaVersion": 1, "index": index}))
                digest = launcher._strategy_search_sha256(artifact)
                paths[relative] = artifact
                receipts[task_id] = {"taskId": task_id, "evidenceId": evidence,
                    "artifactPath": relative, "sha256": digest, "fence": 1}
                items.append({"taskId": task_id, "evidenceId": evidence, "stage": "psro-score",
                    "kingdomId": "kingdom", "transitionPath": "transition.json",
                    "scoreTask": {"taskIndex": index, "candidateStart": index, "candidateEnd": index + 1,
                        "scheduleStart": 0, "scheduleEnd": 8, "expectedTaskMs": 1},
                    "launchId": f"launch-{index}", "temporaryPath": f"temporary/{index}",
                    "artifactPath": relative})
            other_relative = f"evidence/{evidence}/matrix-score.json"
            other_artifact = root / "matrix-score.json"
            other_artifact.write_text(json.dumps({"schemaVersion": 1, "matrix": True}))
            paths[other_relative] = other_artifact
            receipts["other-task"] = {"taskId": "other-task", "evidenceId": evidence,
                "artifactPath": other_relative, "sha256": launcher._strategy_search_sha256(other_artifact), "fence": 1}
            items.append({"taskId": "other-task", "evidenceId": evidence, "stage": "matrix-score",
                "kingdomId": "kingdom", "launchId": "other-launch", "temporaryPath": "temporary/other",
                "artifactPath": other_relative})
            state_file.write_text(json.dumps({"schemaVersion": 1, "evidenceId": evidence,
                "leases": {}, "intents": {}, "receipts": receipts}))
            def held_path(relative):
                return paths.setdefault(relative, root / relative.replace("/", "_"))
            raw = launcher.strategy_search_publisher.get_raw_f()
            with patch.object(launcher, "_strategy_search_evidence_state", return_value=state_file), \
                    patch.object(launcher, "_strategy_search_execution_file", return_value=execution_file), \
                    patch.object(launcher, "_strategy_search_path", side_effect=held_path), \
                    patch.object(launcher, "_strategy_search_validate_psro_score_receipt",
                        side_effect=[False] * 5), \
                    patch.object(launcher.volume, "reload"), patch.object(launcher.volume, "commit"):
                result = raw({"operation": "prepare-launch-batch", "campaignExecutionId": execution_id,
                    "controllerOwnerId": "owner", "controllerFence": 1, "ownerId": "owner",
                    "nowMs": 1, "leaseMs": 100, "items": items})
            self.assertTrue(all(not result[f"score-{index}"]["complete"] for index in range(5)))
            self.assertTrue(result["other-task"]["complete"])
            saved = json.loads(state_file.read_text())
            self.assertEqual(set(saved["receipts"]), {"other-task"})
            self.assertEqual(set(saved["invalidReceipts"]), {f"score-{index}" for index in range(5)})
            for index in range(5):
                task_id = f"score-{index}"
                self.assertFalse(paths[items[index]["artifactPath"]].exists())
                preserved = saved["invalidReceipts"][task_id][0]["preservedArtifactPath"]
                self.assertTrue(paths[preserved].exists())

    def test_strategy_search_task_identity_normalizes_modal_object_key_order(self):
        evidence = "b" * 64
        forward = launcher._strategy_search_goldfish_task_id(evidence, "goldfish-one",
            {"start": 0, "end": 10})
        reversed_keys = launcher._strategy_search_goldfish_task_id(evidence, "goldfish-one",
            {"end": 10, "start": 0})
        expected = hashlib.sha256(json.dumps({"evidenceId": evidence, "stage": "goldfish-one",
            "range": {"start": 0, "end": 10}}, separators=(",", ":")).encode()).hexdigest()
        self.assertEqual(forward, expected)
        self.assertEqual(reversed_keys, expected)

    def test_strategy_search_expands_one_sealed_psro_look_into_bounded_score_and_reduce_jobs(self):
        evidence = "b" * 64
        transition = {"kind": "score", "checkpoint": {"evidenceHash": "c" * 64},
            "look": {"descriptorHash": "d" * 64, "scheduleStart": 0, "scheduleEnd": 8},
            "tasks": [{"taskIndex": 0, "candidateStart": 0, "candidateEnd": 100,
                "scheduleStart": 0, "scheduleEnd": 8, "expectedTaskMs": 15000},
                {"taskIndex": 1, "candidateStart": 100, "candidateEnd": 200,
                    "scheduleStart": 0, "scheduleEnd": 8, "expectedTaskMs": 15000}]}
        job = {"taskId": "decision", "evidenceId": evidence, "kingdomId": "kingdom",
            "stage": "psro-decision", "status": "complete",
            "receipt": {"artifactPath": "transition.json"}}
        state = {"maxActiveCpus": 400, "jobs": [job], "tasks": []}
        with patch.object(launcher, "_strategy_search_path", return_value=pathlib.Path("transition.json")), \
                patch.object(launcher, "_strategy_search_load", return_value=transition), \
                patch.object(launcher.volume, "reload"):
            self.assertTrue(launcher._strategy_search_expand_transition(state, job))
            self.assertFalse(launcher._strategy_search_expand_transition(state, job))
        self.assertTrue(launcher._strategy_search_materialize_adaptive(state,
            {"controller": {"readyWindowWaves": 2}}))
        scores = [held for held in state["jobs"] if held["stage"] == "psro-score"]
        self.assertEqual(len(scores), 2)
        reducer = next(held for held in state["jobs"]
            if held["stage"] == "psro-decision" and held["taskId"] != "decision")
        self.assertEqual(reducer["dependencyTaskIds"], [held["taskId"] for held in scores])
        self.assertEqual(len(state["jobs"]), 4)

    def test_strategy_search_materializes_only_two_adaptive_score_waves(self):
        evidence = "b" * 64
        tasks = [{"taskIndex": index, "candidateStart": index * 10,
            "candidateEnd": (index + 1) * 10, "scheduleStart": 0, "scheduleEnd": 8,
            "expectedTaskMs": 20000} for index in range(10)]
        state = {"maxActiveCpus": 8, "jobs": [], "tasks": [], "dynamicScorePartitions": {
            "d" * 64: {"kind": "score", "evidenceId": evidence, "kingdomId": "kingdom",
                "parentTaskId": "parent", "transitionPath": "transition", "root": "root",
                "descriptorHash": "d" * 64, "scoreBlocks": 8, "tasks": tasks,
                "reducerCreated": False}}}
        bundle = {"controller": {"readyWindowWaves": 2}}
        self.assertTrue(launcher._strategy_search_materialize_adaptive(state, bundle))
        first = [job for job in state["jobs"] if job["stage"] == "psro-score"]
        self.assertEqual(len(first), 4)
        self.assertFalse(any(job["stage"] == "psro-decision" for job in state["jobs"]))
        for job in first:
            job["status"] = "complete"
        self.assertTrue(launcher._strategy_search_materialize_adaptive(state, bundle))
        self.assertEqual(len([job for job in state["jobs"] if job["stage"] == "psro-score"]), 8)

    def test_strategy_search_reports_running_and_submitted_cpus_for_each_score_look(self):
        jobs, tasks = [], []
        for index in range(2):
            task_id = f"score-{index}"
            jobs.append({"taskId": task_id, "evidenceId": "b" * 64, "kingdomId": "kingdom",
                "stage": "psro-score", "attempts": [{"submittedMs": 10 + index * 10,
                    "finishedMs": 90 - index * 10, "workerStartedMs": 20 + index * 10,
                    "workerFinishedMs": 80 - index * 10, "cpu": 4}]})
            tasks.append({"taskId": task_id, "metadata": {"lookDescriptorHash": "c" * 64}})
        jobs.append({"taskId": "reduce", "evidenceId": "b" * 64, "kingdomId": "kingdom",
            "stage": "psro-decision", "dependencyTaskIds": ["score-0", "score-1"],
            "attempts": [{"submittedMs": 90, "finishedMs": 100, "workerStartedMs": 91,
                "workerFinishedMs": 99, "modalWorkerElapsedMs": 8, "cpu": 1}]})
        result = launcher._strategy_search_score_look_utilization({"jobs": jobs, "tasks": tasks}, 100)
        self.assertEqual(result, [{"evidenceId": "b" * 64, "kingdomId": "kingdom",
            "stage": "psro-score", "lookId": "c" * 64, "taskCount": 2, "requestedCpus": 8,
            "peakSubmittedCpus": 8, "peakRunningCpus": 8, "admissionFailureCount": 0,
            "workerDurationMs": {"min": 40, "p50": 40, "p95": 60, "max": 60},
            "queueDelayMs": {"min": 10, "p50": 10, "p95": 10, "max": 10},
            "coordinationAndReductionMs": 20, "reductionWorkerMs": 8, "totalWallMs": 90}])

    def test_strategy_search_materializes_only_two_global_goldfish_waves_and_then_reducer(self):
        evidence = "b" * 64
        ranges = [{"start": index * 10, "end": (index + 1) * 10} for index in range(10)]
        state = {"maxActiveCpus": 8, "partitions": {
            f"{evidence}:goldfish-one": {"jobs": ranges},
            f"{evidence}:goldfish-two": {"jobs": [{"start": 0, "end": 10}]}
        }, "jobs": [{"taskId": "matrix", "evidenceId": evidence, "kingdomId": "kingdom",
            "stage": "matrix-manifest", "status": "blocked"}], "tasks": []}
        bundle = {"controller": {"readyWindowWaves": 2}}
        self.assertTrue(launcher._strategy_search_materialize_goldfish(state, bundle))
        first = [job for job in state["jobs"] if job["stage"] == "goldfish-one"]
        self.assertEqual(len(first), 4)
        self.assertFalse(any(job["stage"] == "goldfish-one-reduce" for job in state["jobs"]))
        for job in first:
            job["status"] = "complete"
        self.assertTrue(launcher._strategy_search_materialize_goldfish(state, bundle))
        second = [job for job in state["jobs"] if job["stage"] == "goldfish-one"]
        self.assertEqual(len(second), 8)
        for job in second:
            job["status"] = "complete"
        self.assertTrue(launcher._strategy_search_materialize_goldfish(state, bundle))
        final = [job for job in state["jobs"] if job["stage"] == "goldfish-one"]
        self.assertEqual(len(final), 10)
        reducer = next(job for job in state["jobs"] if job["stage"] == "goldfish-one-reduce")
        self.assertEqual(len(reducer["dependencyTaskIds"]), 10)
        self.assertFalse(any(job["stage"] == "goldfish-two" for job in state["jobs"]))
        reducer["status"] = "complete"
        self.assertTrue(launcher._strategy_search_materialize_goldfish(state, bundle))
        self.assertEqual(len([job for job in state["jobs"] if job["stage"] == "goldfish-two"]), 1)

    def test_strategy_search_complete_evidence_is_reused_across_campaigns(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            evidence = "b" * 64
            state_file = root / "publication.json"
            task_ids = {stage: f"task-{stage}" for stage in
                ["goldfish-one-reduce", "goldfish-two-reduce", "matrix-reduce", "psro-reduce"]}
            receipts = {}
            paths = {}
            for stage, task_id in task_ids.items():
                artifact = root / f"{stage}.artifact"
                artifact.write_bytes(stage.encode())
                relative = f"evidence/{evidence}/{stage}"
                paths[relative] = artifact
                receipts[task_id] = {"taskId": task_id, "evidenceId": evidence,
                    "artifactPath": relative, "sha256": hashlib.sha256(stage.encode()).hexdigest(), "fence": 1}
            state_file.write_text(json.dumps({"schemaVersion": 1, "evidenceId": evidence,
                "leases": {}, "intents": {}, "receipts": receipts,
                "completion": {"completedMs": 1,
                    "receipts": {stage: receipts[task_id] for stage, task_id in task_ids.items()}}}))
            with patch.object(launcher, "_strategy_search_evidence_state", return_value=state_file), \
                    patch.object(launcher, "_strategy_search_path", side_effect=lambda relative: paths[relative]), \
                    patch.object(launcher.volume, "reload"):
                result = launcher.strategy_search_publisher.get_raw_f()({"operation": "evidence-complete",
                    "evidenceId": evidence})
            self.assertTrue(result["complete"])
            self.assertEqual(set(result["receipts"]), set(task_ids))

    def test_strategy_search_shared_lease_joins_receipt_and_refences_takeover(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            evidence, first_execution, second_execution = "b" * 64, "a" * 64, "c" * 64
            state_file = root / "publication.json"
            execution_files = {first_execution: root / "first.json", second_execution: root / "second.json"}
            execution_files[first_execution].write_text(json.dumps({"controller": {"ownerId": "one", "fence": 1, "leaseUntilMs": 100}}))
            execution_files[second_execution].write_text(json.dumps({"controller": {"ownerId": "two", "fence": 1, "leaseUntilMs": 1000}}))
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
                stale_controller_busy = raw({"operation": "claim", "evidenceId": evidence, "taskId": "task",
                    "ownerId": "two", "nowMs": 2, "leaseMs": 100, **second})
                self.assertTrue(stale_controller_busy["busy"])
                taken = raw({"operation": "claim", "evidenceId": evidence, "taskId": "task", "ownerId": "two",
                    "nowMs": 101, "leaseMs": 100, **second})
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

    def test_strategy_search_validation_and_heartbeat_work_stay_outside_publisher_lock(self):
        publisher_source = inspect.getsource(launcher.strategy_search_publisher.get_raw_f())
        goldfish_worker_source = inspect.getsource(launcher.strategy_search_goldfish_job.get_raw_f())
        subprocess_source = inspect.getsource(launcher._strategy_search_run_subprocess)
        self.assertNotIn("_strategy_search_validate_publication(publication", publisher_source)
        self.assertIn("_strategy_search_validate_publication(config, output)", goldfish_worker_source)
        self.assertNotIn("heartbeat", subprocess_source)

    def test_goldfish_phase_mapping_preserves_the_controller_sum_for_all_commands(self):
        reports = [
            {"command": "score-one", "elapsedMs": 100, "scoringMs": 70, "readMs": 5,
             "writeMs": 10, "reduceMs": 0},
            {"command": "score-two", "elapsedMs": 100, "scoringMs": 60, "readMs": 15,
             "writeMs": 10, "reduceMs": 0},
            {"command": "reduce-one", "elapsedMs": 100, "scoringMs": 0, "readMs": 50,
             "writeMs": 15, "reduceMs": 20},
            {"command": "reduce-two", "elapsedMs": 100, "scoringMs": 0, "readMs": 45,
             "writeMs": 10, "reduceMs": 30},
        ]
        keys = ["generationMs", "scoringMs", "intermediateSerializationAndReadMs",
            "temporaryVolumeWriteCommitMs", "publisherWaitMs", "publicationCommitMs",
            "reductionComputeMs", "finalTop500000WriteMs", "finalTop20000WriteMs",
            "orchestrationQueueMs"]
        for report in reports:
            phases = launcher._strategy_search_goldfish_phases(report)
            self.assertEqual(sum(phases[key] for key in keys), phases["elapsedMs"])

    def test_goldfish_job_launches_the_rust_subcommands_and_maps_reports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            commands = []
            def strategy_path(relative):
                return root / relative
            def run_subprocess(command, _config):
                commands.append(command)
                output = pathlib.Path(command[command.index("--out") + 1])
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(b"artifact")
                mode = command[1]
                report = {"command": mode, "elapsedMs": 100, "scoringMs": 60 if mode.startswith("score") else 0,
                    "readMs": 10, "writeMs": 10, "reduceMs": 10 if mode.startswith("reduce") else 0}
                pathlib.Path(command[command.index("--report") + 1]).write_text(json.dumps(report))
                return {"elapsedMs": 100}
            base = {"taskId": "task", "evidenceId": "a" * 64,
                "kingdomId": "deep-beam-tuning-007", "sourceImage": {}, "cpu": 4,
                "timeoutSeconds": 120, "enqueuedEpochMs": int(time.time() * 1000)}
            raw = launcher.strategy_search_goldfish_job.get_raw_f()
            with patch.object(launcher, "_strategy_search_path", side_effect=strategy_path), \
                    patch.object(launcher, "_strategy_search_run_subprocess", side_effect=run_subprocess), \
                    patch.object(launcher, "_strategy_search_validate_publication"), \
                    patch.object(launcher.volume, "reload"), patch.object(launcher.volume, "commit"):
                raw({**base, "cpu": 16, "stage": "goldfish-one", "mode": "score-one",
                    "temporaryPath": "one.hgs", "range": {"start": 0, "end": 1}})
                raw({**base, "stage": "goldfish-one-reduce", "mode": "reduce-one",
                    "temporaryPath": "top.hgf", "manifest": ["one.hgs"]})
                raw({**base, "stage": "goldfish-two", "mode": "score-two",
                    "temporaryPath": "two.hgs", "range": {"start": 0, "end": 1},
                    "topPath": "top.hgf"})
                raw({**base, "stage": "goldfish-two-reduce", "mode": "reduce-two",
                    "temporaryPath": "reservoir.hgf", "manifest": ["two.hgs"],
                    "topPath": "top.hgf"})
            self.assertEqual([command[1] for command in commands],
                ["score-one", "reduce-one", "score-two", "reduce-two"])
            self.assertTrue(all(command[0] == launcher.CAMPAIGN_RUST_GOLDFISH_BIN for command in commands))
            self.assertEqual(commands[0][commands[0].index("--threads") + 1], "16")
            self.assertIn("--inputs", commands[1])
            self.assertIn("--top", commands[2])
            self.assertIn("--top", commands[3])
            self.assertTrue(all("--evidence-id" not in command for command in commands))

    def test_goldfish_publication_validation_uses_rust_verify_and_top_links(self):
        calls = []
        with patch.object(launcher, "_run_checked", side_effect=lambda command, *_args, **_kwargs: calls.append(command)), \
                patch.object(launcher, "_strategy_search_path", side_effect=lambda relative: pathlib.Path("/results") / relative):
            for stage in ["goldfish-one", "goldfish-two", "goldfish-one-reduce", "goldfish-two-reduce"]:
                publication = {"stage": stage, "kingdomId": "deep-beam-tuning-007",
                    "evidenceId": "a" * 64, "topPath": "top.hgf",
                    "range": {"start": 2, "end": 5}}
                launcher._strategy_search_validate_publication(publication, pathlib.Path("/tmp/artifact"))
        self.assertEqual([call[1:3] for call in calls], [["verify", "--kingdom"]] * 4)
        self.assertIn("stage-one", calls[0])
        self.assertIn("stage-two", calls[1])
        self.assertIn("top", calls[2])
        self.assertIn("reservoir", calls[3])
        self.assertNotIn("--top", calls[0])
        self.assertIn("--top", calls[1])
        self.assertNotIn("--top", calls[2])
        self.assertIn("--top", calls[3])

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
            jobs = [{"stage": "goldfish-one", "status": "active", "cpu": 4},
                {"stage": "goldfish-one", "status": "ready"},
                {"stage": "goldfish-one", "status": "launching"},
                {"stage": "goldfish-one", "status": "retry-backoff", "lastError": "worker import failed"},
                {"stage": "goldfish-one", "status": "failed", "lastError": "worker import failed"},
                {"stage": "goldfish-one-reduce", "status": "blocked"}]
            state_file.write_text(json.dumps({"status": "running", "report": None,
                "usefulWorkStartedMs": 2, "controllerFence": 1,
                "controller": {"ownerId": "owner", "fence": 1, "leaseUntilMs": 9_000_000_000_000},
                "jobs": jobs}))
            running = raw("a" * 64)
            self.assertEqual(running["phase"], "controller-running")
            self.assertTrue(running["controllerLeaseLive"])
            self.assertIsNone(running["activeTaskCount"])
            self.assertIsNone(running["activeCpus"])
            self.assertEqual(running["submittedTaskCount"], 1)
            self.assertEqual(running["submittedCpus"], 4)
            self.assertEqual(running["readyTaskCount"], 1)
            self.assertEqual(running["launchingTaskCount"], 1)
            self.assertEqual(running["retryBackoffTaskCount"], 1)
            self.assertEqual(running["failedTaskCount"], 1)
            self.assertEqual(running["blockedTaskCount"], 1)
            self.assertEqual(running["commonLastError"], {"count": 2, "message": "worker import failed"})
            jobs[0]["status"] = "retry-backoff"
            state_file.write_text(json.dumps({"status": "running", "report": None,
                "usefulWorkStartedMs": 2, "controllerFence": 1,
                "controller": {"ownerId": "owner", "fence": 1, "leaseUntilMs": 1}, "jobs": jobs}))
            stale = raw("a" * 64)
            self.assertEqual(stale["status"], "stale")
            self.assertEqual(stale["phase"], "controller-stale")
            self.assertFalse(stale["controllerLeaseLive"])

    def test_strategy_search_run_prepares_state_only_after_verified_compute_deployment(self):
        bundle = {"schemaVersion": 3, "campaignExecutionId": "a" * 64,
            "executionRoot": "executions/" + "a" * 64,
            "request": {"kingdomIds": ["kingdom"], "maxActiveCpus": 400},
            "sourceImage": {"digest": "b" * 64, "files": []}, "partitions": {"one": []},
            "jobs": [{"taskId": "task", "status": "ready"}],
            "tasks": [{"taskId": "task", "stage": "psro-decision", "evidenceId": "c" * 64}],
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
