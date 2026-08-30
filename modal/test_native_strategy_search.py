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
    def goldfish_only_bundle(self, worker_cores=32, max_active_cpus=512):
        evidence_id = "a" * 64
        kingdom_id = "balance-tuning-005"
        request = {"kingdomIds": [kingdom_id], "workerCores": worker_cores,
            "maxActiveCpus": max_active_cpus, "maxWallSeconds": 3600, "maxCostUsd": 100}
        task_counts = {"kingdomOne": 1, "kingdomTwo": 1, "total": 2}
        cost = launcher._strategy_search_goldfish_worst_case_cost(request, task_counts)
        timeout_one = launcher._strategy_search_goldfish_kingdom_one_timeout(worker_cores)
        one_id = launcher._strategy_search_goldfish_task_id(evidence_id, "goldfish-one-reduce", None)
        two_id = launcher._strategy_search_goldfish_task_id(evidence_id, "goldfish-two-reduce", None)
        controller = {"route": launcher.GOLDFISH_MODAL_ROUTE, "maxActiveCpus": max_active_cpus,
            "timeoutSeconds": 3600, "maxWallSeconds": 3600, "pollIntervalSeconds": 1,
            "volumeName": "hexdeck-native-strategy-results", "readyWindowWaves": 2,
            "maxReducerMemoryMiB": (max_active_cpus // worker_cores) * 8192,
            "goldfishWorkerCores": worker_cores, "goldfishKingdomMemoryMiB": 8192,
            "goldfishKingdomOneTimeoutSeconds": timeout_one,
            "goldfishKingdomTwoTimeoutSeconds": 300, "executionPlanHash": "d" * 64,
            "costGuard": {"cpuUsdPerCoreSecond": 0.0000131,
                "memoryUsdPerGibSecond": 0.00000222, "attemptCount": 3,
                "hardMaximumCostUsd": 100, "requestedMaximumCostUsd": 100,
                "worstCaseModalComputeUsd": cost, "taskCounts": task_counts}}
        jobs = [
            {"taskId": one_id, "evidenceId": evidence_id, "kingdomId": kingdom_id,
                "stage": "goldfish-one-reduce", "range": None, "cpus": worker_cores,
                "status": "ready", "dependencyTaskIds": [], "launchIntentId": None,
                "callId": None, "leaseUntilMs": None, "attemptCount": 0},
            {"taskId": two_id, "evidenceId": evidence_id, "kingdomId": kingdom_id,
                "stage": "goldfish-two-reduce", "range": None, "cpus": worker_cores,
                "status": "blocked", "dependencyTaskIds": [one_id], "launchIntentId": None,
                "callId": None, "leaseUntilMs": None, "attemptCount": 0}]
        tasks = [
            {"taskId": one_id, "evidenceId": evidence_id, "kingdomId": kingdom_id,
                "stage": "goldfish-one-reduce", "range": None, "cpu": worker_cores,
                "memoryMiB": 8192, "timeoutSeconds": timeout_one, "dependencyTaskIds": [],
                "artifactPath": f"evidence/{evidence_id}/goldfish/top-500000.hgf"},
            {"taskId": two_id, "evidenceId": evidence_id, "kingdomId": kingdom_id,
                "stage": "goldfish-two-reduce", "range": None, "cpu": worker_cores,
                "memoryMiB": 8192, "timeoutSeconds": 300, "dependencyTaskIds": [one_id],
                "artifactPath": f"evidence/{evidence_id}/goldfish/reservoir.hgf"}]
        return {"schemaVersion": 3, "campaignExecutionId": "b" * 64,
            "executionRoot": "executions/" + "b" * 64, "request": request,
            "sourceImage": {"digest": "c" * 64}, "partitions": {},
            "jobs": jobs, "tasks": tasks, "controller": controller}

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

    def test_called_process_diagnostic_is_nonblank_and_includes_captured_output(self):
        failure = subprocess.CalledProcessError(1, ["validator"], output="", stderr="exact validator failure")
        diagnostic = launcher._strategy_search_exception_diagnostic(failure)
        self.assertIn("subprocess.CalledProcessError", diagnostic["error"])
        self.assertIn("exact validator failure", diagnostic["error"])

    def test_atomic_write_keeps_the_previous_checkpoint_when_rename_is_interrupted(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory) / "checkpoint.json"
            launcher._atomic_json(target, {"complete": True})
            with patch.object(launcher.os, "replace", side_effect=OSError("interrupted")):
                with self.assertRaises(OSError):
                    launcher._atomic_json(target, {"complete": False})
            self.assertEqual(json.loads(target.read_text()), {"complete": True})


    def test_goldfish_only_cost_guard_and_bundle_shape_fail_closed(self):
        expected_costs = {16: 1.201972, 32: 1.595977, 64: 2.416435}
        for cores, expected in expected_costs.items():
            bundle = self.goldfish_only_bundle(cores)
            result = launcher._strategy_search_validate_goldfish_only_bundle(bundle)
            self.assertEqual(result["taskCounts"], {"kingdomOne": 1, "kingdomTwo": 1, "total": 2})
            self.assertEqual(result["worstCaseModalComputeUsd"], expected)
            self.assertEqual(bundle["controller"]["costGuard"]["worstCaseModalComputeUsd"], expected)
        self.assertEqual(launcher.GOLDFISH_MODAL_CPU_RATE_PER_CORE_SECOND, 0.0000131)
        self.assertEqual(launcher.GOLDFISH_MODAL_MEMORY_RATE_PER_GIB_SECOND, 0.00000222)

        bundle = self.goldfish_only_bundle()
        mutations = []
        def changed(update):
            held = copy.deepcopy(bundle)
            update(held)
            mutations.append(held)
        changed(lambda held: held["partitions"].update({"obsolete": {}}))
        changed(lambda held: held["jobs"][0].update({"stage": "goldfish-one"}))
        changed(lambda held: (held["jobs"].append(copy.deepcopy(held["jobs"][0])),
            held["tasks"].append(copy.deepcopy(held["tasks"][0]))))
        changed(lambda held: held["jobs"][0].update({"taskId": "wrong"}))
        changed(lambda held: held["jobs"][0].update({"status": "blocked"}))
        changed(lambda held: held["jobs"][1].update({"evidenceId": "b" * 64}))
        changed(lambda held: held["jobs"][0].update({"cpus": 16}))
        changed(lambda held: held["tasks"][0].update({"cpu": 16}))
        changed(lambda held: held["tasks"][0].update({"memoryMiB": 4096}))
        changed(lambda held: held["tasks"][0].update({"timeoutSeconds": 300}))
        changed(lambda held: held["tasks"][1].update({"dependencyTaskIds": []}))
        changed(lambda held: held["tasks"][0].update({"artifactPath": "wrong"}))
        changed(lambda held: held["controller"]["costGuard"].update({
            "worstCaseModalComputeUsd": 0.1}))
        changed(lambda held: held["request"].update({"workerCores": 15}))
        for held in mutations:
            with self.assertRaises(ValueError):
                launcher._strategy_search_validate_goldfish_only_bundle(held)

    def test_goldfish_only_task_config_uses_kingdom_modes_top_path_and_batch_lease(self):
        bundle = self.goldfish_only_bundle()
        state = {"controllerFence": 1, "tasks": copy.deepcopy(bundle["tasks"]),
            "jobs": copy.deepcopy(bundle["jobs"])}
        lease_ms = (707 + 600) * 1000
        configs = []
        for job in state["jobs"]:
            configs.append(launcher._strategy_search_task_config(bundle, state, job, "owner", {
                "launchId": f"launch-{len(configs)}", "temporaryPath": f"temporary/{len(configs)}.hgf",
                "fence": 1, "leaseUntilMs": lease_ms, "leaseMs": lease_ms}))
        self.assertEqual([config["mode"] for config in configs], ["kingdom-one", "kingdom-two"])
        self.assertNotIn("manifest", configs[0])
        self.assertEqual(configs[1]["topPath"],
            f"evidence/{'a' * 64}/goldfish/top-500000.hgf")
        self.assertEqual([config["leaseMs"] for config in configs], [lease_ms, lease_ms])

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
        self.assertEqual(source.count("image.add_local_dir"), 2)
        layered = launcher._RUST_IMAGE_FILES | launcher._APPLICATION_IMAGE_FILES
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

    def test_psro_readiness_checks_source_wrapper_and_binary_usage(self):
        completed = subprocess.CompletedProcess(["hexdeck-goldfish", "psro"], 2,
            stdout="", stderr="psro requires --threads")
        local_binary = str(pathlib.Path("rust/target/release/hexdeck-goldfish").resolve())
        with patch.object(launcher, "verify_strategy_search_source") as verify, \
                patch.object(launcher, "CAMPAIGN_RUST_GOLDFISH_BIN", local_binary), \
                patch.object(launcher.subprocess, "run", return_value=completed) as run:
            result = launcher._strategy_search_psro_readiness_impl({"digest": "a" * 64})
        verify.assert_called_once_with({"digest": "a" * 64})
        run.assert_called_once_with([local_binary, "psro"],
            text=True, capture_output=True, check=False, timeout=30)
        self.assertEqual(result, {"ready": True, "sourceDigest": "a" * 64})

    def test_psro_readiness_rejects_a_missing_binary_or_wrong_usage_result(self):
        with patch.object(launcher, "verify_strategy_search_source"), \
                patch.object(launcher, "CAMPAIGN_RUST_GOLDFISH_BIN", "/missing/hexdeck-goldfish"):
            with self.assertRaisesRegex(RuntimeError, "missing or not executable"):
                launcher._strategy_search_psro_readiness_impl({"digest": "a" * 64})
        completed = subprocess.CompletedProcess(["hexdeck-goldfish", "psro"], 0,
            stdout="unexpected", stderr="")
        local_binary = str(pathlib.Path("rust/target/release/hexdeck-goldfish").resolve())
        with patch.object(launcher, "verify_strategy_search_source"), \
                patch.object(launcher, "CAMPAIGN_RUST_GOLDFISH_BIN", local_binary), \
                patch.object(launcher.subprocess, "run", return_value=completed):
            with self.assertRaisesRegex(RuntimeError, "expected usage error"):
                launcher._strategy_search_psro_readiness_impl({"digest": "a" * 64})

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

    def test_goldfish_only_controller_runs_two_kingdom_tasks_with_scaled_leases_and_throughput(self):
        bundle = self.goldfish_only_bundle()

        class CompleteCall:
            def __init__(self, object_id, config):
                self.object_id = object_id
                self.config = config
                self.digest = hashlib.sha256(config["stage"].encode()).hexdigest()
            def get(self, timeout):
                del timeout
                phases = {key: 0 for key in ["generationMs", "scoringMs",
                    "intermediateSerializationAndReadMs", "temporaryVolumeWriteCommitMs",
                    "publisherWaitMs", "publicationCommitMs", "reductionComputeMs",
                    "finalTop500000WriteMs", "finalTop20000WriteMs", "orchestrationQueueMs"]}
                phases.update({"scoringMs": 10, "elapsedMs": 10})
                now_ms = int(time.time() * 1000)
                row_count = 12_972_960 if self.config["stage"] == "goldfish-one-reduce" else 500_000
                return {"sha256": self.digest, "validatedSha256": self.digest,
                    "modalWorkerElapsedMs": 10, "workerStartedEpochMs": now_ms,
                    "workerFinishedEpochMs": now_ms, "phases": phases,
                    "rustReports": {"score": {"rowCount": row_count}}}

        class ImmediateWorker:
            def __init__(self):
                self.configs = []
            def with_options(self, **_options):
                return self
            def spawn(self, config):
                self.configs.append(config)
                return CompleteCall(f"fc-{len(self.configs)}", config)

        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            holder = {}
            leases = []
            finalized = []
            def strategy_path(relative):
                return root / relative
            def publish(request):
                operation = request["operation"]
                if operation == "execution-init":
                    return {"status": "ready"}
                if operation == "controller-claim":
                    state = {"maxActiveCpus": 512, "partitions": {},
                        "jobs": copy.deepcopy(bundle["jobs"]), "tasks": copy.deepcopy(bundle["tasks"]),
                        "controllerFence": 1, "controller": {"ownerId": request["ownerId"],
                            "fence": 1, "leaseUntilMs": request["nowMs"] + request["leaseMs"]},
                        "startedMs": request["nowMs"], "status": "running"}
                    holder["state"] = state
                    return state
                if operation == "goldfish-evidence-complete":
                    return {"complete": False}
                if operation == "execution-save":
                    holder["state"] = request["state"]
                    return request["state"]
                if operation == "prepare-launch-batch":
                    leases.append(request["leaseMs"])
                    return {item["taskId"]: {"launchId": item["launchId"],
                        "temporaryPath": item["temporaryPath"], "fence": 1,
                        "leaseUntilMs": request["nowMs"] + request["leaseMs"]}
                        for item in request["items"]}
                if operation == "publish-batch":
                    receipts = {}
                    tasks = {task["taskId"]: task for task in holder["state"]["tasks"]}
                    for publication in request["publications"]:
                        task = tasks[publication["taskId"]]
                        artifact = strategy_path(task["artifactPath"])
                        artifact.parent.mkdir(parents=True, exist_ok=True)
                        artifact.write_bytes(publication["stage"].encode())
                        receipts[publication["taskId"]] = {"taskId": publication["taskId"],
                            "evidenceId": publication["evidenceId"], "artifactPath": task["artifactPath"],
                            "sha256": publication["sha256"], "fence": publication["fence"]}
                    return {"publicationCommitMs": 0, "publicationStartedEpochMs": request["nowMs"],
                        "receipts": receipts}
                if operation == "goldfish-evidence-finalize":
                    finalized.append(request["evidenceId"])
                    return {"complete": True}
                raise AssertionError(f"unexpected publisher operation {operation}")

            publisher = MagicMock()
            publisher.remote.side_effect = publish
            worker = ImmediateWorker()
            with patch.object(launcher, "verify_strategy_search_source"), \
                    patch.object(launcher, "strategy_search_publisher", publisher), \
                    patch.object(launcher, "strategy_search_goldfish_job", worker), \
                    patch.object(launcher, "_strategy_search_path", side_effect=strategy_path), \
                    patch.object(launcher.volume, "reload"), patch.object(launcher.time, "sleep"):
                report = launcher._strategy_search_controller_impl(bundle)

        self.assertEqual(report["status"], "complete")
        self.assertEqual([job["stage"] for job in holder["state"]["jobs"]],
            ["goldfish-one-reduce", "goldfish-two-reduce"])
        self.assertTrue(all(job["status"] == "complete" for job in holder["state"]["jobs"]))
        self.assertEqual([config["mode"] for config in worker.configs], ["kingdom-one", "kingdom-two"])
        self.assertEqual(leases, [(707 + 600) * 1000, (300 + 600) * 1000])
        self.assertEqual(worker.configs[0]["leaseMs"], leases[0])
        self.assertEqual(worker.configs[1]["leaseMs"], leases[1])
        self.assertEqual(set(report["stageWallMs"]),
            {"goldfish-one-reduce", "goldfish-two-reduce"})
        self.assertTrue(report["goldfishPhaseAccountingValid"])
        self.assertEqual(report["intermediateIoRatio"], 0)
        self.assertTrue(report["goldfishIntermediateIoTargetMet"])
        self.assertGreater(report["candidateThroughputPerSecond"], 0)
        self.assertGreater(report["stageThroughput"]["goldfishCandidatesPerSecond"], 0)
        self.assertEqual(sum(job["result"]["rustReports"]["score"]["rowCount"]
            for job in holder["state"]["jobs"]), 13_472_960)
        self.assertIn("a" * 64, finalized)

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
        goldfish_worker_source = inspect.getsource(launcher._strategy_search_goldfish_single_command) \
            + inspect.getsource(launcher._strategy_search_goldfish_kingdom_stage)
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

    def psro_job_fixture(self, root):
        config = {"sourceImage": {}, "threads": 16, "cpu": 16, "memoryMiB": 8192,
            "kingdomId": "balance-tuning-090", "evidenceId": "a" * 64,
            "launchId": "launch-one", "topPath": "evidence/a/goldfish/top-500000.hgf",
            "reservoirPath": "evidence/a/goldfish/reservoir.hgf",
            "matrixDir": "evidence/a/matrix", "outPath": "psro-executions/run/a"}
        paths = launcher._strategy_search_psro_input_paths(config)
        for index, relative in enumerate(paths):
            file = root / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(f"input-{index}".encode())
        config["inputSha256"] = {relative: hashlib.sha256((root / relative).read_bytes()).hexdigest()
            for relative in paths}
        return config

    def test_psro_wrapper_module_is_importable_from_the_image_layout(self):
        self.assertEqual(launcher.MODAL_SOURCE_ROOT, launcher.PROJECT_ROOT / "modal")
        self.assertIn(str(launcher.MODAL_SOURCE_ROOT), sys.path)
        self.assertTrue((launcher.MODAL_SOURCE_ROOT / "psro_step.py").is_file())

    def test_psro_job_checks_inputs_and_writes_operational_reports(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            config = self.psro_job_fixture(root)
            rust_report = {"elapsedMs": 1_500, "totalGames": 12_000, "gamesPerSecond": 8_000,
                "transitions": [{"elapsedMs": 900}, {"elapsedMs": 300}]}
            run_result = {"report": rust_report, "commitCount": 2, "volumeCommitMs": 50}
            def run_psro(*_args, **kwargs):
                kwargs["on_checkpoint"](7, 123, 1, 25)
                return run_result
            usage = type("Usage", (), {"ru_maxrss": 262_144})()
            with patch.object(launcher, "_strategy_search_path", side_effect=lambda value: root / value), \
                    patch.object(launcher, "verify_strategy_search_source") as verify, \
                    patch("psro_step.run_psro_step", side_effect=run_psro) as run, \
                    patch.object(launcher.modal, "current_function_call_id", return_value="fc-current"), \
                    patch.object(launcher.volume, "reload"), patch.object(launcher.volume, "commit") as commit, \
                    patch.object(launcher.time, "monotonic", side_effect=[10, 12]), \
                    patch.object(launcher.resource, "getrusage", return_value=usage):
                report = launcher._strategy_search_psro_job_impl(config)
            verify.assert_called_once_with(config["sourceImage"])
            self.assertEqual(run.call_args.args[6], 16)
            self.assertEqual(run.call_args.kwargs["commit_interval_seconds"], 600)
            self.assertEqual(run.call_args.kwargs["evidence_id"], config["evidenceId"])
            self.assertFalse(run.call_args.kwargs["deep_verify"])
            self.assertEqual(commit.call_count, 2)
            self.assertEqual(report["totalGames"], 12_000)
            self.assertEqual(report["transitionCount"], 2)
            self.assertAlmostEqual(report["nonTransitionShare"], 0.2)
            self.assertEqual(report["commitCount"], 2)
            self.assertEqual(report["maxResidentSetSizeMiB"], 256)
            expected_cost = 2 * (16 * 0.0000131 + 8 * 0.00000222)
            self.assertAlmostEqual(report["measuredCostUsd"], expected_cost)
            saved = json.loads((root / config["outPath"] / "job-report.json").read_text())
            self.assertEqual(saved["callId"], "fc-current")
            progress = json.loads((root / config["outPath"] / "progress.json").read_text())
            self.assertEqual((progress["checkpointOrdinal"], progress["commitCount"]), (7, 1))

    def test_psro_job_rejects_thread_and_input_hash_changes_before_rust(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            config = self.psro_job_fixture(root)
            with patch.object(launcher, "verify_strategy_search_source"), \
                    patch("psro_step.run_psro_step") as run:
                with self.assertRaisesRegex(ValueError, "threads must equal"):
                    launcher._strategy_search_psro_job_impl({**config, "threads": 15})
                run.assert_not_called()
            changed = root / config["topPath"]
            changed.write_bytes(b"changed")
            with patch.object(launcher, "_strategy_search_path", side_effect=lambda value: root / value), \
                    patch.object(launcher, "verify_strategy_search_source"), \
                    patch.object(launcher.volume, "reload"), \
                    patch("psro_step.run_psro_step") as run:
                with self.assertRaisesRegex(RuntimeError, "input hash differs"):
                    launcher._strategy_search_psro_job_impl(config)
                run.assert_not_called()

    def test_psro_job_rejects_a_live_lease_and_accepts_a_terminal_lease(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            config = self.psro_job_fixture(root)
            out = root / config["outPath"]
            out.mkdir(parents=True, exist_ok=True)
            (out / "lease.json").write_text(json.dumps({"launchId": "old", "callId": "fc-old"}))
            pending = MagicMock()
            pending.get.side_effect = TimeoutError()
            common = [patch.object(launcher, "_strategy_search_path", side_effect=lambda value: root / value),
                patch.object(launcher, "verify_strategy_search_source"), patch.object(launcher.volume, "reload"),
                patch.object(launcher.modal, "current_function_call_id", return_value="fc-current")]
            with common[0], common[1], common[2], common[3], \
                    patch.object(launcher.modal.FunctionCall, "from_id", return_value=pending), \
                    patch("psro_step.run_psro_step") as run:
                with self.assertRaisesRegex(RuntimeError, "duplicate PSRO launch"):
                    launcher._strategy_search_psro_job_impl(config)
                run.assert_not_called()
            terminal = MagicMock()
            terminal.get.return_value = {"complete": True}
            rust_report = {"elapsedMs": 1, "totalGames": 0, "gamesPerSecond": 0, "transitions": []}
            with patch.object(launcher, "_strategy_search_path", side_effect=lambda value: root / value), \
                    patch.object(launcher, "verify_strategy_search_source"), \
                    patch.object(launcher.volume, "reload"), patch.object(launcher.volume, "commit"), \
                    patch.object(launcher.modal, "current_function_call_id", return_value="fc-current"), \
                    patch.object(launcher.modal.FunctionCall, "from_id", return_value=terminal), \
                    patch("psro_step.run_psro_step", return_value={"report": rust_report,
                        "commitCount": 0, "volumeCommitMs": 0}), \
                    patch.object(launcher.resource, "getrusage",
                        return_value=type("Usage", (), {"ru_maxrss": 1024})()):
                report = launcher._strategy_search_psro_job_impl(config)
            self.assertEqual(report["callId"], "fc-current")

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
                "kingdomId": "balance-tuning-001", "sourceImage": {}, "cpu": 4,
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

    def test_goldfish_kingdom_jobs_use_local_scratch_publish_one_final_and_remove_scratch(self):
        for mode, stage, expected_modes, row_count in [
                ("kingdom-one", "goldfish-one-reduce", ["score-one", "reduce-one"], 12_972_960),
                ("kingdom-two", "goldfish-two-reduce", ["score-two", "reduce-two"], 500_000)]:
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                scratch_root = root / "scratch"
                volume_root = root / "results"
                commands = []
                subprocess_timeouts = []
                inputs = []
                events = []
                def strategy_path(relative):
                    return volume_root / relative
                def run_subprocess(command, held_config):
                    commands.append(command)
                    subprocess_timeouts.append(held_config["timeoutSeconds"])
                    output = pathlib.Path(command[command.index("--out") + 1])
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(command[1].encode())
                    report_file = pathlib.Path(command[command.index("--report") + 1])
                    if command[1].startswith("score"):
                        report = {"command": command[1], "rowCount": row_count,
                            "scoringMs": 0, "readMs": 0, "writeMs": 0, "reduceMs": 0}
                    else:
                        inputs.extend(json.loads(pathlib.Path(
                            command[command.index("--inputs") + 1]).read_text()))
                        report = {"command": command[1], "rowCount": 20_000,
                            "scoringMs": 0, "readMs": 0, "writeMs": 0, "reduceMs": 0}
                    report_file.write_text(json.dumps(report))
                    return {"elapsedMs": 1}
                config = {"taskId": "task", "evidenceId": "a" * 64,
                    "kingdomId": "balance-tuning-005", "sourceImage": {}, "cpu": 32,
                    "timeoutSeconds": 707 if mode == "kingdom-one" else 300,
                    "enqueuedEpochMs": int(time.time() * 1000) - 5, "launchId": f"launch-{mode}",
                    "stage": stage, "mode": mode, "temporaryPath": f"temporary/{mode}.hgf"}
                if mode == "kingdom-two":
                    config["topPath"] = f"evidence/{'a' * 64}/goldfish/top-500000.hgf"
                raw = launcher.strategy_search_goldfish_job.get_raw_f()
                with patch.object(launcher, "GOLDFISH_MODAL_SCRATCH_ROOT", scratch_root), \
                        patch.object(launcher, "_strategy_search_path", side_effect=strategy_path), \
                        patch.object(launcher, "_strategy_search_run_subprocess", side_effect=run_subprocess), \
                        patch.object(launcher, "_strategy_search_validate_publication",
                            side_effect=lambda *_args: events.append("validate")), \
                        patch.object(launcher.shutil, "disk_usage",
                            return_value=type("Usage", (), {"free": 3 * 1024 ** 3})()), \
                        patch.object(launcher.volume, "reload"), \
                        patch.object(launcher.volume, "commit", side_effect=lambda: events.append("commit")):
                    result = raw(config)
                self.assertEqual([command[1] for command in commands], expected_modes)
                self.assertEqual(commands[0][commands[0].index("--threads") + 1], "32")
                self.assertEqual(inputs, [(scratch_root / f"launch-{mode}" / "stage.hgs").as_posix()])
                self.assertEqual(["--top" in command for command in commands],
                    [mode == "kingdom-two", mode == "kingdom-two"])
                self.assertTrue(0 < subprocess_timeouts[1] <= subprocess_timeouts[0] <= config["timeoutSeconds"])
                self.assertEqual(events, ["validate", "commit"])
                self.assertEqual(result["scratchFreeBytes"], 3 * 1024 ** 3)
                self.assertEqual(result["rustReports"]["score"]["rowCount"], row_count)
                self.assertEqual(sum(result["phases"][key] for key in ["generationMs", "scoringMs",
                    "intermediateSerializationAndReadMs", "temporaryVolumeWriteCommitMs", "publisherWaitMs",
                    "publicationCommitMs", "reductionComputeMs", "finalTop500000WriteMs",
                    "finalTop20000WriteMs", "orchestrationQueueMs"]), result["elapsedMs"])
                self.assertTrue((volume_root / config["temporaryPath"]).is_file())
                self.assertFalse((scratch_root / f"launch-{mode}").exists())

    def test_goldfish_kingdom_job_fails_before_rust_on_low_disk_and_cleans_failures(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            scratch_root = root / "scratch"
            config = {"taskId": "task", "evidenceId": "a" * 64,
                "kingdomId": "balance-tuning-005", "sourceImage": {}, "cpu": 32,
                "timeoutSeconds": 707, "enqueuedEpochMs": int(time.time() * 1000),
                "launchId": "low-disk", "stage": "goldfish-one-reduce", "mode": "kingdom-one",
                "temporaryPath": "temporary/top.hgf"}
            raw = launcher.strategy_search_goldfish_job.get_raw_f()
            run = MagicMock()
            with patch.object(launcher, "GOLDFISH_MODAL_SCRATCH_ROOT", scratch_root), \
                    patch.object(launcher.shutil, "disk_usage",
                        return_value=type("Usage", (), {"free": 1024})()), \
                    patch.object(launcher, "_strategy_search_run_subprocess", run), \
                    patch.object(launcher.volume, "reload"):
                with self.assertRaisesRegex(RuntimeError, "at least 2 GiB"):
                    raw(config)
            run.assert_not_called()
            self.assertFalse((scratch_root / "low-disk").exists())

            failing = {**config, "launchId": "rust-failure"}
            with patch.object(launcher, "GOLDFISH_MODAL_SCRATCH_ROOT", scratch_root), \
                    patch.object(launcher.shutil, "disk_usage",
                        return_value=type("Usage", (), {"free": 3 * 1024 ** 3})()), \
                    patch.object(launcher, "_strategy_search_run_subprocess",
                        side_effect=RuntimeError("Rust failed")), patch.object(launcher.volume, "reload"):
                with self.assertRaisesRegex(RuntimeError, "Rust failed"):
                    raw(failing)
            self.assertFalse((scratch_root / "rust-failure").exists())

    def test_goldfish_kingdom_job_rejects_impossible_rust_phases_before_publication(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            scratch_root = root / "scratch"
            volume_root = root / "results"
            def run_subprocess(command, _config):
                output = pathlib.Path(command[command.index("--out") + 1])
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(b"artifact")
                score = command[1] == "score-one"
                report = {"command": command[1], "rowCount": 1,
                    "scoringMs": 1_000_000 if score else 0, "readMs": 0,
                    "writeMs": 0, "reduceMs": 0}
                pathlib.Path(command[command.index("--report") + 1]).write_text(json.dumps(report))
                return {"elapsedMs": 1}
            config = {"taskId": "task", "evidenceId": "a" * 64,
                "kingdomId": "balance-tuning-005", "sourceImage": {}, "cpu": 32,
                "timeoutSeconds": 707, "enqueuedEpochMs": int(time.time() * 1000),
                "launchId": "bad-phases", "stage": "goldfish-one-reduce", "mode": "kingdom-one",
                "temporaryPath": "temporary/top.hgf"}
            validate = MagicMock()
            commit = MagicMock()
            raw = launcher.strategy_search_goldfish_job.get_raw_f()
            with patch.object(launcher, "GOLDFISH_MODAL_SCRATCH_ROOT", scratch_root), \
                    patch.object(launcher, "_strategy_search_path",
                        side_effect=lambda relative: volume_root / relative), \
                    patch.object(launcher, "_strategy_search_run_subprocess",
                        side_effect=run_subprocess), \
                    patch.object(launcher, "_strategy_search_validate_publication", validate), \
                    patch.object(launcher.shutil, "disk_usage",
                        return_value=type("Usage", (), {"free": 3 * 1024 ** 3})()), \
                    patch.object(launcher.volume, "reload"), \
                    patch.object(launcher.volume, "commit", commit):
                with self.assertRaisesRegex(RuntimeError, "Rust phases exceed"):
                    raw(config)
            validate.assert_not_called()
            commit.assert_not_called()
            self.assertFalse((volume_root / config["temporaryPath"]).exists())
            self.assertFalse((scratch_root / "bad-phases").exists())

    def test_goldfish_publication_validation_uses_rust_verify_and_top_links(self):
        calls = []
        with patch.object(launcher, "_run_checked", side_effect=lambda command, *_args, **_kwargs: calls.append(command)), \
                patch.object(launcher, "_strategy_search_path", side_effect=lambda relative: pathlib.Path("/results") / relative):
            for stage in ["goldfish-one", "goldfish-two", "goldfish-one-reduce", "goldfish-two-reduce"]:
                publication = {"stage": stage, "kingdomId": "balance-tuning-001",
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
        bundle = self.goldfish_only_bundle()
        bundle.update({"campaignExecutionId": "a" * 64,
            "executionRoot": "executions/" + "a" * 64,
            "sourceImage": {"digest": "b" * 64, "files": []}})
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
            self.assertEqual(state["orderedEvidenceIds"], ["a" * 64])
            self.assertEqual(state["computePreflight"], preflight)
            changed = {**bundle, "jobs": [{"taskId": "different"}]}
            self.assertFalse(raw(changed, preflight)["prepared"])
            self.assertEqual(json.loads(pathlib.Path(directory, "state.json").read_text())["jobs"],
                bundle["jobs"])
            self.assertEqual(commit.call_count, 2)

    def test_strategy_search_route_has_no_recovery_or_budget_gate(self):
        controller_source = inspect.getsource(launcher.strategy_search_controller.get_raw_f())
        module_source = inspect.getsource(launcher)
        runtime_source = inspect.getsource(runtime_launcher)
        self.assertIn("strategy_search_compute_ready", module_source)
        self.assertNotIn("strategy_search_run_entry", module_source)
        self.assertIn('Function.from_name(compute_app_name, "strategy_search_controller")', runtime_source)
        self.assertIn("strategy-search-useful-work-started", runtime_source)
        self.assertNotIn("_NODE_DEPENDENCY_FILES", module_source)
        self.assertIn("_RUST_IMAGE_FILES", module_source)
        self.assertIn("_APPLICATION_IMAGE_FILES", module_source)
        self.assertEqual(module_source.count("image.add_local_dir"), 2)
        self.assertNotIn("image.add_local_file", module_source)
        self.assertIn('from_registry("rust:1.98.0-slim-bookworm"', module_source)
        self.assertNotIn("rustup toolchain install", module_source)
        self.assertNotIn("npm ci", module_source)
        for removed in ["campaign_recover_entry", "campaign_source_repair", "resume-plan"]:
            self.assertNotIn(removed, module_source)


if __name__ == "__main__":
    unittest.main()
