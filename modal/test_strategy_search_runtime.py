import pathlib
import tempfile
import unittest
from unittest.mock import patch

import strategy_search_runtime as runtime


class FakeVolume:
    def __init__(self, files):
        self.files = files

    def read_file(self, path):
        value = self.files[path]
        yield value[:1]
        yield value[1:]


class StrategySearchRuntimeTest(unittest.TestCase):
    def test_goldfish_only_route_selects_only_final_goldfish_files(self):
        bundle = {"controller": {"route": "goldfish-only-v1"}}
        self.assertEqual(runtime._final_artifact_relatives(bundle),
            ["goldfish/top-500000.hgf", "goldfish/reservoir.hgf"])
        self.assertEqual(runtime._final_artifact_relatives({"controller": {}}),
            ["goldfish/top-500000.hgf", "goldfish/reservoir.hgf",
             "matrix/evidence.json", "psro/evidence.json"])

    def test_final_downloads_measure_each_artifact_and_total_bytes(self):
        evidence_id = "a" * 64
        relatives = ["goldfish/top-500000.hgf", "goldfish/reservoir.hgf",
                     "matrix/evidence.json", "psro/evidence.json"]
        files = {f"evidence/{evidence_id}/{relative}": bytes(range(index + 2))
                 for index, relative in enumerate(relatives)}
        with tempfile.TemporaryDirectory() as directory, patch.object(runtime, "volume", FakeVolume(files)):
            result = runtime._download_final_artifacts(pathlib.Path(directory), [evidence_id])
            self.assertEqual(result["bytes"], sum(map(len, files.values())))
            self.assertEqual([entry["path"] for entry in result["artifacts"]], list(files))
            self.assertEqual([entry["bytes"] for entry in result["artifacts"]],
                             list(map(len, files.values())))
            self.assertTrue(all(entry["wallMs"] >= 0 for entry in result["artifacts"]))
            for remote, content in files.items():
                self.assertEqual((pathlib.Path(directory) / remote).read_bytes(), content)


if __name__ == "__main__":
    unittest.main()
