#!/usr/bin/env python3
"""Run a complete Skirmish playthrough with ThinHarness validation tools."""

from __future__ import annotations

import argparse
import json
import re
import shutil
from itertools import permutations
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from playtest_context import hex_distance, state_briefing, system_prompt, write_context_snapshot
from run_game import DEFAULT_CONFIG, DEFAULT_MAP, DEFAULT_RULESET, committed_expected_turn, ensure_initialized, expected_next_turn_id, read_json, rel, run, validate_reset_run_dir, validate_run, write_json

from pydantic import BaseModel, ConfigDict, Field
from thinharness import Harness, HarnessConfig, ToolResult, ToolSpec

ROOT = Path(__file__).resolve().parents[1]


class Coord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    col: int = Field(description="Column from an exact coordinate listed in the current briefing")
    row: int = Field(description="Row from the same exact coordinate listed in the current briefing")


class SetupUnit(Coord):
    id: str = Field(min_length=1)
    type: Literal["soldier", "archer"]


class PlayerSetup(BaseModel):
    model_config = ConfigDict(extra="forbid")
    draft: list[str] = Field(default_factory=list, max_length=3)
    units: list[SetupUnit] = Field(min_length=5, max_length=5)


class PlayAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["playAction"]
    handIndex: int = Field(ge=0)


class TrashCard(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["trashCard"]
    handIndex: int = Field(ge=0)


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


DeckChoice = PlayAction | TrashCard | ResolveSkip | ResolveSelect | ResolveLookahead


class Activation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    unit: str = Field(description="A surviving friendly unit id from activationOptions")
    attackPlan: str = Field(default="", description="An exact attack plan id from this unit's attackChoicesByVia, or an empty string for no attack")
    to: Coord = Field(description="Preferred final coordinate; copy a listed legal endpoint when possible, otherwise the harness uses the nearest legal endpoint")


class Upgrade(BaseModel):
    model_config = ConfigDict(extra="forbid")
    target: str = Field(description="A target from legalUpgrades")
    stat: Literal["attack", "movement", "range"] = Field(description="The matching stat from legalUpgrades")
    to: int = Field(gt=0, description="The resulting stat value from legalUpgrades; this value is also the symbol cost")


class BoardActions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    upgrades: list[Upgrade] = Field(default_factory=list)
    activations: list[Activation] = Field(default_factory=list)


class SubmitDeckTurnArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actions: list[DeckChoice] = Field(default_factory=list, description="Optional action, free-trash, or pending-effect choices; do not include moveToBuy, buyCard, or endTurn")
    buyCard: str = Field(default="", description="One card id to buy after actions and treasures, or an empty string to buy nothing")
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


class TurnTools:
    def __init__(self, args: argparse.Namespace, run_dir: Path, player: Player, turn_id: str, previous_entries: int):
        self.args = args
        self.run_dir = run_dir
        self.player = player
        self.turn_id = turn_id
        self.previous_entries = previous_entries
        self.deck_done = False
        self.board_done = False
        self.deck_result = run_dir / "results" / f"{turn_id}.deck.result.json"
        self.board_result = run_dir / "results" / f"{turn_id}.board.result.json"

    def specs(self) -> list[ToolSpec]:
        return [
            ToolSpec("submit_deck_turn", "Choose optional action/trash choices plus one optional buyCard. Never put treasures, moveToBuy, buyCard, or endTurn in actions. Free-trash choices are alternatives, so choose at most one. The harness plays treasures, performs the purchase, and ends the turn. Use resolvePending only for a current pending effect.", SubmitDeckTurnArgs, self.submit_deck_turn, max_retries=self.args.tool_retries, sequential=True),
            ToolSpec("submit_board_turn", "After the deck succeeds, submit only listed legalUpgrades and activate every surviving friendly unit. For attacks, copy one attackPlan id. The harness derives from, via, and target, and snaps each preferred to coordinate to the nearest legal endpoint when necessary.", SubmitBoardTurnArgs, self.submit_board_turn, max_retries=self.args.tool_retries, sequential=True),
        ]

    def submit_deck_turn(self, submitted: SubmitDeckTurnArgs) -> ToolResult:
        submission = submitted.model_dump(by_alias=True, exclude_none=True)
        if self.deck_done:
            produced = read_json(self.deck_result)["produced"]
            briefing = state_briefing(self.run_dir, self.player.id, produced)
            return ToolResult(True, json.dumps({"status": "alreadyValid", "message": "Deck turn is finished; do not submit it again.", "boardBriefing": briefing, "next": "submit_board_turn"}, separators=(",", ":")))
        before = (self.run_dir / "deck.json").read_text()
        action_path = self.run_dir / "actions" / f"{self.turn_id}.deck.json"
        normalized_actions = normalize_deck_actions(submitted.actions, submitted.buyCard)
        write_json(action_path, {"schemaVersion": 1, "turnId": self.turn_id, "player": self.player.id, "actions": normalized_actions})
        result = run([
            "bun", "run", "--silent", "cli", "--", "deck-turn", "--config", self.args.config,
            "--state", rel(self.run_dir / "deck.json"), "--actions", rel(action_path), "--result", rel(self.deck_result),
        ], check=False)
        append_log(self.run_dir / "logs" / f"{self.turn_id}.deck.txt", result.stdout + result.stderr)
        if result.returncode != 0:
            (self.run_dir / "deck.json").write_text(before)
            return self.retry("deck", result.stdout + result.stderr, submission)
        self.deck_done = True
        record_submission(self.run_dir, self.turn_id, self.player.id, "deck", submission, accepted=True)
        produced = read_json(self.deck_result)["produced"]
        briefing = state_briefing(self.run_dir, self.player.id, produced)
        return ToolResult(True, json.dumps({"status": "valid", "normalizedActions": normalized_actions, "produced": produced, "boardBriefing": briefing, "next": "submit_board_turn"}, separators=(",", ":")))

    def submit_board_turn(self, submitted: SubmitBoardTurnArgs) -> ToolResult:
        submission = submitted.model_dump(by_alias=True, exclude_none=True)
        if not self.deck_done:
            return self.retry("board", "submit_deck_turn must succeed first.", submission)
        if self.board_done:
            return ToolResult(True, json.dumps({"status": "alreadyCommitted", "turnId": self.turn_id, "next": "answer done"}, separators=(",", ":")))
        board_before = (self.run_dir / "board.json").read_text()
        timeline_before = (self.run_dir / "timeline.json").read_text()
        action_path = self.run_dir / "actions" / f"{self.turn_id}.board.json"
        produced = read_json(self.deck_result)["produced"]
        briefing = state_briefing(self.run_dir, self.player.id, produced)
        try:
            actions_payload = board_actions_payload(submitted.actions, briefing["activationOptions"])
        except ValueError as error:
            return self.retry("board", str(error), submission)
        actions_payload = remove_redundant_attacks(actions_payload, read_json(self.run_dir / "board.json"), briefing["automaticKeyPointUpgrades"])
        result = self.execute_board_actions(action_path, actions_payload)
        append_log(self.run_dir / "logs" / f"{self.turn_id}.board.txt", result.stdout + result.stderr)
        if result.returncode != 0:
            (self.run_dir / "board.json").write_text(board_before)
            return self.retry("board", result.stdout + result.stderr, submission)

        completed = self.previous_entries + 1
        terminal = terminal_events(read_json(self.run_dir / "board.json"), completed, self.args.max_turns)
        command = [
            "bun", "run", "--silent", "playtest", "--", "commit-turn", "--run", rel(self.run_dir),
            "--deck-result", rel(self.deck_result), "--board-result", rel(self.board_result),
            "--summary", submitted.summary, "--reasoning", submitted.reasoning, "--strict-win",
        ]
        if terminal:
            event_path = self.run_dir / "results" / f"{self.turn_id}.win-events.json"
            write_json(event_path, terminal)
            command.extend(["--win-events", rel(event_path), "--terminal-win-events", rel(event_path)])
        commit = run(command, check=False)
        append_log(self.run_dir / "logs" / f"{self.turn_id}.commit.txt", commit.stdout + commit.stderr)
        if commit.returncode != 0:
            (self.run_dir / "board.json").write_text(board_before)
            (self.run_dir / "timeline.json").write_text(timeline_before)
            return self.retry("board", commit.stdout + commit.stderr, submission)
        validation = validate_run(self.run_dir)
        timeline = read_json(self.run_dir / "timeline.json")
        if validation.returncode != 0 or not committed_expected_turn(timeline, self.previous_entries, self.turn_id, self.player.id):
            (self.run_dir / "board.json").write_text(board_before)
            (self.run_dir / "timeline.json").write_text(timeline_before)
            return self.retry("board", validation.stdout + validation.stderr, submission)
        self.board_done = True
        record_submission(self.run_dir, self.turn_id, self.player.id, "board", submission, accepted=True)
        return ToolResult(True, json.dumps({"status": "committed", "turnId": self.turn_id}, separators=(",", ":")))

    def execute_board_actions(self, action_path: Path, actions_payload: dict[str, Any]):
        command = [
            "bun", "run", "--silent", "cli", "--", "board-turn", "--state", rel(self.run_dir / "board.json"),
            "--deck-result", rel(self.deck_result), "--actions", rel(action_path), "--result", rel(self.board_result),
        ]
        last_result = None
        for candidate in activation_order_candidates(actions_payload):
            write_json(action_path, {"schemaVersion": 1, "turnId": self.turn_id, "player": self.player.id, "actions": candidate})
            last_result = run(command, check=False)
            if last_result.returncode == 0:
                return last_result
            message = last_result.stdout + last_result.stderr
            if not re.search(r"moved \d+, exceeding movement|occupied hex", message, re.IGNORECASE):
                return last_result
        if last_result is None:
            raise RuntimeError("No board activation order was generated")
        return last_result

    def retry(self, action_shape: str, message: str, submission: dict[str, Any]) -> ToolResult:
        record_retry(self.run_dir, action_shape)
        record_submission(self.run_dir, self.turn_id, self.player.id, action_shape, submission, accepted=False, message=message)
        produced = read_json(self.deck_result)["produced"] if self.deck_result.exists() else None
        briefing = state_briefing(self.run_dir, self.player.id, produced)
        return ToolResult(False, f"{message.strip()}\nCurrent state: {json.dumps(briefing, separators=(',', ':'))}", {"error_type": f"Invalid{action_shape.title()}", "retry": True})


def terminal_events(board: dict[str, Any], completed: int, cap: int) -> list[dict[str, Any]]:
    players = board["players"]
    armies = {player: [unit for unit in board["units"] if unit["player"] == player] for player in players}
    eliminated = any(len(armies[player]) == 0 for player in players)
    if not eliminated and completed < cap:
        return []
    first, second = players
    winner: str | None = None
    if len(armies[first]) != len(armies[second]):
        winner = first if len(armies[first]) > len(armies[second]) else second
    else:
        hp = {player: sum(unit["hp"] for unit in armies[player]) for player in players}
        if hp[first] != hp[second]:
            winner = first if hp[first] > hp[second] else second
    if winner is None:
        return [{"type": "elimination" if eliminated else "turnCap", "outcome": "draw", "player": None, "completedTurns": completed, "playerUnits": len(armies[first]), "opponentUnits": len(armies[second]), "playerHp": sum(unit["hp"] for unit in armies[first]), "opponentHp": sum(unit["hp"] for unit in armies[second])}]
    opponent = second if winner == first else first
    return [{"type": "elimination" if eliminated else "turnCap", "outcome": "win", "player": winner, "completedTurns": completed, "playerUnits": len(armies[winner]), "opponentUnits": len(armies[opponent]), "playerHp": sum(unit["hp"] for unit in armies[winner]), "opponentHp": sum(unit["hp"] for unit in armies[opponent])}]


def normalize_deck_actions(actions: list[DeckChoice], buy_card: str = "") -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    trashed = False
    for action in actions:
        payload = action.model_dump()
        if payload["type"] == "trashCard":
            if trashed:
                continue
            trashed = True
        normalized.append(payload)
    normalized.append({"type": "moveToBuy"})
    if buy_card:
        normalized.append({"type": "buyCard", "cardId": buy_card})
    normalized.append({"type": "endTurn"})
    return normalized


def board_actions_payload(actions: BoardActions, activation_options: list[dict[str, Any]]) -> dict[str, Any]:
    options_by_unit = {option["unit"]: option for option in activation_options}
    activations = []
    activated: set[str] = set()
    for activation in actions.activations:
        if activation.unit in activated:
            raise ValueError(f"{activation.unit} has multiple activations; submit each surviving unit once")
        activated.add(activation.unit)
        option = options_by_unit.get(activation.unit)
        if not option:
            raise ValueError(f"{activation.unit} is not a surviving friendly unit in activationOptions")
        to = activation.to.model_dump()
        payload: dict[str, Any] = {"unit": activation.unit, "from": option["from"], "to": to}
        if not activation.attackPlan:
            payload["to"] = closest_legal_coord(to, option["noAttackTo"])
            activations.append(payload)
            continue
        selected: tuple[dict[str, Any], dict[str, str]] | None = None
        for choice in option["attackChoicesByVia"]:
            attack = next((candidate for candidate in choice["attacks"] if candidate["id"] == activation.attackPlan), None)
            if attack:
                selected = choice, attack
                break
        if not selected:
            raise ValueError(f"{activation.unit} attackPlan is not listed for that unit")
        choice, attack = selected
        payload.update({
            "to": closest_legal_coord(to, choice["to"]),
            "via": choice["via"],
            "attack": {"target": attack["target"]},
        })
        activations.append(payload)
    return {"upgrades": [upgrade.model_dump() for upgrade in actions.upgrades], "activations": activations}


def closest_legal_coord(desired: dict[str, int], legal: list[dict[str, int]]) -> dict[str, int]:
    if not legal:
        raise ValueError("No legal destination is available")
    return min(legal, key=lambda candidate: hex_distance(candidate, desired))


def remove_redundant_attacks(
    actions_payload: dict[str, Any],
    board: dict[str, Any],
    automatic_upgrades: list[dict[str, Any]],
) -> dict[str, Any]:
    normalized = json.loads(json.dumps(actions_payload))
    units = {unit["id"]: unit for unit in board["units"]}
    attack_values = {unit_id: unit["attack"] for unit_id, unit in units.items()}
    remaining_hp = {unit_id: unit["hp"] for unit_id, unit in units.items()}
    for upgrade in [*automatic_upgrades, *normalized["upgrades"]]:
        if upgrade["stat"] == "attack":
            attack_values[upgrade["target"]] = upgrade["to"]
    for activation in normalized["activations"]:
        attack = activation.get("attack")
        if not attack:
            continue
        target = attack["target"]
        if remaining_hp.get(target, 0) <= 0:
            activation.pop("attack", None)
            activation.pop("via", None)
            continue
        remaining_hp[target] -= attack_values.get(activation["unit"], 0)
    return normalized


def activation_order_candidates(actions_payload: dict[str, Any]):
    activations = actions_payload["activations"]
    seen: set[tuple[str, ...]] = set()
    preferred = [
        activations,
        [*filter(lambda item: "attack" not in item, activations), *filter(lambda item: "attack" in item, activations)],
        [*filter(lambda item: "attack" in item, activations), *filter(lambda item: "attack" not in item, activations)],
        list(reversed(activations)),
    ]
    orders = preferred if len(activations) > 7 else [*preferred, *permutations(activations)]
    for order in orders:
        key = tuple(activation["unit"] for activation in order)
        if key in seen:
            continue
        seen.add(key)
        yield {**actions_payload, "activations": list(order)}


def main() -> int:
    args = parse_args()
    run_dir = Path(args.run)
    if not run_dir.is_absolute():
        run_dir = ROOT / run_dir
    if args.reset and run_dir.exists():
        shutil.rmtree(validate_reset_run_dir(run_dir))
    for name in ("actions", "results", "logs", "context"):
        (run_dir / name).mkdir(parents=True, exist_ok=True)
    setups = {"P1": load_setup(args.p1_setup), "P2": load_setup(args.p2_setup)}
    ensure_initialized(args, run_dir, setups)
    args.max_turns = int(read_json(run_dir / "timeline.json")["run"]["turnCap"])
    write_context_snapshot(run_dir)
    players = [Player("P1", args.p1_strategy), Player("P2", args.p2_strategy)]

    while True:
        timeline = read_json(run_dir / "timeline.json")
        if timeline.get("terminalWinEvents"):
            print(json.dumps(timeline["terminalWinEvents"], indent=2))
            print(json.dumps({"submissionMetrics": submission_metrics_summary(run_dir)}, indent=2))
            return 0
        previous_entries = len(timeline.get("entries", []))
        if previous_entries >= args.max_turns:
            print("Turn cap reached without a terminal event", file=sys.stderr)
            return 1
        active = read_json(run_dir / "board.json")["turn"]["activePlayer"]
        player = next(candidate for candidate in players if candidate.id == active)
        turn_id = expected_next_turn_id(timeline)
        tools = TurnTools(args, run_dir, player, turn_id, previous_entries)
        prompt = "\n\n".join([
            (ROOT / "agent-context/prompts/playtest-initial.user.md").read_text().strip() if previous_entries == 0 else (ROOT / "agent-context/prompts/playtest-turn.user.md").read_text().strip(),
            f"Strategy: {player.strategy}",
            json.dumps(state_briefing(run_dir, player.id), separators=(",", ":")),
        ])
        config = HarnessConfig(root=ROOT, model=args.model, system_prompt=system_prompt(), builtin_tools=[], max_model_requests=args.max_model_requests, max_tool_calls=args.max_tool_calls, tool_retries=args.tool_retries, request_timeout=args.timeout_seconds, extra_body={"reasoning": {"effort": args.effort}} if args.model.startswith("openai:") else {})
        started = time.monotonic()
        result = Harness(config, tools=tools.specs()).run_sync(prompt)
        record_harness_tool_calls(run_dir, turn_id, result.tool_call_records)
        append_log(run_dir / "logs" / f"{turn_id}.model.txt", result.text)
        if not tools.board_done:
            print(f"{turn_id} ended without a committed board turn", file=sys.stderr)
            return 1
        print(f"{turn_id} committed in {time.monotonic() - started:.1f}s", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a strict Skirmish playthrough through ThinHarness.")
    parser.add_argument("--run", required=True)
    parser.add_argument("--p1-setup", required=True, help="PlayerSetup JSON or path")
    parser.add_argument("--p2-setup", required=True, help="PlayerSetup JSON or path")
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--ruleset", default=DEFAULT_RULESET)
    parser.add_argument("--map", default=DEFAULT_MAP)
    parser.add_argument("--config", default=DEFAULT_CONFIG)
    parser.add_argument("--title", default="Skirmish ThinHarness playthrough")
    parser.add_argument("--seed", type=int, default=2106)
    parser.add_argument("--max-turns", type=int, default=20, help="Maximum completed player turns (default: 20)")
    parser.add_argument("--model", default="openai:gpt-5.6-luna")
    parser.add_argument("--effort", default="low")
    parser.add_argument("--timeout-seconds", type=int, default=180)
    parser.add_argument("--tool-retries", type=int, default=5)
    parser.add_argument("--max-model-requests", type=int, default=20)
    parser.add_argument("--max-tool-calls", type=int, default=20)
    parser.add_argument("--p1-strategy", default="Advance toward key points, preserve units, and build a coherent upgrade lane.")
    parser.add_argument("--p2-strategy", default="Contest key points, preserve units, and exploit favorable lines of sight.")
    return parser.parse_args()


def load_setup(value: str) -> dict[str, Any]:
    if value.lstrip().startswith("{"):
        raw = json.loads(value)
    else:
        raw = json.loads(Path(value).read_text())
    return PlayerSetup.model_validate(raw).model_dump()


def record_retry(run_dir: Path, action_shape: str) -> None:
    path = run_dir / "retry-counts.json"
    counts = read_json(path) if path.exists() else {"deck": 0, "board": 0}
    counts[action_shape] = counts.get(action_shape, 0) + 1
    write_json(path, counts)


def record_submission(
    run_dir: Path,
    turn_id: str,
    player: str,
    phase: str,
    submission: dict[str, Any],
    *,
    accepted: bool,
    message: str = "",
) -> None:
    path = run_dir / "submission-metrics.json"
    metrics = read_json(path) if path.exists() else {
        "schemaVersion": 1,
        "totals": {},
        "rejectionReasons": {},
        "turns": {},
        "events": [],
    }
    phase_totals = metrics["totals"].setdefault(phase, {"attempts": 0, "accepted": 0, "rejected": 0})
    phase_totals["attempts"] += 1
    phase_totals["accepted" if accepted else "rejected"] += 1
    turn = metrics["turns"].setdefault(turn_id, {"player": player, "deck": {"attempts": 0, "accepted": 0, "rejected": 0}, "board": {"attempts": 0, "accepted": 0, "rejected": 0}})
    turn_phase = turn[phase]
    turn_phase["attempts"] += 1
    turn_phase["accepted" if accepted else "rejected"] += 1
    event: dict[str, Any] = {
        "turnId": turn_id,
        "player": player,
        "phase": phase,
        "attempt": turn_phase["attempts"],
        "outcome": "accepted" if accepted else "rejected",
        "submission": submission,
    }
    if not accepted:
        reason, detail = normalize_rejection(message)
        event.update({"reason": reason, "detail": detail})
        metrics["rejectionReasons"][reason] = metrics["rejectionReasons"].get(reason, 0) + 1
    metrics["events"].append(event)
    write_json(path, metrics)


def normalize_rejection(message: str) -> tuple[str, str]:
    detail = next((line.strip() for line in re.sub(r"\x1b\[[0-9;]*m", "", message).splitlines() if line.strip()), "Unknown validation error")
    patterns = [
        (r"moved \d+, exceeding movement", "movementBudget"),
        (r"upgrades spend .* exceeding produced", "upgradeBudget"),
        (r"can only be raised once per turn", "duplicateUpgrade"),
        (r"Illegal action", "illegalDeckAction"),
        (r"must succeed first", "toolOrder"),
        (r"already (valid|committed)", "duplicateSubmission"),
        (r"occupied hex", "occupiedDestination"),
        (r"no line of sight|at range .* exceeding range", "invalidAttack"),
    ]
    for pattern, reason in patterns:
        if re.search(pattern, detail, re.IGNORECASE):
            return reason, detail
    return "validation", detail


def record_harness_tool_calls(run_dir: Path, turn_id: str, records: list[dict[str, Any]]) -> None:
    path = run_dir / "harness-tool-calls.json"
    trace = read_json(path) if path.exists() else {"schemaVersion": 1, "turns": {}}
    trace["turns"][turn_id] = records
    write_json(path, trace)


def submission_metrics_summary(run_dir: Path) -> dict[str, Any]:
    metrics_path = run_dir / "submission-metrics.json"
    metrics = read_json(metrics_path) if metrics_path.exists() else {}
    trace_path = run_dir / "harness-tool-calls.json"
    if not trace_path.exists():
        return {"totals": metrics.get("totals", {}), "rejectionReasons": metrics.get("rejectionReasons", {})}
    totals: dict[str, dict[str, int]] = {}
    rejection_types: dict[str, int] = {}
    for records in read_json(trace_path).get("turns", {}).values():
        for record in records:
            name = record.get("call", {}).get("name", "")
            phase = "deck" if name == "submit_deck_turn" else "board" if name == "submit_board_turn" else name
            if not phase:
                continue
            phase_totals = totals.setdefault(phase, {"attempts": 0, "accepted": 0, "rejected": 0})
            phase_totals["attempts"] += 1
            try:
                envelope = json.loads(record.get("output", ""))
            except (json.JSONDecodeError, TypeError):
                envelope = {"ok": False, "metadata": {"error_type": "InvalidToolOutput"}}
            accepted = envelope.get("ok") is True
            phase_totals["accepted" if accepted else "rejected"] += 1
            if not accepted:
                reason = envelope.get("metadata", {}).get("error_type", "ToolRejected")
                rejection_types[reason] = rejection_types.get(reason, 0) + 1
    return {
        "totals": totals,
        "rejectionReasons": metrics.get("rejectionReasons", {}),
        "toolRejectionTypes": rejection_types,
    }


def append_log(path: Path, text: str) -> None:
    if not text:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as file:
        file.write(text)
        if not text.endswith("\n"):
            file.write("\n")


if __name__ == "__main__":
    raise SystemExit(main())
