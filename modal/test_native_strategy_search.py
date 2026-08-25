import json
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import native_strategy_search as launcher


class NativeStrategySearchLauncherTest(unittest.TestCase):
    def test_worst_case_includes_all_retry_attempts(self):
        value = launcher.projected_cost_usd(2, 4, 4, 600, 2)
        expected = (2 * 3 * (630 / 3600) * (4 * 0.0473 + 4 * 0.008)
                    + (3 * 1 * 630 + 300) / 3600 * (0.0473 + 0.008))
        self.assertAlmostEqual(value, expected)

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

    def test_production_typescript_helper_generates_the_ordered_shard(self):
        with tempfile.TemporaryDirectory() as directory:
            request = pathlib.Path(directory) / "request.jsonl"
            metadata = pathlib.Path(directory) / "metadata.json"
            subprocess.run(["npx", "tsx", "scripts/native_ordered_shard_input.ts",
                "--start-position", "0", "--end-position", "500", "--threads", "1", "--cpu", "1",
                "--shuffles", "1", "--request", str(request), "--metadata", str(metadata)], check=True)
            payload = json.loads(request.read_text())["payload"]
            held = json.loads(metadata.read_text())
            self.assertEqual(len(payload["strategies"]), 500)
            self.assertEqual(payload["strategies"][0]["id"], "sg-1d1fcdb6c1")
            self.assertEqual(held["candidateDigest"], "fa0328fb18315")
            self.assertEqual(held["completeCount"], 500)

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
        spec = {"run_id": "run", "shard_id": 1, "start_position": 10, "end_position": 20,
                "rule_fingerprint": "rules", "build_version": "build"}
        result = {"schemaVersion": 1, "status": "success", "runId": "run", "shardId": 1,
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


if __name__ == "__main__":
    unittest.main()
