#!/usr/bin/env python3
"""Run an adversarial Deckfront playthrough with two Codex CLI sessions.

The runner owns setup and alternation. Each Codex session owns its player's
turns and is allowed to mutate the shared run directory on that player's turn.
The existing Deckfront CLIs remain the source of truth for legality.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from playtest_context import build_initial_prompt
from playtest_context import build_repair_prompt
from playtest_context import build_turn_prompt
from playtest_context import load_system_prompt
from playtest_context import write_context_snapshot
from playtest_context import write_run_metadata


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RULESET = "current"
DEFAULT_MAP = "current"
DEFAULT_CONFIG = "game/deck.yaml"
DEFAULT_DRAFTS = ("P1=blast,zap,silver", "P2=village,smithy,peddler")
DEFAULT_MODEL = None
DEFAULT_EFFORT = "low"
DEFAULT_TIMEOUT_SECONDS = 180
DEFAULT_P1_UNITS = "raider,scout,raider,marksman"
DEFAULT_P2_UNITS = "raider,scout,guardian,marksman"


@dataclass
class Player:
    id: str
    strategy: str
    session_id: str | None = None


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
    write_context_snapshot(args, run_dir, players, runner="codex", drafts=drafts(args))
    write_run_metadata(args, run_dir, players, runner="codex", drafts=drafts(args), status="running")

    for _ in range(args.max_turns):
        timeline = read_json(run_dir / "timeline.json")
        if timeline.get("terminalWinEvents"):
            write_run_metadata(args, run_dir, players, runner="codex", drafts=drafts(args), status="complete")
            print(f"Game already ended with terminal win events in {run_dir / 'timeline.json'}")
            return 0

        active_player = read_json(run_dir / "board.json")["turn"]["activePlayer"]
        player = next(candidate for candidate in players if candidate.id == active_player)
        previous_entries = len(timeline.get("entries", []))
        next_turn = previous_entries + 1
        turn_id = f"turn-{next_turn:03d}"

        print(f"\n=== {turn_id} {player.id} ===", flush=True)
        resume = player.session_id is not None
        prompt = build_turn_prompt(args, run_dir, player, turn_id)
        if not resume:
            prompt = f"{load_system_prompt()}\n\n{build_initial_prompt(args, run_dir, player, players, drafts(args))}\n\n{prompt}"
        result = run_codex_turn(args, run_dir, player, prompt, resume=resume)
        thread_id = codex_thread_id(result.stdout)
        if thread_id:
            player.session_id = thread_id
            write_runner_state(args, run_dir, players)
        append_text(run_dir / "logs" / f"{turn_id}.{player.id}.codex.jsonl", result.stdout)
        if result.stderr:
            append_text(run_dir / "logs" / f"{turn_id}.{player.id}.codex.stderr.txt", result.stderr)
        if result.returncode != 0:
            write_run_metadata(args, run_dir, players, runner="codex", drafts=drafts(args), status="invalid", error=result.stderr or result.stdout)
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
                    write_run_metadata(args, run_dir, players, runner="codex", drafts=drafts(args), status="invalid", error=validation.stderr or validation.stdout)
                    return 1
            else:
                write_run_metadata(args, run_dir, players, runner="codex", drafts=drafts(args), status="invalid", error=validation.stderr or validation.stdout)
                return validation.returncode

        timeline = read_json(run_dir / "timeline.json")
        if not committed_expected_turn(timeline, previous_entries, turn_id, player.id):
            error = f"{player.id} did not commit exactly one expected entry ({turn_id})"
            print(error, file=sys.stderr)
            if args.retry_on_invalid > 0:
                retry_ok = retry_invalid_turn(args, run_dir, player, turn_id, previous_entries, error)
                if not retry_ok:
                    write_run_metadata(args, run_dir, players, runner="codex", drafts=drafts(args), status="invalid", error=error)
                    return 1
            else:
                write_run_metadata(args, run_dir, players, runner="codex", drafts=drafts(args), status="invalid", error=error)
                return 1

        timeline = read_json(run_dir / "timeline.json")
        print(f"Validated {len(timeline.get('entries', []))} entries", flush=True)
        if timeline.get("terminalWinEvents"):
            write_run_metadata(args, run_dir, players, runner="codex", drafts=drafts(args), status="complete")
            print(f"Game ended: {json.dumps(timeline['terminalWinEvents'], indent=2)}")
            return 0

        time.sleep(args.turn_delay)

    write_run_metadata(args, run_dir, players, runner="codex", drafts=drafts(args), status="max_turns")
    print(f"Stopped at max turns: {args.max_turns}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run a two-Codex-agent Deckfront playthrough.")
    parser.add_argument("--run", required=True, help="Run directory, usually under ../runs/ when invoked from an experiment code directory.")
    parser.add_argument("--reset", action="store_true", help="Delete and recreate the run directory before starting.")
    parser.add_argument("--ruleset", default=DEFAULT_RULESET)
    parser.add_argument("--map", default=DEFAULT_MAP)
    parser.add_argument("--board", default=None, help="Starter board JSON. If omitted, the runner writes one from --p1-units/--p2-units.")
    parser.add_argument("--config", default=DEFAULT_CONFIG, help="Deck config YAML.")
    parser.add_argument("--title", default="Current best baseline playthrough")
    parser.add_argument("--seed", type=int, default=2106)
    parser.add_argument("--draft", action="append", default=None, help="Draft override. Repeat once per player. Defaults to the E024 rush-vs-engine drafts.")
    parser.add_argument("--p1-units", default=DEFAULT_P1_UNITS, help="Comma-separated P1 starting units when --board is omitted.")
    parser.add_argument("--p2-units", default=DEFAULT_P2_UNITS, help="Comma-separated P2 starting units when --board is omitted.")
    parser.add_argument("--max-turns", type=int, default=30)
    parser.add_argument("--turn-delay", type=float, default=0.0)
    parser.add_argument("--retry-on-invalid", type=int, default=1)
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Codex model override. Omit to use your Codex config default.")
    parser.add_argument("--effort", default=DEFAULT_EFFORT, help="Codex model_reasoning_effort config override.")
    parser.add_argument("--codex-bin", default="codex")
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
    map_data = read_json(ROOT / "game" / "map.json")
    unit_rules = read_json(ROOT / "game" / "units.json")
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
        "notes": ["Generated by code/scripts/run_game.py"],
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


def run_codex_turn(args: argparse.Namespace, run_dir: Path, player: Player, prompt: str, *, resume: bool = False) -> subprocess.CompletedProcess[str]:
    if resume:
        if player.session_id is None:
            raise ValueError(f"Cannot resume {player.id}: missing Codex thread id")
        command = [args.codex_bin, "exec", "resume"]
    else:
        command = [args.codex_bin, "exec"]
    command.extend(["--json", "--dangerously-bypass-approvals-and-sandbox", "-c", f"model_reasoning_effort={json.dumps(args.effort)}"])
    if args.model:
        command.extend(["--model", args.model])
    if not resume:
        command.extend(["--cd", str(ROOT)])
    if resume:
        command.append(player.session_id)
    command.append(prompt)
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
        stderr = f"{stderr}\nCodex turn timed out after {args.timeout_seconds} seconds.".strip()
        return subprocess.CompletedProcess(command, 124, stdout, stderr)


def codex_thread_id(stdout: str) -> str | None:
    for line in stdout.splitlines():
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        thread_id = event.get("thread_id")
        if isinstance(thread_id, str) and thread_id:
            return thread_id
    return None


def validate_run(args: argparse.Namespace, run_dir: Path) -> subprocess.CompletedProcess[str]:
    return run(
        ["bun", "run", "validate-run", "--", "--strict", "--strict-deck", "--strict-win", rel(run_dir / "timeline.json")],
        check=False,
    )


def retry_invalid_turn(args: argparse.Namespace, run_dir: Path, player: Player, turn_id: str, previous_entries: int, error: str) -> bool:
    for attempt in range(args.retry_on_invalid):
        print(f"Validation failed for {turn_id}; asking {player.id} to repair attempt {attempt + 1}", flush=True)
        prompt = build_repair_prompt(run_dir, player, turn_id, error, attempt + 1)
        result = run_codex_turn(args, run_dir, player, prompt, resume=player.session_id is not None)
        thread_id = codex_thread_id(result.stdout)
        if thread_id:
            player.session_id = thread_id
        append_text(run_dir / "logs" / f"{turn_id}.{player.id}.repair-{attempt + 1}.codex.jsonl", result.stdout)
        if result.stderr:
            append_text(run_dir / "logs" / f"{turn_id}.{player.id}.repair-{attempt + 1}.codex.stderr.txt", result.stderr)
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
