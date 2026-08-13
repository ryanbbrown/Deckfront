#!/usr/bin/env python3
"""Regression tests for alternating-activation harness helpers."""

from __future__ import annotations

import json
import tempfile
import time
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

from playtest_context import activation_options, state_briefing
from run_game import expected_next_step_id, read_json, recover_uncommitted_turn, validate_reset_run_dir, write_json
from run_game_thinharness import (
    Activation,
    Player,
    SetupActions,
    StepTools,
    SubmitSetupArgs,
    Upgrade,
    activation_payload,
    closest_legal_coord,
    normalize_deck_actions,
    parse_args,
    prepare_run_strategies,
    finalize_timing,
    record_timing,
    record_validation_timing,
    record_submission,
    terminal_events,
    unspent_affordable_upgrades,
)


class RunGameHelpersTest(unittest.TestCase):
    def test_uses_conventional_step_ids(self) -> None:
        self.assertEqual(expected_next_step_id({"entries": [{"id": "step-001"}]}), "step-002")
        with self.assertRaisesRegex(RuntimeError, "expected step-001"):
            expected_next_step_id({"entries": [{"id": "turn-001"}]})

    def test_recovers_a_partial_setup_step(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            before = deck_state("P1")
            board = {"turn": {"phase": "setup", "activePlayer": "P1"}, "units": []}
            write_json(run_dir / "timeline.json", {"entries": []})
            write_json(run_dir / "board.json", board)
            write_json(run_dir / "deck.json", deck_state("P2"))
            write_json(run_dir / "snapshots" / "step-001.before.deck.json", before)
            write_json(run_dir / "actions" / "step-001.deck.json", {"partial": True})
            recover_uncommitted_turn(run_dir)
            self.assertEqual(read_json(run_dir / "deck.json"), before)
            self.assertEqual(read_json(run_dir / "board.json"), board)
            self.assertTrue((run_dir / "interrupted" / "step-001" / "attempt-001" / "actions" / "step-001.deck.json").exists())

    def test_activation_phase_does_not_require_deck_active_player_match(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            write_json(run_dir / "timeline.json", {"entries": []})
            write_json(run_dir / "board.json", {"turn": {"phase": "activation", "activePlayer": "P1"}, "units": []})
            write_json(run_dir / "deck.json", deck_state("P2"))
            recover_uncommitted_turn(run_dir)

    def test_activation_briefing_omits_deck_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            write_json(run_dir / "board.json", {"turn": {"phase": "activation", "activePlayer": "P1", "activatedUnitIds": [], "activationCounts": {"P1": 0, "P2": 0}}, "units": [
                {"id": "p1", "type": "soldier", "player": "P1", "col": 0, "row": 5, "movement": 3, "range": 1},
                {"id": "p2", "type": "soldier", "player": "P2", "col": 8, "row": 11, "movement": 3, "range": 1},
            ]})
            briefing = state_briefing(run_dir, "P1")
            self.assertNotIn("deckPhase", briefing)
            self.assertNotIn("handIndexed", briefing)
            self.assertNotIn("deckResources", briefing)
            self.assertNotIn("market", briefing)

    def test_recovers_a_partial_activation_from_latest_setup_deck(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            deck_after_setup = deck_state("P2")
            board_after_activation = {"turn": {"phase": "activation", "activePlayer": "P1"}, "units": []}
            timeline = {"entries": [
                {"id": "step-001", "phase": "setup", "deck": {"after": "snapshots/step-001.after.deck.json"}, "board": {"after": "snapshots/step-001.after.board.json"}},
                {"id": "step-002", "phase": "activation", "board": {"after": "snapshots/step-002.after.board.json"}},
            ]}
            write_json(run_dir / "timeline.json", timeline)
            write_json(run_dir / "deck.json", deck_state("P1"))
            write_json(run_dir / "board.json", {"turn": {"phase": "activation", "activePlayer": "P2"}, "units": []})
            write_json(run_dir / "snapshots" / "step-001.after.deck.json", deck_after_setup)
            write_json(run_dir / "snapshots" / "step-001.after.board.json", board_after_activation)
            write_json(run_dir / "snapshots" / "step-002.after.board.json", board_after_activation)
            write_json(run_dir / "actions" / "step-003.board.json", {"partial": True})
            recover_uncommitted_turn(run_dir)
            self.assertEqual(read_json(run_dir / "deck.json"), deck_after_setup)
            self.assertEqual(read_json(run_dir / "board.json"), board_after_activation)

    def test_briefing_lists_only_unactivated_units(self) -> None:
        board = {
            "turn": {"phase": "activation", "activatedUnitIds": ["used"], "activationCounts": {"P1": 1, "P2": 0}},
            "units": [
                {"id": "used", "type": "soldier", "player": "P1", "col": 0, "row": 0, "movement": 3, "range": 1},
                {"id": "ready", "type": "soldier", "player": "P1", "col": 1, "row": 0, "movement": 3, "range": 1},
                {"id": "enemy", "type": "soldier", "player": "P2", "col": 3, "row": 0, "movement": 3, "range": 1},
            ],
        }
        map_data = {"hexes": [{"col": col, "row": 0} for col in range(5)], "blocked": [], "keyPoints": []}
        options = activation_options(board, map_data, "P1", {"soldier": {"canUpgradeRange": False}}, {"maxActivationsPerPlayer": 3})
        self.assertEqual([option["unit"] for option in options], ["ready"])

    def test_activation_options_use_persisted_stats_without_reapplying_key_point(self) -> None:
        board = {"turn": {"phase": "activation", "activatedUnitIds": [], "activationCounts": {"P1": 0, "P2": 0}}, "units": [
            {"id": "archer", "type": "archer", "player": "P1", "col": 0, "row": 0, "movement": 0, "range": 3},
            {"id": "enemy", "type": "soldier", "player": "P2", "col": 3, "row": 0, "movement": 0, "range": 1},
        ]}
        map_data = {"hexes": [{"col": col, "row": 0} for col in range(5)], "blocked": [], "keyPoints": [{"id": "range", "stat": "range", "col": 0, "row": 0}]}
        [option] = activation_options(board, map_data, "P1", {"archer": {"canUpgradeRange": True}}, {"maxActivationsPerPlayer": 3})
        self.assertEqual(option["range"], 3)

    def test_activation_options_are_empty_after_three_activations(self) -> None:
        board = {"turn": {"phase": "activation", "activatedUnitIds": ["used-1", "used-2", "used-3"], "activationCounts": {"P1": 3, "P2": 0}}, "units": [
            {"id": "ready", "type": "soldier", "player": "P1", "col": 1, "row": 0, "movement": 3, "range": 1},
            {"id": "enemy", "type": "soldier", "player": "P2", "col": 3, "row": 0, "movement": 3, "range": 1},
        ]}
        map_data = {"hexes": [{"col": col, "row": 0} for col in range(5)], "blocked": [], "keyPoints": []}
        self.assertEqual(activation_options(board, map_data, "P1", {"soldier": {"canUpgradeRange": False}}, {"maxActivationsPerPlayer": 3}), [])

    def test_activation_payload_derives_path_and_target(self) -> None:
        options = [{"unit": "archer", "from": {"col": 0, "row": 0}, "noAttackTo": [], "attackChoicesByVia": [{"via": {"col": 2, "row": 0}, "attacks": [{"id": "archer@2,0>enemy", "target": "enemy"}], "to": [{"col": 2, "row": 1}]}]}]
        payload = activation_payload(Activation(unit="archer", attackPlan="archer@2,0>enemy", to={"col": 3, "row": 1}), options)
        self.assertEqual(payload, {"unit": "archer", "from": {"col": 0, "row": 0}, "via": {"col": 2, "row": 0}, "attack": {"target": "enemy"}, "to": {"col": 2, "row": 1}})

    def test_setup_rejects_unspent_affordable_upgrade(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            write_json(run_dir / "board.json", {"turn": {"phase": "setup", "activePlayer": "P1"}, "units": []})
            write_json(run_dir / "timeline.json", {"entries": []})
            write_json(run_dir / "results" / "step-001.deck.result.json", {"produced": {"soldierAttack": 2}})
            tools = StepTools(Namespace(), run_dir, Player("P1", "test"), "step-001", 0, "setup")
            tools.deck_done = True
            briefing = {"legalUpgrades": [{"target": "s", "stat": "attack", "to": 2, "lane": "soldierAttack", "cost": 2, "available": 2}]}
            with patch("run_game_thinharness.state_briefing", return_value=briefing):
                result = tools.submit_setup(SubmitSetupArgs(actions=SetupActions(), summary="Setup.", reasoning="Hold."))
            self.assertFalse(result.ok)
            self.assertIn("Affordable upgrades remain unspent", result.content)

    def test_terminal_events_count_completed_rounds(self) -> None:
        board = {"players": ["P1", "P2"], "turn": {"round": 4}, "units": [{"player": "P1", "hp": 3}]}
        [event] = terminal_events(board, 20)
        self.assertEqual(event["completedRounds"], 3)
        self.assertEqual(event["type"], "elimination")

    def test_records_phase_timings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            record_timing(run_dir, "step-001", "activation", "P1", time.monotonic() - 0.01)
            timing = read_json(run_dir / "timings.json")
            self.assertGreater(timing["activationSeconds"], 0)
            self.assertEqual(timing["steps"][0]["phase"], "activation")

    def test_records_validation_timing_and_preserves_total(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            record_validation_timing(run_dir, "final", time.monotonic() - 0.01)
            timing = read_json(run_dir / "timings.json")
            self.assertGreater(timing["validationSeconds"], 0)
            self.assertEqual(timing["validations"][0]["kind"], "final")
            timing["totalGameSeconds"] = 12.5
            write_json(run_dir / "timings.json", timing)
            finalize_timing(run_dir, time.monotonic())
            self.assertEqual(read_json(run_dir / "timings.json")["totalGameSeconds"], 12.5)

    def test_records_dynamic_setup_and_activation_phases(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            record_submission(run_dir, "step-001", "P1", "setup", {"x": 1}, accepted=True)
            record_submission(run_dir, "step-002", "P1", "activation", {"x": 2}, accepted=True)
            metrics = read_json(run_dir / "submission-metrics.json")
            self.assertEqual(metrics["totals"]["setup"]["accepted"], 1)
            self.assertEqual(metrics["totals"]["activation"]["accepted"], 1)

    def test_reports_affordable_upgrades_left(self) -> None:
        legal = [{"target": "left", "stat": "attack", "to": 2, "lane": "soldierAttack", "cost": 2, "available": 4}, {"target": "right", "stat": "attack", "to": 2, "lane": "soldierAttack", "cost": 2, "available": 4}]
        self.assertEqual(unspent_affordable_upgrades(legal, [Upgrade(target="left", stat="attack", to=2)]), [legal[1]])

    def test_normalizes_deck_actions(self) -> None:
        self.assertEqual([action["type"] for action in normalize_deck_actions(True, "silver")], ["playAll", "trashCardIfPresent", "moveToBuy", "buyCard", "endTurn"])

    def test_nearest_legal_coordinate_uses_hex_distance(self) -> None:
        self.assertEqual(closest_legal_coord({"col": 7, "row": 10}, [{"col": 4, "row": 10}, {"col": 8, "row": 12}]), {"col": 8, "row": 12})

    def test_reset_is_limited_to_named_run_directories(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            allowed = repository / ".games" / "smoke"
            self.assertEqual(validate_reset_run_dir(allowed, repository), allowed.resolve())
            with self.assertRaisesRegex(ValueError, "named run directories"):
                validate_reset_run_dir(repository / ".games", repository)

    def test_strategies_are_saved_exactly(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            p1 = root / "p1.txt"
            p2 = root / "p2.txt"
            p1.write_text("Attack\n")
            p2.write_text("Range")
            players = prepare_run_strategies(root / "run", initialize=True, p1_strategy_file=str(p1), p2_strategy_file=str(p2))
            self.assertEqual(players, [Player("P1", "Attack\n"), Player("P2", "Range")])

    def test_runner_defaults_to_twenty_rounds(self) -> None:
        with patch("sys.argv", ["run_game_thinharness.py", "--run", ".games/test", "--p1-setup", "{}", "--p2-setup", "{}"]):
            args = parse_args()
        self.assertEqual(args.max_turns, 20)
        self.assertEqual(args.model, "openai:gpt-5.6-luna")


def deck_state(active_player: str) -> dict:
    players = [{"id": "P1"}, {"id": "P2"}]
    return {"game": {"players": players, "activePlayer": 0 if active_player == "P1" else 1}}


if __name__ == "__main__":
    unittest.main()
