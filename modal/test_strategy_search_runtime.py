import pathlib
import tempfile
import unittest
from unittest.mock import patch

import strategy_search_runtime as runtime


class Entry:
    def __init__(self, path, size):
        self.path = path
        self.size = size


class FakeVolume:
    def __init__(self, files):
        self.files = files

    def read_file(self, path):
        value = self.files[path]
        yield value[:1]
        yield value[1:]

    def listdir(self, directory):
        return [Entry(path, len(value)) for path, value in self.files.items()
            if pathlib.PurePosixPath(path).parent.as_posix() == directory]


class StrategySearchRuntimeTest(unittest.TestCase):
    def test_completed_reused_execution_does_not_wait_for_new_work(self):
        self.assertEqual(runtime._startup_progress_state({"status": "complete",
            "usefulWorkStarted": False, "submittedTaskCount": 0, "completedTaskCount": 1}), "complete")
        self.assertEqual(runtime._startup_progress_state({"status": "running",
            "usefulWorkStarted": True, "submittedTaskCount": 1, "completedTaskCount": 0}), "useful-work")
        self.assertEqual(runtime._startup_progress_state({"status": "running",
            "usefulWorkStarted": False, "submittedTaskCount": 0, "completedTaskCount": 0}), "waiting")
        self.assertEqual(runtime._startup_progress_state({"status": "failed"}), "failed")

    def test_goldfish_only_route_selects_only_final_goldfish_files(self):
        bundle = {"controller": {"route": "goldfish-only-v2"}}
        self.assertEqual(runtime._final_artifact_relatives(bundle),
            ["goldfish/top-500000.hgf", "goldfish/reservoir.hgf"])
        self.assertEqual(runtime._final_artifact_relatives({"controller": {}}),
            ["goldfish/top-500000.hgf", "goldfish/reservoir.hgf",
             "matrix/evidence.json", "psro/evidence.json"])

    def test_final_downloads_measure_each_artifact_and_total_bytes(self):
        evidence_id = "a" * 64
        relatives = ["goldfish/top-500000.hgf", "goldfish/reservoir.hgf"]
        files = {f"evidence/{evidence_id}/{relatives[0]}": b"t" * runtime.GOLDFISH_TOP_BYTES,
            f"evidence/{evidence_id}/{relatives[1]}": b"r" * runtime.GOLDFISH_RESERVOIR_BYTES}
        with tempfile.TemporaryDirectory() as directory, patch.object(runtime, "volume", FakeVolume(files)):
            result = runtime._download_final_artifacts(pathlib.Path(directory), [evidence_id], relatives)
            self.assertEqual(result["bytes"], runtime.GOLDFISH_TOP_BYTES + runtime.GOLDFISH_RESERVOIR_BYTES)
            self.assertEqual([entry["path"] for entry in result["artifacts"]], list(files))
            self.assertEqual([entry["bytes"] for entry in result["artifacts"]],
                [runtime.GOLDFISH_TOP_BYTES, runtime.GOLDFISH_RESERVOIR_BYTES])
            self.assertTrue(all(entry["wallMs"] >= 0 for entry in result["artifacts"]))
            for remote, content in files.items():
                self.assertEqual((pathlib.Path(directory) / remote).read_bytes(), content)

    def test_final_download_rejects_a_truncated_goldfish_stream(self):
        evidence_id = "a" * 64
        remote = f"evidence/{evidence_id}/goldfish/top-500000.hgf"
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(runtime, "volume", FakeVolume({remote: b"short"})), \
                patch("volume_download._RETRY_DELAYS_SECONDS", (0, 0, 0)):
            with self.assertRaisesRegex(RuntimeError, "expected 32000064, received 5"):
                runtime._download_final_artifacts(pathlib.Path(directory), [evidence_id],
                    ["goldfish/top-500000.hgf"])

    def test_volume_download_is_not_imported_at_module_level(self):
        self.assertFalse(hasattr(runtime, "volume_download"))


if __name__ == "__main__":
    unittest.main()
