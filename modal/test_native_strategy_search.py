import json
import pathlib
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

    def test_python_traversal_matches_typescript_fixture_and_digest(self):
        cards = ["channel", "focus", "gold", "improvise", "longshot", "precisionShot", "reclaim",
                 "reforge", "salvageShot", "scour", "sharpen", "silver", "step", "strike"]
        strategy, canonical = launcher._strategy_at(2_500_427, cards)
        self.assertEqual(strategy["id"], "sg-1d1fcdb6c1")
        self.assertEqual(canonical, '{"buyPlan":[["buy","gold",1],["buy","sharpen",3],'
                         '["buy","channel",4],["buy","strike",3],["buy","reclaim",3],'
                         '["inactive"],["inactive"],["inactive"],["inactive"],["inactive"]],'
                         '"startingBuild":[]}')
        canonicals = [launcher._strategy_at((2_500_427 + position * 7_951_921)
                      % launcher.FULL_CANDIDATE_COUNT, cards)[1] for position in range(500)]
        self.assertEqual(launcher._stable_hash(canonicals), "fa0328fb18315")

    def test_controller_claim_blocks_duplicates_and_allows_failed_resume(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = pathlib.Path(directory) / "ledger.json"
            with patch.object(launcher, "LEDGER_PATH", ledger):
                launcher.reserve_cost("run", 1.0, False, {"a": 1})
                self.assertTrue(launcher.claim_controller("run", 60))
                self.assertFalse(launcher.claim_controller("run", 60))
                launcher.update_run_status("run", "reserved")
                self.assertTrue(launcher.claim_controller("run", 60))

    def test_result_validation_rejects_partial_and_stale_checkpoints(self):
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


if __name__ == "__main__":
    unittest.main()
