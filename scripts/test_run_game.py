#!/usr/bin/env python3
"""Regression tests for the resumable Skirmish harness helpers."""

from __future__ import annotations

import json
import tempfile
import unittest
from argparse import Namespace
from pathlib import Path
from unittest.mock import patch

from playtest_context import activation_options, legal_upgrades, state_briefing
from run_game import ensure_initialized, expected_next_turn_id, read_json, recover_uncommitted_turn, validate_reset_run_dir, write_json
from run_game_thinharness import Activation, BoardActions, ChooseCopperTrashArgs, ChoosePurchaseArgs, PlayAllActionsArgs, Player, SubmitBoardTurnArgs, TurnTools, Upgrade, activation_order_candidates, board_actions_payload, closest_legal_coord, normalize_deck_actions, parse_args, prepare_run_strategies, record_harness_tool_calls, record_submission, remove_redundant_attacks, submission_metrics_summary, unspent_affordable_upgrades


class RunGameHelpersTest(unittest.TestCase):
    def test_recovers_deck_state_after_an_interrupted_deck_turn(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            before = deck_state("P1")
            board = {"turn": {"activePlayer": "P1"}, "units": [{"id": "still-committed"}]}
            write_json(run_dir / "timeline.json", {"entries": []})
            write_json(run_dir / "board.json", board)
            write_json(run_dir / "deck.json", deck_state("P2"))
            write_json(run_dir / "snapshots" / "turn-001.before.deck.json", before)
            write_json(run_dir / "actions" / "turn-001.deck.json", {"partial": True})
            prior_attempt = run_dir / "interrupted" / "turn-001" / "attempt-001" / "actions" / "turn-001.deck.json"
            write_json(prior_attempt, {"partial": "older"})

            recover_uncommitted_turn(run_dir)

            self.assertEqual(read_json(run_dir / "deck.json"), before)
            self.assertEqual(read_json(run_dir / "board.json"), board)
            self.assertFalse((run_dir / "actions" / "turn-001.deck.json").exists())
            self.assertFalse((run_dir / "snapshots" / "turn-001.before.deck.json").exists())
            self.assertEqual(
                read_json(prior_attempt),
                {"partial": "older"},
            )
            self.assertEqual(
                read_json(run_dir / "interrupted" / "turn-001" / "attempt-002" / "actions" / "turn-001.deck.json"),
                {"partial": True},
            )
            self.assertEqual(
                read_json(run_dir / "interrupted" / "turn-001" / "attempt-002" / "snapshots" / "turn-001.before.deck.json"),
                before,
            )

    def test_recovers_both_states_after_board_execution_before_commit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            deck_before = deck_state("P1")
            board_before = {"turn": {"activePlayer": "P1"}, "units": [{"id": "before"}]}
            write_json(run_dir / "timeline.json", {"entries": []})
            write_json(run_dir / "deck.json", deck_state("P2"))
            write_json(run_dir / "board.json", {"turn": {"activePlayer": "P2"}, "units": [{"id": "after"}]})
            write_json(run_dir / "snapshots" / "turn-001.before.deck.json", deck_before)
            write_json(run_dir / "snapshots" / "turn-001.before.board.json", board_before)
            write_json(run_dir / "results" / "turn-001.board.result.json", {"partial": True})

            recover_uncommitted_turn(run_dir)

            self.assertEqual(read_json(run_dir / "deck.json"), deck_before)
            self.assertEqual(read_json(run_dir / "board.json"), board_before)
            self.assertFalse((run_dir / "results" / "turn-001.board.result.json").exists())
            self.assertEqual(
                read_json(run_dir / "interrupted" / "turn-001" / "attempt-001" / "results" / "turn-001.board.result.json"),
                {"partial": True},
            )

    def test_recovery_targets_only_the_next_conventional_turn(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            committed = run_dir / "actions" / "turn-001.deck.json"
            committed_deck = deck_state("P2")
            committed_board = {"turn": {"activePlayer": "P2"}}
            write_json(run_dir / "timeline.json", {"entries": [{
                "id": "turn-001",
                "deck": {"after": "snapshots/turn-001.after.deck.json"},
                "board": {"after": "snapshots/turn-001.after.board.json"},
            }]})
            write_json(run_dir / "snapshots" / "turn-001.after.deck.json", committed_deck)
            write_json(run_dir / "snapshots" / "turn-001.after.board.json", committed_board)
            write_json(run_dir / "deck.json", deck_state("P1"))
            write_json(run_dir / "board.json", {"turn": {"activePlayer": "P1"}})
            write_json(committed, {"committed": True})
            write_json(run_dir / "snapshots" / "turn-002.before.deck.json", committed_deck)
            write_json(run_dir / "snapshots" / "turn-002.before.board.json", committed_board)

            recover_uncommitted_turn(run_dir)

            self.assertEqual(read_json(committed), {"committed": True})
            self.assertEqual(read_json(run_dir / "deck.json"), committed_deck)
            self.assertEqual(read_json(run_dir / "board.json"), committed_board)
            self.assertEqual(expected_next_turn_id(read_json(run_dir / "timeline.json")), "turn-002")

    def test_rejects_nonconventional_committed_turn_ids_before_resuming(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "expected turn-001"):
            expected_next_turn_id({"entries": [{"id": "custom-turn"}]})

    def test_briefing_exposes_card_effects_and_live_market_supply_for_one_shot_deck_planning(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            write_json(run_dir / "board.json", {"turn": {"activePlayer": "P1"}, "units": []})
            write_json(run_dir / "deck.json", {"game": {
                "phase": "action",
                "pending": None,
                "players": [{"id": "P1", "hand": ["drill"], "actions": 1, "buys": 1, "money": 0, "attributes": {}}],
                "cards": {"drill": {"id": "drill", "name": "Drill", "type": "action", "cost": 4, "effects": [{"kind": "grant", "cards": 1}]}},
                "supply": {"drill": 7},
            }})

            briefing = state_briefing(run_dir, "P1")

            self.assertEqual(briefing["handIndexed"][0]["effects"], [{"kind": "grant", "cards": 1}])
            self.assertEqual(briefing["market"], [{"id": "drill", "cost": 4, "remaining": 7}])
            self.assertEqual(briefing["deckChoiceRules"], {
                "playsAllActionsRecursively": True,
                "trashDecisionAfterActions": True,
                "purchaseDecisionAfterTrash": True,
                "preferTrashCopper": True,
                "harnessAddsTreasuresAndEndTurn": True,
                "unspentMoneyCarriesOver": False,
            })

    def test_deck_choice_plays_every_action_before_optional_copper_trash_and_purchase(self) -> None:
        actions = normalize_deck_actions(trash_copper=True, buy_card="silver")

        self.assertEqual(actions, [
            {"type": "playAll"},
            {"type": "trashCardIfPresent", "cardId": "copper"},
            {"type": "moveToBuy"},
            {"type": "buyCard", "cardId": "silver"},
            {"type": "endTurn"},
        ])

    def test_deck_tools_choose_trash_and_purchase_after_recursively_drawn_cards(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            args = Namespace(
                ruleset="skirmish-v1",
                map="skirmish-v1",
                title="Three-stage deck test",
                max_turns=20,
                config="game/deck.yaml",
                seed=1,
            )
            ensure_initialized(args, run_dir, test_player_setups())
            deck = read_json(run_dir / "deck.json")
            player = deck["game"]["players"][0]
            player["hand"] = ["drill", "copper"]
            player["draw"] = ["sparring", "gold"]
            player["discard"] = []
            player["play"] = []
            write_json(run_dir / "deck.json", deck)
            tools = TurnTools(args, run_dir, Player("P1", "test"), "turn-001", 0)

            action_result = tools.play_all_actions(PlayAllActionsArgs())
            action_preview = json.loads(action_result.content)
            self.assertTrue(action_result.ok)
            self.assertEqual(action_preview["played"], ["drill", "sparring"])
            self.assertEqual(action_preview["moneyIfKept"], 4)
            self.assertEqual(action_preview["moneyIfTrashed"], 3)

            trash_result = tools.choose_copper_trash(ChooseCopperTrashArgs(trashCopper=True))
            trash_preview = json.loads(trash_result.content)
            self.assertTrue(trash_result.ok)
            self.assertEqual(trash_preview["availableMoney"], 3)
            self.assertIn("silver", [card["id"] for card in trash_preview["affordableCards"]])
            self.assertNotIn("sparring", [card["id"] for card in trash_preview["affordableCards"]])
            self.assertNotIn("copper", [card["id"] for card in trash_preview["affordableCards"]])

            purchase_result = tools.choose_purchase(ChoosePurchaseArgs(buyCard="silver"))
            deck_result = read_json(run_dir / "results" / "turn-001.deck.result.json")
            self.assertTrue(purchase_result.ok)
            self.assertEqual(deck_result["played"], ["drill", "sparring"])
            self.assertEqual(deck_result["bought"], ["silver"])
            self.assertEqual([action["type"] for action in deck_result["actions"]], [
                "playAction",
                "playAction",
                "trashCard",
                "moveToBuy",
                "buyCard",
                "endTurn",
            ])

    def test_reports_affordable_upgrades_left_after_the_submission(self) -> None:
        legal = [
            {"target": "left", "stat": "attack", "to": 2, "lane": "soldierAttack", "cost": 2, "available": 4},
            {"target": "right", "stat": "attack", "to": 2, "lane": "soldierAttack", "cost": 2, "available": 4},
            {"target": "archer", "stat": "range", "to": 3, "lane": "archerRange", "cost": 3, "available": 3},
        ]
        submitted = [
            Upgrade(target="left", stat="attack", to=2),
            Upgrade(target="archer", stat="range", to=3),
        ]

        self.assertEqual(unspent_affordable_upgrades(legal, submitted), [legal[1]])
        self.assertEqual(unspent_affordable_upgrades(legal, [
            Upgrade(target="left", stat="attack", to=2),
            Upgrade(target="right", stat="attack", to=2),
            Upgrade(target="archer", stat="range", to=3),
        ]), [])

    def test_board_submission_rejects_affordable_upgrades_left_unspent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            write_json(run_dir / "board.json", {"turn": {"activePlayer": "P1"}, "units": []})
            write_json(run_dir / "timeline.json", {"entries": []})
            write_json(run_dir / "results" / "turn-001.deck.result.json", {"produced": {"soldierAttack": 2}})
            briefing = {
                "legalUpgrades": [{
                    "target": "soldier",
                    "stat": "attack",
                    "to": 2,
                    "lane": "soldierAttack",
                    "cost": 2,
                    "available": 2,
                }],
                "activationOptions": [],
                "automaticKeyPointUpgrades": [],
            }
            tools = TurnTools(Namespace(), run_dir, Player("P1", "test"), "turn-001", 0)
            tools.deck_done = True

            with patch("run_game_thinharness.state_briefing", return_value=briefing):
                result = tools.submit_board_turn(SubmitBoardTurnArgs(
                    actions=BoardActions(),
                    summary="Hold position.",
                    reasoning="No units remain.",
                ))

            self.assertFalse(result.ok)
            self.assertIn("Affordable upgrades remain unspent", result.content)

    def test_board_briefing_exposes_automatic_and_affordable_upgrades_after_deck_success(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            write_json(run_dir / "board.json", {
                "turn": {"activePlayer": "P1"},
                "units": [{
                    "id": "soldier", "type": "soldier", "player": "P1", "col": 4, "row": 8,
                    "hp": 6, "attack": 1, "movement": 4, "range": 1,
                }],
            })
            write_json(run_dir / "deck.json", {"game": {"players": [{"id": "P1"}]}})

            briefing = state_briefing(run_dir, "P1", {"soldierAttack": 9, "soldierMovement": 5})

            self.assertEqual(briefing["automaticKeyPointUpgrades"], [{
                "target": "soldier", "stat": "attack", "to": 2, "keyPoint": "attack",
            }])
            self.assertEqual(briefing["legalUpgrades"], [{
                "target": "soldier", "stat": "movement", "to": 5,
                "lane": "soldierMovement", "cost": 5, "available": 5,
            }])
            self.assertNotIn("legalDeckActionsNow", briefing)

    def test_lists_attacks_available_after_the_first_movement_leg(self) -> None:
        board = {
            "units": [
                {"id": "archer", "type": "archer", "player": "P1", "col": 0, "row": 0, "movement": 3, "range": 2},
                {"id": "enemy", "type": "soldier", "player": "P2", "col": 3, "row": 2, "movement": 4, "range": 1},
            ]
        }
        map_data = {
            "hexes": [{"col": col, "row": row} for row in range(4) for col in range(5)],
            "blocked": [],
        }

        [option] = activation_options(board, map_data, "P1", {"archer": {"canUpgradeRange": True}})

        attacks_by_via = {f"{entry['via']['col']},{entry['via']['row']}": entry["attacks"] for entry in option["attackChoicesByVia"]}
        self.assertNotIn("0,0", attacks_by_via)
        self.assertEqual(attacks_by_via["2,1"], [{"id": "archer@2,1>enemy", "target": "enemy"}])

    def test_applies_automatic_key_point_range_to_attack_hints(self) -> None:
        board = {
            "units": [
                {"id": "archer", "type": "archer", "player": "P1", "col": 0, "row": 0, "movement": 0, "range": 2},
                {"id": "enemy", "type": "soldier", "player": "P2", "col": 3, "row": 0, "movement": 0, "range": 1},
            ]
        }
        map_data = {
            "hexes": [{"col": col, "row": 0} for col in range(4)],
            "blocked": [],
            "keyPoints": [{"id": "range", "stat": "range", "col": 0, "row": 0}],
        }

        [option] = activation_options(board, map_data, "P1", {"archer": {"canUpgradeRange": True}})

        self.assertEqual(option["range"], 3)
        self.assertEqual(option["attackChoicesByVia"], [{
            "via": {"col": 0, "row": 0},
            "spent": 0,
            "remaining": 0,
            "attacks": [{"id": "archer@0,0>enemy", "target": "enemy"}],
            "to": [{"col": 0, "row": 0}],
        }])

    def test_attack_choices_limit_second_leg_to_remaining_movement(self) -> None:
        board = {
            "units": [
                {"id": "archer", "type": "archer", "player": "P1", "col": 0, "row": 0, "movement": 3, "range": 1},
                {"id": "enemy", "type": "soldier", "player": "P2", "col": 3, "row": 0, "movement": 4, "range": 1},
            ]
        }
        map_data = {
            "hexes": [{"col": col, "row": row} for row in range(2) for col in range(5)],
            "blocked": [],
        }

        [option] = activation_options(board, map_data, "P1", {"archer": {"canUpgradeRange": True}})

        via = next(choice for choice in option["attackChoicesByVia"] if choice["via"] == {"col": 2, "row": 0})
        self.assertEqual(via["spent"], 2)
        self.assertEqual(via["remaining"], 1)
        self.assertIn({"col": 2, "row": 0}, via["to"])
        self.assertNotIn({"col": 0, "row": 0}, via["to"])

    def test_board_payload_derives_coordinates_and_target_from_one_attack_plan(self) -> None:
        options = [{
            "unit": "archer",
            "from": {"col": 0, "row": 0},
            "noAttackTo": [{"col": 1, "row": 0}],
            "attackChoicesByVia": [{
                "via": {"col": 2, "row": 0},
                "attacks": [{"id": "archer@2,0>enemy", "target": "enemy"}],
                "to": [{"col": 2, "row": 1}],
            }],
        }]
        actions = BoardActions(activations=[Activation(
            unit="archer",
            attackPlan="archer@2,0>enemy",
            to={"col": 2, "row": 1},
        )])

        payload = board_actions_payload(actions, options)

        self.assertEqual(payload["activations"], [{
            "unit": "archer",
            "from": {"col": 0, "row": 0},
            "via": {"col": 2, "row": 0},
            "attack": {"target": "enemy"},
            "to": {"col": 2, "row": 1},
        }])

    def test_board_payload_snaps_destination_to_the_nearest_option_for_the_attack_plan(self) -> None:
        options = [{
            "unit": "soldier",
            "from": {"col": 5, "row": 9},
            "noAttackTo": [],
            "attackChoicesByVia": [{
                "via": {"col": 6, "row": 9},
                "attacks": [{"id": "soldier@6,9>center", "target": "center"}],
                "to": [{"col": 7, "row": 9}],
            }],
        }]
        actions = BoardActions(activations=[Activation(
            unit="soldier",
            attackPlan="soldier@6,9>center",
            to={"col": 8, "row": 9},
        )])

        payload = board_actions_payload(actions, options)

        self.assertEqual(payload["activations"][0]["to"], {"col": 7, "row": 9})

    def test_nearest_legal_coordinate_uses_hex_distance(self) -> None:
        self.assertEqual(
            closest_legal_coord(
                {"col": 7, "row": 10},
                [{"col": 4, "row": 10}, {"col": 8, "row": 12}, {"col": 5, "row": 10}],
            ),
            {"col": 8, "row": 12},
        )

    def test_redundant_attacks_become_plain_movement_after_the_target_will_die(self) -> None:
        board = {"units": [
            {"id": "first", "attack": 1, "hp": 4},
            {"id": "second", "attack": 1, "hp": 4},
            {"id": "third", "attack": 1, "hp": 4},
            {"id": "enemy", "attack": 1, "hp": 2},
        ]}
        payload = {"upgrades": [], "activations": [
            {"unit": unit, "from": {"col": 0, "row": 0}, "via": {"col": 1, "row": 0}, "attack": {"target": "enemy"}, "to": {"col": 2, "row": 0}}
            for unit in ("first", "second", "third")
        ]}

        normalized = remove_redundant_attacks(payload, board, [])

        self.assertIn("attack", normalized["activations"][1])
        self.assertNotIn("attack", normalized["activations"][2])
        self.assertNotIn("via", normalized["activations"][2])

    def test_activation_order_candidates_prioritize_non_attacks_as_an_alternative(self) -> None:
        payload = {"upgrades": [], "activations": [
            {"unit": "attacker", "attack": {"target": "enemy"}},
            {"unit": "mover"},
        ]}

        candidates = list(activation_order_candidates(payload))

        self.assertEqual([item["unit"] for item in candidates[0]["activations"]], ["attacker", "mover"])
        self.assertEqual([item["unit"] for item in candidates[1]["activations"]], ["mover", "attacker"])

    def test_legal_upgrades_are_submit_ready_and_exclude_automatic_or_forbidden_choices(self) -> None:
        board = {
            "units": [
                {"id": "soldier", "type": "soldier", "player": "P1", "col": 0, "row": 0, "attack": 1, "movement": 4, "range": 1},
                {"id": "archer", "type": "archer", "player": "P1", "col": 1, "row": 0, "attack": 1, "movement": 3, "range": 2},
            ]
        }
        map_data = {"keyPoints": [{"id": "attack", "stat": "attack", "col": 0, "row": 0}]}
        rules = {"soldier": {"canUpgradeRange": False}, "archer": {"canUpgradeRange": True}}

        choices = legal_upgrades(board, map_data, "P1", rules, {
            "soldierAttack": 9,
            "soldierMovement": 5,
            "soldierRange": 9,
            "archerRange": 3,
        })

        self.assertEqual(choices, [
            {"target": "soldier", "stat": "movement", "to": 5, "lane": "soldierMovement", "cost": 5, "available": 5},
            {"target": "archer", "stat": "range", "to": 3, "lane": "archerRange", "cost": 3, "available": 3},
        ])

    def test_records_structured_submission_attempts_and_rejection_reasons(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            deck_submission = {"actions": [{"type": "endTurn"}]}
            board_submission = {"actions": {"upgrades": [], "activations": []}}

            record_submission(run_dir, "turn-001", "P1", "deck", deck_submission, accepted=True)
            record_submission(
                run_dir,
                "turn-001",
                "P1",
                "board",
                board_submission,
                accepted=False,
                message="turn-001: archer moved 5, exceeding movement 3",
            )

            metrics = read_json(run_dir / "submission-metrics.json")
            self.assertEqual(metrics["totals"]["deck"], {"attempts": 1, "accepted": 1, "rejected": 0})
            self.assertEqual(metrics["totals"]["board"], {"attempts": 1, "accepted": 0, "rejected": 1})
            self.assertEqual(metrics["rejectionReasons"], {"movementBudget": 1})
            self.assertEqual(metrics["events"][1]["submission"], board_submission)
            self.assertEqual(submission_metrics_summary(run_dir)["rejectionReasons"], {"movementBudget": 1})

    def test_metrics_summary_includes_tool_schema_rejections_that_never_reach_handlers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            run_dir = Path(directory)
            record_harness_tool_calls(run_dir, "turn-001", [
                {"call": {"name": "play_all_actions"}, "output": '{"ok":true,"content":"valid","metadata":{}}'},
                {"call": {"name": "choose_copper_trash"}, "output": '{"ok":false,"content":"bad args","metadata":{"error_type":"ValidationError"}}'},
                {"call": {"name": "choose_copper_trash"}, "output": '{"ok":true,"content":"valid","metadata":{}}'},
                {"call": {"name": "choose_purchase"}, "output": '{"ok":true,"content":"valid","metadata":{}}'},
                {"call": {"name": "submit_board_turn"}, "output": '{"ok":true,"content":"valid","metadata":{}}'},
            ])

            summary = submission_metrics_summary(run_dir)

            self.assertEqual(summary["totals"]["deck"], {"attempts": 4, "accepted": 3, "rejected": 1})
            self.assertEqual(summary["totals"]["board"], {"attempts": 1, "accepted": 1, "rejected": 0})
            self.assertEqual(summary["toolRejectionTypes"], {"ValidationError": 1})

    def test_reset_is_limited_to_named_repository_run_directories(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            allowed = repository / ".games" / "skirmish-smoke"
            self.assertEqual(validate_reset_run_dir(allowed, repository), allowed.resolve())
            with self.assertRaisesRegex(ValueError, "named run directories"):
                validate_reset_run_dir(repository, repository)
            with self.assertRaisesRegex(ValueError, "named run directories"):
                validate_reset_run_dir(repository / ".games", repository)
            with self.assertRaisesRegex(ValueError, "named run directories"):
                validate_reset_run_dir(repository.parent / "outside", repository)

    def test_new_run_requires_both_strategy_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "--p2-strategy-file"):
                prepare_run_strategies(
                    Path(directory) / "run",
                    initialize=True,
                    p1_strategy_file=str(Path(directory) / "attack.md"),
                    p2_strategy_file=None,
                )

    def test_new_run_copies_exact_strategies_and_records_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_dir = root / "run"
            p1_source = root / "attack-v2.md"
            p2_source = root / "attack-range-mix.md"
            p1_strategy = "Prioritize attack.\nKeep tactical flexibility.\n"
            p2_strategy = "Mix range and attack without a trailing newline."
            p1_source.write_text(p1_strategy)
            p2_source.write_text(p2_strategy)

            players = prepare_run_strategies(
                run_dir,
                initialize=True,
                p1_strategy_file=str(p1_source),
                p2_strategy_file=str(p2_source),
            )

            self.assertEqual(players, [Player("P1", p1_strategy), Player("P2", p2_strategy)])
            self.assertEqual((run_dir / "strategies" / "P1.txt").read_text(), p1_strategy)
            self.assertEqual((run_dir / "strategies" / "P2.txt").read_text(), p2_strategy)
            self.assertEqual(read_json(run_dir / "run-config.json"), {
                "schemaVersion": 1,
                "strategies": {
                    "P1": {
                        "sourcePath": str(p1_source.resolve()),
                        "savedPath": "strategies/P1.txt",
                    },
                    "P2": {
                        "sourcePath": str(p2_source.resolve()),
                        "savedPath": "strategies/P2.txt",
                    },
                },
            })

    def test_resume_uses_saved_strategies_after_sources_are_removed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_dir = root / "run"
            p1_source = root / "p1.md"
            p2_source = root / "p2.md"
            p1_source.write_text("Saved P1 strategy")
            p2_source.write_text("Saved P2 strategy")
            prepare_run_strategies(
                run_dir,
                initialize=True,
                p1_strategy_file=str(p1_source),
                p2_strategy_file=str(p2_source),
            )
            p1_source.unlink()
            p2_source.unlink()

            players = prepare_run_strategies(
                run_dir,
                initialize=False,
                p1_strategy_file=None,
                p2_strategy_file=None,
            )

            self.assertEqual(players, [Player("P1", "Saved P1 strategy"), Player("P2", "Saved P2 strategy")])

    def test_resume_accepts_matching_strategy_files_and_rejects_changed_contents(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            run_dir = root / "run"
            p1_source = root / "p1.md"
            p2_source = root / "p2.md"
            p1_source.write_text("P1 strategy")
            p2_source.write_text("P2 strategy")
            prepare_run_strategies(
                run_dir,
                initialize=True,
                p1_strategy_file=str(p1_source),
                p2_strategy_file=str(p2_source),
            )

            matching_players = prepare_run_strategies(
                run_dir,
                initialize=False,
                p1_strategy_file=str(p1_source),
                p2_strategy_file=str(p2_source),
            )
            self.assertEqual(matching_players, [Player("P1", "P1 strategy"), Player("P2", "P2 strategy")])

            p2_source.write_text("Changed P2 strategy")
            with self.assertRaisesRegex(ValueError, "P2.*differs from saved strategy"):
                prepare_run_strategies(
                    run_dir,
                    initialize=False,
                    p1_strategy_file=str(p1_source),
                    p2_strategy_file=str(p2_source),
                )

    def test_harness_defaults_to_the_cproxy_luna_model(self) -> None:
        with patch("sys.argv", ["run_game_thinharness.py", "--run", ".games/test", "--p1-setup", "{}", "--p2-setup", "{}"]):
            self.assertEqual(parse_args().model, "openai:gpt-5.6-luna")

    def test_harness_defaults_to_twenty_completed_player_turns(self) -> None:
        with patch("sys.argv", ["run_game_thinharness.py", "--run", ".games/test", "--p1-setup", "{}", "--p2-setup", "{}"]):
            self.assertEqual(parse_args().max_turns, 20)

    def test_harness_accepts_strategy_file_arguments(self) -> None:
        with patch("sys.argv", [
            "run_game_thinharness.py",
            "--run", ".games/test",
            "--p1-setup", "{}",
            "--p2-setup", "{}",
            "--p1-strategy-file", "strategies/attack-v2.md",
            "--p2-strategy-file", "strategies/range-v1.md",
        ]):
            args = parse_args()

        self.assertEqual(args.p1_strategy_file, "strategies/attack-v2.md")
        self.assertEqual(args.p2_strategy_file, "strategies/range-v1.md")
        self.assertFalse(hasattr(args, "p1_strategy"))
        self.assertFalse(hasattr(args, "p2_strategy"))


def deck_state(active_player: str) -> dict:
    players = [{"id": "P1"}, {"id": "P2"}]
    return {"game": {"players": players, "activePlayer": 0 if active_player == "P1" else 1}}


def test_player_setups() -> dict[str, dict]:
    return {
        "P1": {
            "draft": ["drill", "sparring"],
            "units": [
                {"id": "P1-soldier-left", "type": "soldier", "col": 2, "row": 0},
                {"id": "P1-archer-left", "type": "archer", "col": 3, "row": 0},
                {"id": "P1-soldier-center", "type": "soldier", "col": 4, "row": 0},
                {"id": "P1-archer-right", "type": "archer", "col": 5, "row": 0},
                {"id": "P1-soldier-right", "type": "soldier", "col": 6, "row": 0},
            ],
        },
        "P2": {
            "draft": ["ranging", "bodkin"],
            "units": [
                {"id": "P2-soldier-left", "type": "soldier", "col": 2, "row": 16},
                {"id": "P2-archer-left", "type": "archer", "col": 3, "row": 16},
                {"id": "P2-soldier-center", "type": "soldier", "col": 4, "row": 16},
                {"id": "P2-archer-right", "type": "archer", "col": 5, "row": 16},
                {"id": "P2-soldier-right", "type": "soldier", "col": 6, "row": 16},
            ],
        },
    }


if __name__ == "__main__":
    unittest.main()
