#!/usr/bin/env python3
"""Run a bounded Deckfront playthrough with ThinHarness validating tools."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from playtest_context import build_initial_prompt
from playtest_context import build_state_briefing
from playtest_context import load_system_prompt
from playtest_context import write_context_snapshot
from playtest_context import write_run_metadata
from run_game import DEFAULT_CONFIG
from run_game import DEFAULT_MAP
from run_game import DEFAULT_P1_UNITS
from run_game import DEFAULT_P2_UNITS
from run_game import DEFAULT_RULESET
from run_game import committed_expected_turn
from run_game import drafts
from run_game import ensure_initialized
from run_game import rel
from run_game import run
from run_game import split_csv
from run_game import validate_run

THINHARNESS_ROOT = Path(os.getenv("THINHARNESS_ROOT", "/Users/ryanbrown/code/thinharness"))
if THINHARNESS_ROOT.exists():
    sys.path.insert(0, str(THINHARNESS_ROOT))
    site_packages = THINHARNESS_ROOT / ".venv" / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages"
    if site_packages.exists():
        sys.path.insert(0, str(site_packages))

from pydantic import BaseModel, ConfigDict, Field  # noqa: E402
from thinharness import Harness, HarnessConfig, ToolResult, ToolSpec  # noqa: E402


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = "openai:gpt-5.5"
DEFAULT_EFFORT = "low"
DEFAULT_TIMEOUT_SECONDS = 90


class Coord(BaseModel):
    model_config = ConfigDict(extra="forbid")

    col: int
    row: int


class PlayAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["playAction"]
    handIndex: int = Field(ge=0)


class TrashCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["trashCard"]
    handIndex: int = Field(ge=0)


class MoveToBuy(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["moveToBuy"]


class BuyCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["buyCard"]
    cardId: str


class EndTurn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["endTurn"]


class ResolveSkip(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["resolvePending"]
    choice: Literal["skip"]


class ResolveSelect(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["resolvePending"]
    choice: Literal["select"]
    handIndex: int = Field(ge=0)


class ResolveLookahead(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["resolvePending"]
    choice: Literal["lookahead"]
    exposedIndex: int = Field(ge=0)
    destination: Literal["draw", "discard", "trash", "top"]


DeckAction = PlayAction | TrashCard | MoveToBuy | BuyCard | EndTurn | ResolveSkip | ResolveSelect | ResolveLookahead


class Movement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit: str
    from_: Coord = Field(alias="from")
    to: Coord


class Recruit(BaseModel):
    model_config = ConfigDict(extra="forbid")

    unit: str
    type: str
    at: Coord


class Attack(BaseModel):
    model_config = ConfigDict(extra="forbid")

    attacker: str
    target: str
    deckDamage: int = Field(default=0, ge=0)


class Heal(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: str
    amount: int = Field(gt=0)
    source: Literal["deck", "unit"]
    healer: str | None = None


class Upgrade(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target: str
    attack: int = Field(ge=0)
    maxHp: int = Field(ge=0)


class BoardActions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    movements: list[Movement] = Field(default_factory=list)
    recruits: list[Recruit] = Field(default_factory=list)
    attacks: list[Attack] = Field(default_factory=list)
    heals: list[Heal] = Field(default_factory=list)
    upgrades: list[Upgrade] = Field(default_factory=list)


class SubmitDeckTurnArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actions: list[DeckAction] = Field(min_length=1)
    note: str = Field(default="", max_length=500)


class SubmitBoardTurnArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    actions: BoardActions
    summary: str = Field(min_length=1, max_length=240)
    reasoning: str = Field(min_length=1, max_length=700)


@dataclass
class Player:
    id: str
    strategy: str
    session_id: str = ""


@dataclass
class TurnResult:
    ok: bool
    error: str = ""
    model_seconds: float = 0.0
    usage: dict[str, Any] | None = None


class DeckfrontTurnTools:
    def __init__(self, args: argparse.Namespace, run_dir: Path, player: Player, turn_id: str, previous_entries: int) -> None:
        self.args = args
        self.run_dir = run_dir
        self.player = player
        self.turn_id = turn_id
        self.previous_entries = previous_entries
        self.deck_done = False
        self.board_done = False
        self.deck_result_path = run_dir / "results" / f"{turn_id}.deck.result.json"
        self.board_result_path = run_dir / "results" / f"{turn_id}.board.result.json"

    def specs(self) -> list[ToolSpec]:
        return [
            ToolSpec(
                "submit_deck_turn",
                (
                    "Submit the complete deck action list for this turn. The tool writes the action file and runs the real Deckfront deck-turn CLI. "
                    "If invalid, it returns a retryable error; correct the full action list and call this tool again."
                ),
                SubmitDeckTurnArgs,
                self.submit_deck_turn,
                max_retries=self.args.tool_retries,
                sequential=True,
            ),
            ToolSpec(
                "submit_board_turn",
                (
                    "Submit board actions after submit_deck_turn succeeds. The tool writes the board action file, runs board-turn, commits the turn, "
                    "and strict-validates the replay. If invalid, it returns a retryable error; correct the board actions and call this tool again."
                ),
                SubmitBoardTurnArgs,
                self.submit_board_turn,
                max_retries=self.args.tool_retries,
                sequential=True,
            ),
        ]

    def submit_deck_turn(self, tool_args: SubmitDeckTurnArgs) -> ToolResult:
        if self.deck_done:
            return ToolResult(False, "Deck turn is already valid. Do not call submit_deck_turn again; call submit_board_turn.", {"error_type": "AlreadySubmitted", "retry": True})

        deck_before = (self.run_dir / "deck.json").read_text()
        action_path = self.run_dir / "actions" / f"{self.turn_id}.deck.json"
        write_json(
            action_path,
            {
                "schemaVersion": 1,
                "turnId": self.turn_id,
                "player": self.player.id,
                "actions": [action.model_dump(by_alias=True, exclude_none=True) for action in tool_args.actions],
            },
        )
        result = run(
            [
                "bun",
                "run",
                "--silent",
                "cli",
                "--",
                "deck-turn",
                "--config",
                self.args.config,
                "--state",
                rel(self.run_dir / "deck.json"),
                "--actions",
                rel(action_path),
                "--result",
                rel(self.deck_result_path),
            ],
            check=False,
            echo=False,
        )
        append_text(self.run_dir / "logs" / f"{self.turn_id}.deck-tool.txt", result.stdout + result.stderr)
        if result.returncode != 0:
            (self.run_dir / "deck.json").write_text(deck_before)
            return self.retry("InvalidDeckTurn", self.deck_retry_message(result.stdout + result.stderr, tool_args.actions))

        self.deck_done = True
        deck_result = read_json(self.deck_result_path)
        return ToolResult(
            True,
            json.dumps(
                {
                    "status": "deck turn valid",
                    "played": deck_result.get("played", []),
                    "bought": deck_result.get("bought", []),
                    "produced": deck_result.get("produced", {}),
                    "next": "Call submit_board_turn with board actions that use these produced resources.",
                },
                separators=(",", ":"),
            ),
        )

    def submit_board_turn(self, tool_args: SubmitBoardTurnArgs) -> ToolResult:
        if not self.deck_done:
            return ToolResult(False, "submit_deck_turn must succeed before submit_board_turn.", {"error_type": "DeckMissing", "retry": True})
        if self.board_done:
            return ToolResult(False, "Board turn is already valid and committed. Finish with a short done message.", {"error_type": "AlreadySubmitted", "retry": True})

        board_before = (self.run_dir / "board.json").read_text()
        timeline_before = (self.run_dir / "timeline.json").read_text()
        action_path = self.run_dir / "actions" / f"{self.turn_id}.board.json"
        write_json(
            action_path,
            {
                "schemaVersion": 1,
                "turnId": self.turn_id,
                "player": self.player.id,
                "actions": tool_args.actions.model_dump(by_alias=True, exclude_none=True),
            },
        )
        board = run(
            [
                "bun",
                "run",
                "--silent",
                "cli",
                "--",
                "board-turn",
                "--state",
                rel(self.run_dir / "board.json"),
                "--deck-result",
                rel(self.deck_result_path),
                "--actions",
                rel(action_path),
                "--result",
                rel(self.board_result_path),
            ],
            check=False,
            echo=False,
        )
        append_text(self.run_dir / "logs" / f"{self.turn_id}.board-tool.txt", board.stdout + board.stderr)
        if board.returncode != 0:
            (self.run_dir / "board.json").write_text(board_before)
            return self.retry("InvalidBoardTurn", self.board_retry_message(board.stdout + board.stderr))

        commit = run(
            [
                "bun",
                "run",
                "--silent",
                "playtest",
                "--",
                "commit-turn",
                "--run",
                rel(self.run_dir),
                "--deck-result",
                rel(self.deck_result_path),
                "--board-result",
                rel(self.board_result_path),
                "--summary",
                tool_args.summary,
                "--reasoning",
                tool_args.reasoning,
                "--strict-win",
            ],
            check=False,
            echo=False,
        )
        append_text(self.run_dir / "logs" / f"{self.turn_id}.commit-tool.txt", commit.stdout + commit.stderr)
        if commit.returncode != 0:
            (self.run_dir / "board.json").write_text(board_before)
            (self.run_dir / "timeline.json").write_text(timeline_before)
            return self.retry("InvalidCommit", self.board_retry_message(commit.stdout + commit.stderr))

        validation = validate_run(self.args, self.run_dir)
        append_text(self.run_dir / "logs" / f"{self.turn_id}.validate.txt", validation.stdout + validation.stderr)
        timeline = read_json(self.run_dir / "timeline.json")
        if validation.returncode != 0 or not committed_expected_turn(timeline, self.previous_entries, self.turn_id, self.player.id):
            (self.run_dir / "board.json").write_text(board_before)
            (self.run_dir / "timeline.json").write_text(timeline_before)
            return self.retry("InvalidReplay", self.board_retry_message(validation.stdout + validation.stderr))

        self.board_done = True
        return ToolResult(True, json.dumps({"status": "turn committed and strict-validated", "turnId": self.turn_id}, separators=(",", ":")))

    def retry(self, error_type: str, message: str) -> ToolResult:
        return ToolResult(False, message[-6000:], {"error_type": error_type, "retry": True})

    def deck_retry_message(self, error: str, actions: list[DeckAction]) -> str:
        return "\n".join(
            [
                "The submitted deck action list was rejected by the Deckfront CLI.",
                error.strip(),
                "",
                "Submitted actions:",
                json.dumps([action.model_dump(by_alias=True, exclude_none=True) for action in actions], separators=(",", ":")),
                "",
                "Current deck context, including draw horizon and current legal actions:",
                json.dumps(deck_context(self.args, self.run_dir), separators=(",", ":")),
                "",
                "Retry submit_deck_turn with a complete corrected action list. Remember hand indexes are live after every play/trash/draw.",
            ]
        )

    def board_retry_message(self, error: str) -> str:
        return "\n".join(
            [
                "The submitted board actions or commit were rejected by the Deckfront CLI.",
                error.strip(),
                "",
                "Current board context:",
                json.dumps(board_context(self.run_dir, self.player.id), separators=(",", ":")),
                "",
                "Retry submit_board_turn with corrected legal board actions. Keep the already-valid deck turn.",
            ]
        )


def main() -> int:
    args = parse_args()
    run_dir = Path(args.run)
    if not run_dir.is_absolute():
        run_dir = ROOT / run_dir

    if args.reset and run_dir.exists():
        shutil.rmtree(run_dir)

    run_dir.mkdir(parents=True, exist_ok=True)
    (run_dir / "actions").mkdir(exist_ok=True)
    (run_dir / "results").mkdir(exist_ok=True)
    (run_dir / "logs").mkdir(exist_ok=True)

    players = [
        Player("P1", args.p1_strategy),
        Player("P2", args.p2_strategy),
    ]

    ensure_initialized(args, run_dir)
    write_runner_state(args, run_dir, players)
    write_context_snapshot(args, run_dir, players, runner="thinharness", drafts=drafts(args))
    snapshot_thinharness_system_prompt(run_dir)
    write_run_metadata(args, run_dir, players, runner="thinharness", drafts=drafts(args), status="running")

    for _ in range(args.max_turns):
        timeline = read_json(run_dir / "timeline.json")
        if timeline.get("terminalWinEvents"):
            write_run_metadata(args, run_dir, players, runner="thinharness", drafts=drafts(args), status="complete")
            print(f"Game already ended with terminal win events in {run_dir / 'timeline.json'}")
            return 0

        active_player = read_json(run_dir / "board.json")["turn"]["activePlayer"]
        player = next(candidate for candidate in players if candidate.id == active_player)
        previous_entries = len(timeline.get("entries", []))
        turn_id = f"turn-{previous_entries + 1:03d}"

        print(f"\n=== {turn_id} {player.id} ===", flush=True)
        turn_started = time.monotonic()
        result = run_thinharness_turn(args, run_dir, player, players, turn_id, previous_entries)
        if not result.ok:
            write_run_metadata(args, run_dir, players, runner="thinharness", drafts=drafts(args), status="invalid", error=result.error)
            print(result.error, file=sys.stderr)
            return 1

        elapsed = time.monotonic() - turn_started
        append_turn_timing(run_dir, turn_id, player.id, elapsed, result)
        timeline = read_json(run_dir / "timeline.json")
        print(f"Validated {len(timeline.get('entries', []))} entries in {elapsed:.1f}s", flush=True)
        if timeline.get("terminalWinEvents"):
            write_run_metadata(args, run_dir, players, runner="thinharness", drafts=drafts(args), status="complete")
            print(f"Game ended: {json.dumps(timeline['terminalWinEvents'], indent=2)}")
            return 0

    write_run_metadata(args, run_dir, players, runner="thinharness", drafts=drafts(args), status="max_turns")
    print(f"Stopped at max turns: {args.max_turns}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a two-player ThinHarness Deckfront playthrough.")
    parser.add_argument("--run", required=True, help="Run directory, usually under ../runs/ when invoked from an experiment code directory.")
    parser.add_argument("--reset", action="store_true", help="Delete and recreate the run directory before starting.")
    parser.add_argument("--ruleset", default=DEFAULT_RULESET)
    parser.add_argument("--map", default=DEFAULT_MAP)
    parser.add_argument("--board", default=None, help="Starter board JSON. If omitted, the runner writes one from --p1-units/--p2-units.")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="Deck config YAML.")
    parser.add_argument("--title", default="Current best ThinHarness playthrough")
    parser.add_argument("--seed", type=int, default=2106)
    parser.add_argument("--draft", action="append", default=None, help="Draft override. Repeat once per player.")
    parser.add_argument("--p1-units", default=DEFAULT_P1_UNITS, help="Comma-separated P1 starting units when --board is omitted.")
    parser.add_argument("--p2-units", default=DEFAULT_P2_UNITS, help="Comma-separated P2 starting units when --board is omitted.")
    parser.add_argument("--max-turns", type=int, default=10)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--effort", default=DEFAULT_EFFORT)
    parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument("--temperature", type=float, default=None)
    parser.add_argument("--tool-retries", type=int, default=2)
    parser.add_argument("--max-model-requests", type=int, default=8)
    parser.add_argument("--max-tool-calls", type=int, default=8)
    parser.add_argument(
        "--p1-strategy",
        default="Rush: contest centers early with high-movement units, convert center income into recruits, buy damage/cycling cards, and win by board pressure.",
    )
    parser.add_argument(
        "--p2-strategy",
        default="Engine/control: still contest centers early with competent unit play, but use deck buys to build draw/economy into damage and stabilization.",
    )
    return parser.parse_args()


def run_thinharness_turn(args: argparse.Namespace, run_dir: Path, player: Player, players: list[Player], turn_id: str, previous_entries: int) -> TurnResult:
    tools = DeckfrontTurnTools(args, run_dir, player, turn_id, previous_entries)
    prompt = build_thinharness_turn_prompt(args, run_dir, player, players, turn_id)
    write_text(run_dir / "context" / f"{turn_id}.{player.id}.thinharness.user.rendered.md", prompt)
    config = HarnessConfig(
        root=ROOT,
        model=args.model,
        system_prompt=load_thinharness_system_prompt(),
        builtin_tools=[],
        max_model_requests=args.max_model_requests,
        max_tool_calls=args.max_tool_calls,
        tool_retries=args.tool_retries,
        request_timeout=args.timeout_seconds,
        temperature=args.temperature,
        extra_body=model_extra_body(args.model, args.effort),
    )
    started = time.monotonic()
    try:
        result = Harness(config, tools=tools.specs()).run_sync(prompt)
    except Exception as exc:
        return TurnResult(False, str(exc), model_seconds=time.monotonic() - started)
    elapsed = time.monotonic() - started
    append_text(
        run_dir / "logs" / f"{turn_id}.{player.id}.thinharness.meta.json",
        json.dumps(
            {
                "elapsedSeconds": elapsed,
                "usage": vars(result.usage),
                "stopReason": result.stop_reason,
                "text": result.text,
                "toolCalls": result.tool_call_records,
            },
            indent=2,
            default=str,
        ),
    )
    if not tools.board_done:
        return TurnResult(False, "ThinHarness run ended before submit_board_turn committed a valid turn.", model_seconds=elapsed, usage=vars(result.usage))
    return TurnResult(True, model_seconds=elapsed, usage=vars(result.usage))


def model_extra_body(model_ref: str, effort: str | None) -> dict[str, Any]:
    if not effort:
        return {}
    if model_ref.startswith("openai:"):
        return {"reasoning": {"effort": effort}}
    return {}


def build_thinharness_turn_prompt(args: argparse.Namespace, run_dir: Path, player: Player, players: list[Player], turn_id: str) -> str:
    opponent = next(candidate for candidate in players if candidate.id != player.id)
    briefing = build_state_briefing(args, run_dir)
    context = {
        "turnId": turn_id,
        "player": player.id,
        "strategy": player.strategy,
        "opponent": {"id": opponent.id, "strategy": opponent.strategy},
        "drafts": drafts(args),
        "startingUnits": {"P1": split_csv(args.p1_units), "P2": split_csv(args.p2_units)},
        "deck": deck_context(args, run_dir),
        "board": board_context(run_dir, player.id),
        "market": briefing["deck"]["market"],
    }
    write_json(run_dir / "context" / f"{turn_id}.{player.id}.briefing.json", context)
    return "\n\n".join(
        [
            build_initial_prompt(args, run_dir, player, players, drafts(args)),
            "Complete exactly one Deckfront turn by calling tools.",
            "First call submit_deck_turn with a complete deck action list. If it returns an error, correct the full list and call submit_deck_turn again.",
            "After the deck tool succeeds, call submit_board_turn with board actions, summary, and reasoning. If it returns an error, correct the board actions and call submit_board_turn again.",
            "After submit_board_turn succeeds, respond with only: done",
            json.dumps(context, separators=(",", ":")),
        ]
    )


def deck_context(args: argparse.Namespace, run_dir: Path) -> dict[str, Any]:
    deck = read_json(run_dir / "deck.json")
    game = deck["game"]
    active = game["players"][game["activePlayer"]]
    legal = run(
        [
            "bun",
            "run",
            "--silent",
            "cli",
            "--",
            "legal-actions",
            "--config",
            args.config,
            "--state",
            rel(run_dir / "deck.json"),
            "--json",
        ],
        check=True,
        echo=False,
    )
    return {
        "phase": game["phase"],
        "active": {
            "id": active["id"],
            "handIndexed": list(enumerate(active["hand"])),
            "actions": active["actions"],
            "buys": active["buys"],
            "money": active["money"],
            "attributes": active["attributes"],
            "freeTrashUsed": active["freeTrashUsed"],
            "play": active["play"],
            "discard": active["discard"],
            "drawCount": len(active["draw"]),
        },
        "drawHorizon": draw_horizon(game),
        "legal": [
            {
                "i": action["index"],
                "d": action["description"],
                "a": action["action"],
            }
            for action in json.loads(legal.stdout)["actions"]
        ],
        "notes": [
            "Hand indexes are live and change after playAction, trashCard, and draws.",
            "drawHorizon shows the top cards that can plausibly be drawn this turn if you play draw actions.",
            "Use submit_deck_turn once with a complete sequence; the tool will validate against the real CLI and return retry feedback if needed.",
        ],
    }


def draw_horizon(game: dict[str, Any]) -> dict[str, Any]:
    active = game["players"][game["activePlayer"]]
    cards = game["cards"]
    hand = list(active["hand"])
    draw = list(active["draw"])
    actions = active["actions"]
    horizon = 0
    visible: list[str] = []
    simulated_hand = list(hand)
    cap = 20
    while actions > 0 and horizon < cap:
        playable = [
            card_id
            for card_id in simulated_hand
            if cards.get(card_id, {}).get("type") == "action" and card_draw_count(cards.get(card_id, {})) > 0
        ]
        if not playable:
            break
        card_id = max(playable, key=lambda candidate: card_draw_count(cards.get(candidate, {})))
        simulated_hand.remove(card_id)
        actions -= 1
        actions += card_action_count(cards.get(card_id, {}))
        draw_count = card_draw_count(cards.get(card_id, {}))
        for _ in range(draw_count):
            if draw:
                drawn = draw.pop(0)
                simulated_hand.append(drawn)
                visible.append(drawn)
                horizon += 1
            elif active["discard"]:
                horizon += 1
                break
        if not draw and active["discard"]:
            break
    return {
        "maxVisibleDraws": horizon,
        "drawTop": visible,
        "shuffleCouldReachDiscard": horizon > len(visible),
        "discardIfShuffled": active["discard"] if horizon > len(visible) else [],
    }


def card_draw_count(card: dict[str, Any]) -> int:
    return sum(int(effect.get("cards", 0)) for effect in card.get("effects", []) if effect.get("kind") == "grant")


def card_action_count(card: dict[str, Any]) -> int:
    return sum(int(effect.get("actions", 0)) for effect in card.get("effects", []) if effect.get("kind") == "grant")


def board_context(run_dir: Path, player_id: str) -> dict[str, Any]:
    board = read_json(run_dir / "board.json")
    map_data = read_json(ROOT / "game" / "map.json")
    unit_rules = read_json(ROOT / "game" / "units.json")
    return {
        "turn": board["turn"],
        "units": [
            {
                "id": unit["id"],
                "p": unit["player"],
                "t": unit["type"],
                "c": unit["col"],
                "r": unit["row"],
                "hp": unit["hp"],
                "max": unit["maxHp"],
                "atk": unit["attack"],
            }
            for unit in board["units"]
        ],
        "supplyControl": board["supplyControl"],
        "supply": board["supply"],
        "homeBases": map_data["homeBases"],
        "supplyCenters": map_data["supplyCenters"],
        "unitRules": unit_rules,
        "legalMovementOptions": legal_movement_options(board, map_data, unit_rules, player_id),
    }


def legal_movement_options(board: dict[str, Any], map_data: dict[str, Any], unit_rules: dict[str, Any], player_id: str) -> list[dict[str, Any]]:
    units = board["units"]
    hexes = {coord_key(hex_) for hex_ in map_data["hexes"]}
    blocked = {coord_key(hex_) for hex_ in map_data["blocked"]}
    enemy_blocked = {coord_key({"col": unit["col"], "row": unit["row"]}) for unit in units if unit["player"] != player_id}
    occupied = {coord_key({"col": unit["col"], "row": unit["row"]}): unit["id"] for unit in units}
    centers = {coord_key(center): center["id"] for center in map_data["supplyCenters"]}
    options = []
    for unit in units:
        if unit["player"] != player_id:
            continue
        movement = unit_rules[unit["type"]]["movement"]
        start = {"col": unit["col"], "row": unit["row"]}
        destinations = []
        queue = [(start, 0)]
        seen = {coord_key(start)}
        while queue:
            coord, distance = queue.pop(0)
            if distance >= movement:
                continue
            for neighbor in neighbor_coords(coord):
                key = coord_key(neighbor)
                if key in seen or key not in hexes or key in blocked or key in enemy_blocked:
                    continue
                seen.add(key)
                next_distance = distance + 1
                queue.append((neighbor, next_distance))
                if occupied.get(key) is None:
                    entry: dict[str, Any] = {"to": neighbor, "distance": next_distance}
                    if key in centers:
                        entry["center"] = centers[key]
                    destinations.append(entry)
        destinations.sort(key=lambda entry: (0 if "center" in entry else 1, entry["distance"], entry["to"]["col"], entry["to"]["row"]))
        options.append({"unit": unit["id"], "from": start, "movement": movement, "destinations": destinations})
    return options


def neighbor_coords(coord: dict[str, int]) -> list[dict[str, int]]:
    col = coord["col"]
    row = coord["row"]
    if abs(col) % 2 == 0:
        deltas = [(0, -1), (1, -1), (1, 0), (0, 1), (-1, 0), (-1, -1)]
    else:
        deltas = [(0, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0)]
    return [{"col": col + delta_col, "row": row + delta_row} for delta_col, delta_row in deltas]


def coord_key(coord: dict[str, int]) -> str:
    return f"{coord['col']},{coord['row']}"


def write_runner_state(args: argparse.Namespace, run_dir: Path, players: list[Player]) -> None:
    write_json(
        run_dir / "runner-state.json",
        {
            "schemaVersion": 1,
            "runner": "thinharness-tools",
            "model": args.model,
            "effort": args.effort,
            "drafts": drafts(args),
            "players": {player.id: {"strategy": player.strategy} for player in players},
        },
    )


def append_turn_timing(run_dir: Path, turn_id: str, player_id: str, elapsed: float, result: TurnResult) -> None:
    path = run_dir / "timings.jsonl"
    with path.open("a") as file:
        file.write(
            json.dumps(
                {
                    "turnId": turn_id,
                    "player": player_id,
                    "elapsedSeconds": elapsed,
                    "modelSeconds": result.model_seconds,
                    "usage": result.usage or {},
                },
                separators=(",", ":"),
            )
            + "\n"
        )


def load_thinharness_system_prompt() -> str:
    return "\n\n".join(
        [
            load_system_prompt(),
            (ROOT / "agent-context" / "prompts" / "thinharness-player.system.md").read_text().strip(),
        ]
    )


def snapshot_thinharness_system_prompt(run_dir: Path) -> None:
    write_text(run_dir / "context" / "thinharness-player.system.rendered.md", load_thinharness_system_prompt())


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value + ("\n" if not value.endswith("\n") else ""))


def append_text(path: Path, text: str) -> None:
    if not text:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as file:
        file.write(text)
        if not text.endswith("\n"):
            file.write("\n")


if __name__ == "__main__":
    raise SystemExit(main())
