#!/usr/bin/env python3
"""Run an adversarial Deckfront playthrough with two Claude Code sessions.

The runner owns setup and alternation. Each Claude session owns its player's
turns and is allowed to mutate the shared run directory on that player's turn.
The existing Deckfront CLIs remain the source of truth for legality.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import textwrap
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RULESET = "territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6"
DEFAULT_MAP = "sketch-v5-recenter"
DEFAULT_CONFIG = f"rulesets/{DEFAULT_RULESET}/deck.yaml"
DEFAULT_DRAFTS = ("P1=blast,zap,silver", "P2=village,smithy,peddler")
DEFAULT_MODEL = "claude-opus-4-8"
DEFAULT_EFFORT = "low"
DEFAULT_TIMEOUT_SECONDS = 180
DEFAULT_P1_UNITS = "raider,scout,raider,marksman"
DEFAULT_P2_UNITS = "raider,scout,guardian,marksman"


@dataclass(frozen=True)
class Player:
    id: str
    strategy: str
    session_id: str


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
        Player("P1", args.p1_strategy, str(uuid.uuid4())),
        Player("P2", args.p2_strategy, str(uuid.uuid4())),
    ]

    ensure_initialized(args, run_dir)
    write_runner_state(args, run_dir, players)
    started_sessions: set[str] = set()

    for _ in range(args.max_turns):
        timeline = read_json(run_dir / "timeline.json")
        if timeline.get("terminalWinEvents"):
            print(f"Game already ended with terminal win events in {run_dir / 'timeline.json'}")
            return 0

        active_player = read_json(run_dir / "board.json")["turn"]["activePlayer"]
        player = next(candidate for candidate in players if candidate.id == active_player)
        previous_entries = len(timeline.get("entries", []))
        next_turn = previous_entries + 1
        turn_id = f"turn-{next_turn:03d}"

        print(f"\n=== {turn_id} {player.id} ===", flush=True)
        prompt = build_turn_prompt(args, run_dir, player, turn_id)
        result = run_claude_turn(args, run_dir, player, prompt, resume=player.session_id in started_sessions)
        started_sessions.add(player.session_id)
        append_text(run_dir / "logs" / f"{turn_id}.{player.id}.claude.txt", result.stdout)
        if result.stderr:
            append_text(run_dir / "logs" / f"{turn_id}.{player.id}.claude.stderr.txt", result.stderr)
        if result.returncode != 0:
            print(result.stdout)
            print(result.stderr, file=sys.stderr)
            return result.returncode

        validation = validate_run(args, run_dir)
        append_text(run_dir / "logs" / f"{turn_id}.validate.txt", validation.stdout + validation.stderr)
        if validation.returncode != 0:
            print(validation.stdout)
            print(validation.stderr, file=sys.stderr)
            if args.retry_on_invalid > 0:
                retry_ok = retry_invalid_turn(args, run_dir, player, turn_id, previous_entries, validation.stderr or validation.stdout)
                if not retry_ok:
                    return 1
            else:
                return validation.returncode

        timeline = read_json(run_dir / "timeline.json")
        if not committed_expected_turn(timeline, previous_entries, turn_id, player.id):
            error = f"{player.id} did not commit exactly one expected entry ({turn_id})"
            print(error, file=sys.stderr)
            if args.retry_on_invalid > 0:
                retry_ok = retry_invalid_turn(args, run_dir, player, turn_id, previous_entries, error)
                if not retry_ok:
                    return 1
            else:
                return 1

        timeline = read_json(run_dir / "timeline.json")
        print(f"Validated {len(timeline.get('entries', []))} entries", flush=True)
        if timeline.get("terminalWinEvents"):
            print(f"Game ended: {json.dumps(timeline['terminalWinEvents'], indent=2)}")
            return 0

        time.sleep(args.turn_delay)

    print(f"Stopped at max turns: {args.max_turns}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a two-Claude-agent Deckfront playthrough.")
    parser.add_argument("--run", required=True, help="Run directory, usually under .games/")
    parser.add_argument("--reset", action="store_true", help="Delete and recreate the run directory before starting.")
    parser.add_argument("--ruleset", default=DEFAULT_RULESET)
    parser.add_argument("--map", default=DEFAULT_MAP)
    parser.add_argument("--board", default=None, help="Starter board JSON. If omitted, the runner writes one from --p1-units/--p2-units.")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="Deck config YAML.")
    parser.add_argument("--title", default="Claude-vs-Claude E024 playthrough")
    parser.add_argument("--seed", type=int, default=2106)
    parser.add_argument("--draft", action="append", default=None, help="Draft override. Repeat once per player. Defaults to the E024 rush-vs-engine drafts.")
    parser.add_argument("--p1-units", default=DEFAULT_P1_UNITS, help="Comma-separated P1 starting units when --board is omitted.")
    parser.add_argument("--p2-units", default=DEFAULT_P2_UNITS, help="Comma-separated P2 starting units when --board is omitted.")
    parser.add_argument("--max-turns", type=int, default=30)
    parser.add_argument("--turn-delay", type=float, default=0.0)
    parser.add_argument("--retry-on-invalid", type=int, default=1)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--effort", default=DEFAULT_EFFORT)
    parser.add_argument("--permission-mode", default="bypassPermissions")
    parser.add_argument("--claude-bin", default="claude")
    parser.add_argument("--timeout-seconds", type=int, default=DEFAULT_TIMEOUT_SECONDS)
    parser.add_argument(
        "--p1-strategy",
        default="Rush: contest centers early with high-movement units, convert center income into recruits, buy damage/cycling cards, and win by board pressure.",
    )
    parser.add_argument(
        "--p2-strategy",
        default="Engine/control: still contest centers early with competent unit play, but use deck buys to build draw/economy into damage and stabilization.",
    )
    return parser.parse_args()


def ensure_initialized(args: argparse.Namespace, run_dir: Path) -> None:
    if (run_dir / "deck.json").exists() and (run_dir / "board.json").exists() and (run_dir / "timeline.json").exists():
        return

    board_path = args.board if args.board else write_starter_board(args, run_dir)
    run(
        [
            "bun",
            "run",
            "init-run",
            "--",
            "--run",
            rel(run_dir),
            "--ruleset",
            args.ruleset,
            "--map",
            args.map,
            "--board",
            board_path,
            "--title",
            args.title,
        ],
        check=True,
    )
    deck_cmd = [
        "bun",
        "run",
        "cli",
        "--",
        "--config",
        args.config,
        "--state",
        rel(run_dir / "deck.json"),
        "--seed",
        str(args.seed),
        "--max-actions",
        "0",
    ]
    for draft in drafts(args):
        deck_cmd.extend(["--draft", draft])
    run(deck_cmd, check=True)


def write_starter_board(args: argparse.Namespace, run_dir: Path) -> str:
    map_data = read_json(ROOT / "maps" / f"{args.map}.json")
    unit_rules = read_json(ROOT / "rulesets" / args.ruleset / "units.json")
    units: list[dict[str, Any]] = []
    for player, unit_names in (("P1", split_csv(args.p1_units)), ("P2", split_csv(args.p2_units))):
        home = next((home_base for home_base in map_data["homeBases"] if home_base["player"] == player), None)
        if home is None:
            raise ValueError(f"Map {args.map} has no home base for {player}")
        if len(unit_names) != len(home["hexes"]):
            raise ValueError(f"{player} needs exactly {len(home['hexes'])} units for home base {home['id']}")
        for index, (unit_type, coord) in enumerate(zip(unit_names, home["hexes"], strict=True), start=1):
            rules = unit_rules.get(unit_type)
            if not rules:
                raise ValueError(f"Unknown unit type for {player}: {unit_type}")
            units.append(
                {
                    "id": f"{player}-{unit_type}-start-{index}",
                    "player": player,
                    "type": unit_type,
                    "col": coord["col"],
                    "row": coord["row"],
                    "hp": rules["hp"],
                    "maxHp": rules["hp"],
                    "attack": rules["attack"],
                }
            )
    board = {
        "schemaVersion": 1,
        "ruleset": args.ruleset,
        "map": args.map,
        "turn": {"activePlayer": "P1", "round": 1},
        "units": units,
        "supplyControl": [{"id": center["id"], "controller": None} for center in map_data["supplyCenters"]],
        "supply": [{"player": "P1", "amount": 0}, {"player": "P2", "amount": 0}],
        "notes": ["Generated by scripts/run_game.py"],
    }
    path = run_dir / "starter-board.json"
    write_json(path, board)
    return rel(path)


def split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def write_runner_state(args: argparse.Namespace, run_dir: Path, players: list[Player]) -> None:
    state = {
        "schemaVersion": 1,
        "model": args.model,
        "effort": args.effort,
        "drafts": drafts(args),
        "players": {player.id: {"sessionId": player.session_id, "strategy": player.strategy} for player in players},
    }
    write_json(run_dir / "runner-state.json", state)


def drafts(args: argparse.Namespace) -> list[str]:
    return list(args.draft if args.draft is not None else DEFAULT_DRAFTS)


def build_turn_prompt(args: argparse.Namespace, run_dir: Path, player: Player, turn_id: str) -> str:
    briefing = build_state_briefing(args, run_dir)
    return textwrap.dedent(
        f"""
        You are {player.id} in Deckfront. Play to maximize {player.id}'s win chance; do not optimize for balance.
        Strategy: {player.strategy}

        Complete exactly one turn now: {turn_id} in {rel(run_dir)}. Use Bash only. Do not read source/docs/rules/maps unless a command error is unclear. Do not create probe files. Use only these exact paths:
        deck actions: {rel(run_dir / "actions" / f"{turn_id}.deck.json")}
        board actions: {rel(run_dir / "actions" / f"{turn_id}.board.json")}
        win events, if strict commit requires them: {rel(run_dir / "actions" / f"{turn_id}.win-events.json")}
        terminal win events, if strict commit requires them: {rel(run_dir / "actions" / f"{turn_id}.terminal-win-events.json")}
        deck result: {rel(run_dir / "results" / f"{turn_id}.deck.result.json")}
        board result: {rel(run_dir / "results" / f"{turn_id}.board.result.json")}

        Briefing JSON: {briefing}

        Deck action file: {{"schemaVersion":1,"turnId":"{turn_id}","player":"{player.id}","actions":[...]}}. Use only briefing.deck.legal actions, then endTurn.
        Hand indices are live: if you trash, trash before play/draw actions and adjust later handIndex values. After moveToBuy, buy a useful card if money/buys allow.
        Board action file: {{"schemaVersion":1,"turnId":"{turn_id}","player":"{player.id}","actions":{{"movements":[],"recruits":[],"attacks":[],"heals":[],"upgrades":[]}}}}.
        Movement objects: {{"unit":"id","from":{{"col":0,"row":0}},"to":{{"col":0,"row":0}}}}. Recruit objects: {{"unit":"new-id","type":"raider","at":{{"col":0,"row":0}}}}. Attack objects: {{"attacker":"id","target":"id","deckDamage":0}}; board-turn computes damage.

        Run the full turn in one Bash call if possible:
        1. write deck actions
        2. `bun run --silent cli -- deck-turn --config {args.config} --state {rel(run_dir / "deck.json")} --actions {rel(run_dir / "actions" / f"{turn_id}.deck.json")} --result {rel(run_dir / "results" / f"{turn_id}.deck.result.json")}`
        3. write board actions
        4. `bun run --silent cli -- board-turn --state {rel(run_dir / "board.json")} --deck-result {rel(run_dir / "results" / f"{turn_id}.deck.result.json")} --actions {rel(run_dir / "actions" / f"{turn_id}.board.json")} --result {rel(run_dir / "results" / f"{turn_id}.board.result.json")}`
        5. `bun run --silent playtest -- commit-turn --run {rel(run_dir)} --deck-result {rel(run_dir / "results" / f"{turn_id}.deck.result.json")} --board-result {rel(run_dir / "results" / f"{turn_id}.board.result.json")} --summary "<summary>" --reasoning "<reasoning>" --strict-win`
        6. `bun run --silent validate-run -- --strict --strict-deck --strict-win {rel(run_dir / "timeline.json")}`

        If strict commit fails because winEvents or terminalWinEvents do not match expected events, copy the expected JSON array exactly into the matching event file above and retry commit with `--win-events <file>` and/or `--terminal-win-events <file>` plus `--strict-win`. Stop after a valid committed turn and print the deck line, board line, and rationale.
        """
    ).strip()


def build_state_briefing(args: argparse.Namespace, run_dir: Path) -> str:
    deck = read_json(run_dir / "deck.json")
    board = read_json(run_dir / "board.json")
    map_data = read_json(ROOT / "maps" / f"{args.map}.json")
    unit_rules = read_json(ROOT / "rulesets" / args.ruleset / "units.json")

    game = deck["game"]
    active_player = game["players"][game["activePlayer"]]
    supply_counts = {entry["card"]: entry["count"] for entry in game["config"]["supply"]}
    cards = []
    for card in game["config"]["cards"]:
        entry: dict[str, Any] = {"id": card["id"], "type": card["type"], "cost": card["cost"], "n": supply_counts.get(card["id"], 0)}
        if "treasure" in card:
            entry["treasure"] = card["treasure"]
        if "effects" in card:
            entry["effects"] = card["effects"]
        cards.append(entry)

    legal_actions = run(
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

    briefing = {
        "activePlayer": active_player["id"],
        "deck": {
            "phase": game["phase"],
            "active": {
                "id": active_player["id"],
                "handIndexed": list(enumerate(active_player["hand"])),
                "hand": active_player["hand"],
                "drawCount": len(active_player["draw"]),
                "discard": active_player["discard"],
                "play": active_player["play"],
                "actions": active_player["actions"],
                "buys": active_player["buys"],
                "money": active_player["money"],
                "attributes": active_player["attributes"],
                "freeTrashUsed": active_player["freeTrashUsed"],
            },
            "legal": [
                {
                    "i": action["index"],
                    "d": action["description"],
                    "a": action["action"],
                }
                for action in json.loads(legal_actions.stdout)["actions"]
            ],
            "market": cards,
        },
        "board": {
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
        },
    }
    return json.dumps(briefing, separators=(",", ":"))


def run_claude_turn(args: argparse.Namespace, run_dir: Path, player: Player, prompt: str, *, resume: bool = False) -> subprocess.CompletedProcess[str]:
    command = [
        args.claude_bin,
        "-p",
        "--safe-mode",
        "--resume" if resume else "--session-id",
        player.session_id,
        "--model",
        args.model,
        "--effort",
        args.effort,
        "--permission-mode",
        args.permission_mode,
        "--output-format",
        "text",
        prompt,
        "--tools",
        "Bash",
        "--add-dir",
        str(ROOT),
    ]
    try:
        return subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=args.timeout_seconds,
        )
    except subprocess.TimeoutExpired as error:
        stdout = error.stdout or ""
        stderr = error.stderr or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode(errors="replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode(errors="replace")
        stderr = f"{stderr}\nClaude turn timed out after {args.timeout_seconds} seconds.".strip()
        return subprocess.CompletedProcess(command, 124, stdout, stderr)


def validate_run(args: argparse.Namespace, run_dir: Path) -> subprocess.CompletedProcess[str]:
    return run(
        ["bun", "run", "validate-run", "--", "--strict", "--strict-deck", "--strict-win", rel(run_dir / "timeline.json")],
        check=False,
    )


def retry_invalid_turn(args: argparse.Namespace, run_dir: Path, player: Player, turn_id: str, previous_entries: int, error: str) -> bool:
    for attempt in range(args.retry_on_invalid):
        print(f"Validation failed for {turn_id}; asking {player.id} to repair attempt {attempt + 1}", flush=True)
        prompt = textwrap.dedent(
            f"""
            Your previous {turn_id} move left the run invalid.

            Validation error:
            {error}

            Repair the same turn in {rel(run_dir)}. You may inspect current files and rerun the CLIs.
            Do not take any later turn. Finish with a valid committed {turn_id} replay entry.
            """
        ).strip()
        result = run_claude_turn(args, run_dir, player, prompt, resume=True)
        append_text(run_dir / "logs" / f"{turn_id}.{player.id}.repair-{attempt + 1}.claude.txt", result.stdout)
        if result.stderr:
            append_text(run_dir / "logs" / f"{turn_id}.{player.id}.repair-{attempt + 1}.claude.stderr.txt", result.stderr)
        if result.returncode != 0:
            continue
        validation = validate_run(args, run_dir)
        append_text(run_dir / "logs" / f"{turn_id}.repair-{attempt + 1}.validate.txt", validation.stdout + validation.stderr)
        timeline = read_json(run_dir / "timeline.json")
        if validation.returncode == 0 and committed_expected_turn(timeline, previous_entries, turn_id, player.id):
            return True
        error = validation.stderr or validation.stdout
    return False


def committed_expected_turn(timeline: dict[str, Any], previous_entries: int, turn_id: str, player_id: str) -> bool:
    entries = timeline.get("entries", [])
    if len(entries) != previous_entries + 1:
        return False
    entry = entries[-1]
    return entry.get("id") == turn_id and entry.get("player") == player_id


def run(command: list[str], *, check: bool, echo: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    if check and result.returncode != 0:
        raise RuntimeError(f"{' '.join(command)}\n{result.stdout}\n{result.stderr}")
    if echo and result.stdout:
        print(result.stdout, end="")
    if echo and result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    return result


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n")


def append_text(path: Path, text: str) -> None:
    if not text:
        return
    with path.open("a") as file:
        file.write(text)
        if not text.endswith("\n"):
            file.write("\n")


def rel(path: Path | str) -> str:
    path = Path(path)
    if not path.is_absolute():
        return str(path)
    return str(path.relative_to(ROOT))


if __name__ == "__main__":
    raise SystemExit(main())
