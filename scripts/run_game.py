#!/usr/bin/env python3
"""Shared process helpers for the Skirmish ThinHarness runner."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RULESET = "skirmish-v1"
DEFAULT_MAP = "skirmish-v1"
DEFAULT_CONFIG = "game/deck.yaml"


def run(command: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True, check=False)
    if check and result.returncode != 0:
        raise RuntimeError((result.stdout + result.stderr).strip())
    return result


def rel(path: Path) -> str:
    return str(path.relative_to(ROOT) if path.is_relative_to(ROOT) else path)


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n")


def ensure_initialized(args: argparse.Namespace, run_dir: Path, setups: dict[str, dict[str, Any]]) -> None:
    if all((run_dir / name).exists() for name in ("deck.json", "board.json", "timeline.json")):
        recover_uncommitted_turn(run_dir)
        return
    board_path = run_dir / "starter-board.json"
    write_starter_board(board_path, setups)
    init_command = [
        "bun", "run", "--silent", "playtest", "--", "init",
        "--run", rel(run_dir), "--ruleset", args.ruleset, "--map", args.map,
        "--board", rel(board_path), "--title", args.title,
    ]
    if args.max_turns is not None:
        init_command.extend(["--turn-cap", str(args.max_turns)])
    run(init_command)
    command = [
        "bun", "run", "--silent", "cli", "--", "legal-actions",
        "--config", args.config, "--seed", str(args.seed), "--state", rel(run_dir / "deck.json"), "--json",
    ]
    for player, setup in setups.items():
        command.extend(["--draft", f"{player}={','.join(setup['draft'])}"])
    run(command)


def expected_next_step_id(timeline: dict[str, Any]) -> str:
    entries = timeline.get("entries", [])
    for index, entry in enumerate(entries, start=1):
        expected = f"step-{index:03d}"
        if entry.get("id") != expected:
            raise RuntimeError(f"Committed timeline entry {index} is {entry.get('id')}, expected {expected}")
    return f"step-{len(entries) + 1:03d}"


def recover_uncommitted_turn(run_dir: Path) -> None:
    """Rewind a partial next turn to the latest state represented by the timeline."""
    timeline = read_json(run_dir / "timeline.json")
    step_id = expected_next_step_id(timeline)
    artifacts = uncommitted_step_artifacts(run_dir, step_id)
    partial = any(path.exists() for path in artifacts)
    deck = read_json(run_dir / "deck.json")
    board = read_json(run_dir / "board.json")
    if not partial:
        assert_active_players_match(deck, board, "persisted state")
        return

    entries = timeline.get("entries", [])
    if entries:
        last = entries[-1]
        last_setup = next((entry for entry in reversed(entries) if entry.get("phase") == "setup"), None)
        if last_setup is None:
            raise RuntimeError("Committed activation history has no setup deck snapshot")
        try:
            deck_before = read_json(run_dir / last_setup["deck"]["after"])
            board_before = read_json(run_dir / last["board"]["after"])
        except (KeyError, FileNotFoundError) as error:
            raise RuntimeError(f"Committed history is missing an after snapshot: {error}") from error
    else:
        deck_path = run_dir / "snapshots" / f"{step_id}.before.deck.json"
        board_path = run_dir / "snapshots" / f"{step_id}.before.board.json"
        if not deck_path.exists():
            assert_active_players_match(deck, board, f"persisted state before {step_id}")
            archive_uncommitted_artifacts(run_dir, step_id, artifacts)
            return
        deck_before = read_json(deck_path)
        board_before = read_json(board_path) if board_path.exists() else board

    assert_active_players_match(deck_before, board_before, f"recovery state for {step_id}")
    write_json(run_dir / "deck.json", deck_before)
    write_json(run_dir / "board.json", board_before)
    archive_uncommitted_artifacts(run_dir, step_id, artifacts)


def archive_uncommitted_artifacts(run_dir: Path, turn_id: str, artifacts: list[Path]) -> None:
    attempts_root = run_dir / "interrupted" / turn_id
    attempt = 1
    while (attempts_root / f"attempt-{attempt:03d}").exists():
        attempt += 1
    archive = attempts_root / f"attempt-{attempt:03d}"
    for path in artifacts:
        if not path.exists():
            continue
        destination = archive / path.relative_to(run_dir)
        destination.parent.mkdir(parents=True, exist_ok=True)
        path.replace(destination)


def uncommitted_step_artifacts(run_dir: Path, step_id: str) -> list[Path]:
    return [
        *(run_dir / "snapshots" / f"{step_id}.{suffix}.json" for suffix in ("before.deck", "after.deck", "before.board", "after.board")),
        *(run_dir / "actions" / f"{step_id}.{kind}.json" for kind in ("deck", "board")),
        *(run_dir / "results" / f"{step_id}.{kind}.json" for kind in ("deck.result", "board.result", "win-events")),
        *(run_dir / "logs" / f"{step_id}.{kind}.txt" for kind in ("deck", "board", "commit", "model")),
    ]


def assert_active_players_match(deck: dict[str, Any], board: dict[str, Any], label: str) -> None:
    if board.get("turn", {}).get("phase") == "activation":
        return
    try:
        active_deck_player = deck["game"]["players"][deck["game"]["activePlayer"]]["id"]
        active_board_player = board["turn"]["activePlayer"]
    except (KeyError, IndexError, TypeError) as error:
        raise RuntimeError(f"{label} does not contain readable active players") from error
    if active_deck_player != active_board_player:
        raise RuntimeError(f"{label} deck/board active players disagree ({active_deck_player}/{active_board_player})")


def validate_reset_run_dir(run_dir: Path, repository: Path = ROOT) -> Path:
    resolved = run_dir.resolve()
    runs_root = (repository / ".games").resolve()
    if resolved == runs_root or not resolved.is_relative_to(runs_root):
        raise ValueError(f"--reset only removes named run directories beneath {runs_root}")
    return resolved


def write_starter_board(path: Path, setups: dict[str, dict[str, Any]]) -> None:
    rules = read_json(ROOT / "game" / "units.json")
    units: list[dict[str, Any]] = []
    for player in ("P1", "P2"):
        for submitted in setups[player]["units"]:
            unit_rules = rules.get(submitted["type"])
            if not unit_rules:
                raise ValueError(f"Unknown unit type: {submitted['type']}")
            units.append({
                "id": submitted["id"], "player": player, "type": submitted["type"],
                "col": submitted["col"], "row": submitted["row"],
                "hp": unit_rules["hp"], "attack": unit_rules["attack"],
                "movement": unit_rules["movement"], "range": unit_rules["range"],
            })
    write_json(path, {
        "schemaVersion": 1, "ruleset": DEFAULT_RULESET, "map": DEFAULT_MAP,
        "players": ["P1", "P2"], "turn": {
            "round": 1, "phase": "setup", "initiativePlayer": "P1", "activePlayer": "P1",
            "completedSetupPlayers": [], "activatedUnitIds": [],
        },
        "units": units, "notes": [],
    })


def validate_run(run_dir: Path) -> subprocess.CompletedProcess[str]:
    return run([
        "bun", "run", "--silent", "validate-run", "--", rel(run_dir / "timeline.json"),
        "--strict", "--strict-deck", "--strict-win",
    ], check=False)


def committed_expected_step(timeline: dict[str, Any], previous_entries: int, step_id: str, player: str) -> bool:
    entries = timeline.get("entries", [])
    return len(entries) == previous_entries + 1 and entries[-1].get("id") == step_id and entries[-1].get("player") == player
