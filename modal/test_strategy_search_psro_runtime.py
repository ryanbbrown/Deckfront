import hashlib
import json
import os
import pathlib
import tempfile
import threading
import unittest
from unittest.mock import patch

import strategy_search_psro_runtime as runtime


class Upload:
    def __init__(self, volume, record):
        self.volume = volume
        self.record = record

    def put_file(self, local, remote):
        self.record["paths"].append(remote)
        self.volume.files[remote] = pathlib.Path(local).read_bytes()


class UploadContext:
    def __init__(self, volume, force):
        self.volume = volume
        self.record = {"force": force, "paths": []}
        self.upload = Upload(volume, self.record)

    def __enter__(self):
        self.volume.batch_uploads.append(self.record)
        return self.upload

    def __exit__(self, *_args):
        return False


class Entry:
    def __init__(self, path, size):
        self.path = path
        self.size = size
        self.type = 1


class Volume:
    def __init__(self, files=None, failures=None):
        self.files = dict(files or {})
        self.failures = dict(failures or {})
        self.reads = []
        self.read_attempts = {}
        self.list_calls = []
        self.batch_uploads = []
        self.lock = threading.Lock()

    def reload(self):
        raise AssertionError("local Modal entrypoints cannot reload a Volume")

    def read_file(self, remote):
        with self.lock:
            self.reads.append(remote)
            self.read_attempts[remote] = self.read_attempts.get(remote, 0) + 1
            attempt = self.read_attempts[remote]
        failure = self.failures.get((remote, attempt))
        if failure:
            raise failure
        if remote not in self.files:
            raise FileNotFoundError(remote)
        return iter([self.files[remote]])

    def batch_upload(self, force=False):
        return UploadContext(self, force)

    def listdir(self, remote, recursive=False):
        self.list_calls.append((remote, recursive))
        return [Entry(path, len(content)) for path, content in self.files.items()
            if path.startswith(remote + "/")]


class ResourceExhaustedError(Exception):
    pass


class Call:
    def __init__(self, object_id, result=None, pending=False, error=None):
        self.object_id = object_id
        self.result = result
        self.pending = pending
        self.error = error

    def get(self, timeout=0):
        del timeout
        if self.pending:
            raise TimeoutError()
        if self.error:
            raise self.error
        return self.result


class Handle:
    def __init__(self, state_file=None):
        self.options = None
        self.calls = []
        self.state_file = state_file

    def with_options(self, **options):
        self.options = options
        return self

    def spawn(self, _config):
        if self.calls:
            state = json.loads(pathlib.Path(self.state_file).read_text())
            if state["attempts"][0]["callId"] != "fc-1":
                raise AssertionError("the first call ID was not persisted before the next spawn")
        call = Call(f"fc-{len(self.calls) + 1}", result={"complete": True})
        self.calls.append(call)
        return call


class PsroRuntimeTests(unittest.TestCase):
    def launch_fixture(self, root):
        state_file = root / "state.json"
        attempts = [{"kingdomId": kingdom, "launchId": f"launch-{index}", "callId": None,
            "status": "launching", "remoteOutPath": f"psro/run/evidence-{index}"}
            for index, kingdom in enumerate(["balance-tuning-005", "balance-tuning-090"], 1)]
        state_file.write_text(json.dumps({"attempts": attempts}))
        launch_intent = root / "launch-intent.json"
        launch_intent.write_text("{}\n")
        matrix_one = root / "matrix-one.hgm"; matrix_one.write_bytes(b"matching")
        matrix_two = root / "matrix-two.hgm"; matrix_two.write_bytes(b"upload")
        kingdoms = []
        for index, attempt in enumerate(attempts, 1):
            matrix = matrix_one if index == 1 else matrix_two
            remote_matrix = f"evidence/evidence-{index}/matrix/matrix.hgm"
            kingdoms.append({"kingdomId": attempt["kingdomId"], "launchId": attempt["launchId"],
                "goldfishPaths": [f"evidence/evidence-{index}/goldfish/top-500000.hgf",
                    f"evidence/evidence-{index}/goldfish/reservoir.hgf"],
                "matrixUploads": [{"localPath": str(matrix), "remotePath": remote_matrix,
                    "sha256": hashlib.sha256(matrix.read_bytes()).hexdigest()}],
                "jobConfig": {"kingdomId": attempt["kingdomId"]}})
        config = {"computeAppName": "compute", "workerCores": 16, "timeoutSeconds": 7260,
            "slots": 2, "launchIntentFile": str(launch_intent),
            "launchIntentRemote": "psro/run/launch-intent.json", "kingdoms": kingdoms}
        files = {path: b"goldfish" for kingdom in kingdoms for path in kingdom["goldfishPaths"]}
        files[kingdoms[0]["matrixUploads"][0]["remotePath"]] = b"matching"
        return state_file, config, Volume(files)

    def test_launch_pins_resources_uploads_only_missing_matrix_and_persists_each_call(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            state_file, config, volume = self.launch_fixture(root)
            handle = Handle(state_file)
            function = type("Function", (), {"from_name": staticmethod(lambda *_args: handle)})
            with patch.object(runtime, "volume", volume), patch.object(runtime.modal, "Function", function):
                result = runtime.launch(config, str(state_file))
            self.assertEqual(handle.options, {"cpu": 16, "memory": 8192, "timeout": 7260,
                "max_containers": 2, "retries": 0, "scaledown_window": 10})
            self.assertEqual([entry["status"] for entry in result["uploads"]], ["matching", "uploaded"])
            self.assertEqual(result["uploadBytes"], len(b"upload"))
            state = json.loads(state_file.read_text())
            self.assertEqual([entry["callId"] for entry in state["attempts"]], ["fc-1", "fc-2"])
            self.assertEqual(volume.batch_uploads, [
                {"force": False, "paths": [config["kingdoms"][1]["matrixUploads"][0]["remotePath"]]},
                {"force": True, "paths": ["psro/run/launch-intent.json"]}])
            self.assertIn("psro/run/launch-intent.json", volume.files)

    def test_launch_rejects_a_missing_goldfish_input_before_any_upload(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            state_file, config, volume = self.launch_fixture(root)
            missing = config["kingdoms"][1]["goldfishPaths"][0]
            del volume.files[missing]
            with patch.object(runtime, "volume", volume):
                with self.assertRaisesRegex(RuntimeError, missing):
                    runtime.launch(config, str(state_file))
            self.assertEqual(volume.batch_uploads, [])

    def test_launch_uploads_all_missing_matrix_inputs_in_one_batch(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            state_file, config, volume = self.launch_fixture(root)
            first_remote = config["kingdoms"][0]["matrixUploads"][0]["remotePath"]
            del volume.files[first_remote]
            handle = Handle(state_file)
            function = type("Function", (), {"from_name": staticmethod(lambda *_args: handle)})
            with patch.object(runtime, "volume", volume), patch.object(runtime.modal, "Function", function):
                result = runtime.launch(config, str(state_file))
            matrix_paths = [kingdom["matrixUploads"][0]["remotePath"] for kingdom in config["kingdoms"]]
            self.assertEqual([entry["status"] for entry in result["uploads"]], ["uploaded", "uploaded"])
            self.assertEqual(volume.batch_uploads, [{"force": False, "paths": matrix_paths},
                {"force": True, "paths": ["psro/run/launch-intent.json"]}])

    def test_launch_retries_a_rate_limited_existence_check(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            state_file, config, volume = self.launch_fixture(root)
            remote = config["kingdoms"][0]["goldfishPaths"][0]
            volume.failures[(remote, 1)] = ResourceExhaustedError("limited")
            handle = Handle(state_file)
            function = type("Function", (), {"from_name": staticmethod(lambda *_args: handle)})
            retry = runtime.retry_resource_exhausted
            sleeps = []
            with patch.object(runtime, "volume", volume), patch.object(runtime.modal, "Function", function), \
                    patch.object(runtime, "retry_resource_exhausted",
                        side_effect=lambda operation: retry(operation, sleeps.append)):
                runtime.launch(config, str(state_file))
            self.assertEqual(volume.read_attempts[remote], 2)
            self.assertEqual(sleeps, [2])

    def test_launch_rejects_a_differing_matrix_before_any_spawn(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            state_file, config, volume = self.launch_fixture(root)
            volume.files[config["kingdoms"][0]["matrixUploads"][0]["remotePath"]] = b"different"
            handle = Handle(state_file)
            function = type("Function", (), {"from_name": staticmethod(lambda *_args: handle)})
            with patch.object(runtime, "volume", volume), patch.object(runtime.modal, "Function", function):
                with self.assertRaisesRegex(RuntimeError, "Matrix input differs"):
                    runtime.launch(config, str(state_file))
            self.assertEqual(volume.batch_uploads, [])
            self.assertEqual(handle.calls, [])

    def test_status_adopts_a_matching_lease_and_reattaches_to_calls(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            state_file = root / "state.json"
            state_file.write_text(json.dumps({"attempts": [
                {"kingdomId": "one", "launchId": "launch-one", "callId": None,
                    "status": "unknown", "remoteOutPath": "psro/one"},
                {"kingdomId": "two", "launchId": "launch-two", "callId": "fc-two",
                    "status": "pending", "remoteOutPath": "psro/two"},
                {"kingdomId": "old", "launchId": "launch-old", "callId": None,
                    "status": "abandoned", "remoteOutPath": "psro/old"}]}))
            volume = Volume({"psro/one/lease.json": json.dumps({"launchId": "launch-one",
                "callId": "fc-one"}).encode(), "psro/one/progress.json": json.dumps({
                    "checkpointOrdinal": 7}).encode()})
            calls = {"fc-one": Call("fc-one", pending=True),
                "fc-two": Call("fc-two", result={"totalGames": 12})}
            function_call = type("FunctionCall", (), {"from_id": staticmethod(lambda call_id: calls[call_id])})
            with patch.object(runtime, "volume", volume), \
                    patch.object(runtime.modal, "FunctionCall", function_call):
                result = runtime.status(str(state_file))
            self.assertEqual(result["attempts"][0]["state"], "pending")
            self.assertEqual(result["attempts"][0]["progress"]["checkpointOrdinal"], 7)
            state = json.loads(state_file.read_text())
            self.assertEqual(state["attempts"][0]["callId"], "fc-one")
            self.assertTrue(state["attempts"][0]["adoptedFromLease"])
            self.assertEqual(state["attempts"][1]["status"], "complete")
            self.assertEqual(state["attempts"][2]["status"], "abandoned")
            self.assertEqual(result["attempts"][2]["state"], "abandoned")

    def test_status_reads_only_files_needed_for_each_attempt_and_writes_state_once(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            state_file = root / "state.json"
            state_file.write_text(json.dumps({"attempts": [
                {"kingdomId": "stored", "launchId": "stored", "callId": "fc-stored",
                    "status": "complete", "result": {"stored": True}, "remoteOutPath": "psro/stored"},
                {"kingdomId": "fallback", "launchId": "fallback", "callId": "fc-fallback",
                    "status": "complete", "remoteOutPath": "psro/fallback"},
                {"kingdomId": "unknown", "launchId": "unknown", "callId": None,
                    "status": "unknown", "remoteOutPath": "psro/unknown"},
                {"kingdomId": "pending", "launchId": "pending", "callId": "fc-pending",
                    "status": "pending", "remoteOutPath": "psro/pending"},
                {"kingdomId": "finished", "launchId": "finished", "callId": "fc-finished",
                    "status": "pending", "remoteOutPath": "psro/finished"}]}))
            volume = Volume({"psro/fallback/job-report.json": b'{"fallback":true}',
                "psro/pending/progress.json": b'{"step":1}',
                "psro/finished/progress.json": b'{"step":2}',
                "psro/finished/job-report.json": b'{"finished":true}'})
            calls = {"fc-pending": Call("fc-pending", pending=True),
                "fc-finished": Call("fc-finished", result={"complete": True})}
            function_call = type("FunctionCall", (), {
                "from_id": staticmethod(lambda call_id: calls[call_id])})
            original_atomic = runtime._atomic_json
            writes = []
            def recording_atomic(file, value):
                writes.append(file)
                original_atomic(file, value)
            with patch.object(runtime, "volume", volume), \
                    patch.object(runtime.modal, "FunctionCall", function_call), \
                    patch.object(runtime, "_atomic_json", recording_atomic):
                result = runtime.status(str(state_file))
            self.assertEqual(writes, [str(state_file)])
            self.assertEqual(result["attempts"][0]["jobReport"], {"stored": True})
            self.assertEqual(result["attempts"][1]["jobReport"], {"fallback": True})
            self.assertEqual(result["attempts"][3]["progress"], {"step": 1})
            self.assertEqual(result["attempts"][4]["jobReport"], {"finished": True})
            self.assertCountEqual(volume.reads, ["psro/fallback/job-report.json",
                "psro/unknown/lease.json", "psro/pending/progress.json",
                "psro/finished/progress.json", "psro/finished/job-report.json"])

    def test_download_excludes_operational_files_and_replaces_the_destination(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            destination = root / "kingdom" / "psro"
            destination.mkdir(parents=True)
            (destination / "stale").write_text("old")
            remote = "psro/run/evidence"
            volume = Volume({f"{remote}/checkpoint.hpc": b"checkpoint",
                f"{remote}/search-0001/screen-0008.hpl": b"look",
                f"{remote}/run-report.json": b"{}", f"{remote}/lease.json": b"{}",
                f"{remote}/progress.json": b"{}", f"{remote}/job-report.json": b"{}"})
            config = {"kingdoms": [{"kingdomId": "balance-tuning-090",
                "remoteOutPath": remote, "destination": str(destination)}]}
            with patch.object(runtime, "volume", volume):
                result = runtime.download(config)
            self.assertEqual(sorted(entry["relative"] for entry in result["artifacts"]),
                ["checkpoint.hpc", "run-report.json", "search-0001/screen-0008.hpl"])
            self.assertFalse((destination / "stale").exists())
            self.assertFalse((destination / "lease.json").exists())
            self.assertEqual((destination / "checkpoint.hpc").read_bytes(), b"checkpoint")
            self.assertEqual(result["concurrency"], 16)
            self.assertEqual(result["kingdoms"], [{"kingdomId": "balance-tuning-090",
                "files": 3, "bytes": 16}])
            self.assertTrue(all("wallMs" in entry for entry in result["artifacts"]))

    def test_download_lists_each_distinct_execution_parent_once(self):
        cases = [
            (["psro-executions/run/one", "psro-executions/run/two"],
                [("psro-executions/run", True)]),
            (["psro-executions/run-one/one", "psro-executions/run-two/two"],
                [("psro-executions/run-one", True), ("psro-executions/run-two", True)])]
        for remote_roots, expected_calls in cases:
            with self.subTest(remote_roots=remote_roots), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                volume = Volume({f"{remote_root}/file": remote_root.encode()
                    for remote_root in remote_roots})
                config = {"kingdoms": [{"kingdomId": str(index), "remoteOutPath": remote_root,
                    "destination": str(root / str(index))}
                    for index, remote_root in enumerate(remote_roots)]}
                with patch.object(runtime, "volume", volume):
                    runtime.download(config)
                self.assertEqual(volume.list_calls, expected_calls)

    def test_download_replaces_no_destination_until_every_download_succeeds(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            destinations = [root / "one", root / "two"]
            for destination in destinations:
                destination.mkdir()
                (destination / "old").write_text("unchanged")
            class FailingVolume(Volume):
                def read_file(self, remote):
                    if remote == "psro/two/file":
                        raise FileNotFoundError("download failed")
                    return super().read_file(remote)
            volume = FailingVolume({"psro/one/file": b"one", "psro/two/file": b"two"})
            config = {"kingdoms": [{"kingdomId": str(index), "remoteOutPath": f"psro/{name}",
                "destination": str(destination)} for index, (name, destination)
                in enumerate(zip(["one", "two"], destinations), 1)]}
            with patch.object(runtime, "volume", volume):
                with self.assertRaisesRegex(FileNotFoundError, "download failed"):
                    runtime.download(config)
            self.assertEqual([(destination / "old").read_text() for destination in destinations],
                ["unchanged", "unchanged"])
            self.assertCountEqual([entry.name for entry in root.iterdir()], ["one", "two"])

    def test_replacement_failure_restores_the_current_kingdom_and_cleans_temporaries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            destinations = [root / "one", root / "two"]
            for destination in destinations:
                destination.mkdir()
                (destination / "old").write_text("unchanged")
            volume = Volume({"psro/one/file": b"one", "psro/two/file": b"two"})
            config = {"kingdoms": [{"kingdomId": name, "remoteOutPath": f"psro/{name}",
                "destination": str(destination)} for name, destination in zip(["one", "two"], destinations)]}
            real_replace = os.replace
            failed = False
            def fail_second_temporary(source, destination):
                nonlocal failed
                source_path = pathlib.Path(source)
                if not failed and pathlib.Path(destination) == destinations[1] \
                        and source_path.name.startswith(".two-"):
                    failed = True
                    raise OSError("second replacement failed")
                return real_replace(source, destination)
            with patch.object(runtime, "volume", volume), \
                    patch.object(runtime.os, "replace", side_effect=fail_second_temporary):
                with self.assertRaisesRegex(OSError, "second replacement failed"):
                    runtime.download(config)
            self.assertEqual((destinations[0] / "file").read_bytes(), b"one")
            self.assertFalse((destinations[0] / "old").exists())
            self.assertEqual((destinations[1] / "old").read_text(), "unchanged")
            self.assertFalse((destinations[1] / "file").exists())
            self.assertCountEqual([entry.name for entry in root.iterdir()], ["one", "two"])

    def test_download_replaces_every_destination_after_all_downloads_succeed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            destinations = [root / "one", root / "two"]
            for destination in destinations:
                destination.mkdir()
                (destination / "old").write_text("stale")
            volume = Volume({"psro/one/file": b"one", "psro/two/file": b"two"})
            config = {"kingdoms": [{"kingdomId": name, "remoteOutPath": f"psro/{name}",
                "destination": str(destination)} for name, destination in zip(["one", "two"], destinations)]}
            with patch.object(runtime, "volume", volume):
                result = runtime.download(config)
            self.assertEqual([(destination / "file").read_bytes() for destination in destinations],
                [b"one", b"two"])
            self.assertEqual(result["bytes"], 6)

    def test_preflight_requires_compute_and_psro_runtime_readiness(self):
        names = []
        ready = type("Ready", (), {"remote": staticmethod(lambda _source: {
            "ready": True, "sourceDigest": "a" * 64})})()
        def from_name(_app, name):
            names.append(name)
            return ready
        function = type("Function", (), {"from_name": staticmethod(from_name)})
        with patch.object(runtime.modal, "Function", function):
            result = runtime.preflight("compute", {"digest": "a" * 64})
        self.assertEqual(names, ["strategy_search_compute_ready", "strategy_search_psro_ready"])
        self.assertEqual(result["psroReady"], {"ready": True, "sourceDigest": "a" * 64})
        self.assertEqual(result["computeAppName"], "compute")


if __name__ == "__main__":
    unittest.main()
