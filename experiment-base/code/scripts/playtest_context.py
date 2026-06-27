from __future__ import annotations

import hashlib
import json
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from string import Template
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONTEXT_DIR = ROOT / "agent-context"
PROMPT_DIR = CONTEXT_DIR / "prompts"


def load_system_prompt() -> str:
    return (PROMPT_DIR / "playtest-player.system.md").read_text().strip()


def write_context_snapshot(args: Any, run_dir: Path, players: list[Any], *, runner: str, drafts: list[str]) -> None:
    context_dir = run_dir / "context"
    context_dir.mkdir(parents=True, exist_ok=True)

    system_prompt = load_system_prompt()
    write_text(context_dir / "playtest-player.system.rendered.md", system_prompt)
    for player in players:
        write_text(context_dir / f"{player.id}.initial.user.rendered.md", build_initial_prompt(args, run_dir, player, players, drafts))

    files = [
        PROMPT_DIR / "playtest-player.system.md",
        PROMPT_DIR / "playtest-initial.user.md",
        PROMPT_DIR / "playtest-turn.user.md",
        PROMPT_DIR / "playtest-repair.user.md",
        ROOT / "game" / "board-rules.md",
        ROOT / args.config,
        ROOT / "game" / "cards.json",
        ROOT / "game" / "units.json",
        ROOT / "game" / "map.json",
    ]
    manifest = {
        "schemaVersion": 1,
        "runner": runner,
        "ruleset": args.ruleset,
        "map": args.map,
        "deckConfig": args.config,
        "title": args.title,
        "seed": args.seed,
        "drafts": drafts,
        "startingUnits": {"P1": args.p1_units, "P2": args.p2_units},
        "players": {player.id: {"strategy": player.strategy} for player in players},
        "files": [{"path": rel(path), "sha256": sha256(path)} for path in files if path.exists()],
        "notes": [
            "Claude receives playtest-player.system.md through --system-prompt.",
            "Codex CLI has no system-prompt flag, so the Codex runner prepends the same content to each player's first prompt.",
        ],
    }
    write_json(context_dir / "manifest.json", manifest)


def write_run_metadata(
    args: Any,
    run_dir: Path,
    players: list[Any],
    *,
    runner: str,
    drafts: list[str],
    status: str,
    error: str | None = None,
) -> None:
    lines = [
        f"id: {yaml_quote(run_dir.name)}",
        f"experiment: {yaml_quote(experiment_id(run_dir))}",
        f"updatedAt: {yaml_quote(datetime.now(UTC).isoformat())}",
        f"status: {yaml_quote(status)}",
        f"runner: {yaml_quote(runner)}",
        f"model: {yaml_quote(getattr(args, 'model', '') or '')}",
        f"effort: {yaml_quote(getattr(args, 'effort', '') or '')}",
        f"timeoutSeconds: {getattr(args, 'timeout_seconds', 0)}",
        f"maxTurns: {args.max_turns}",
        f"seed: {args.seed}",
        f"ruleset: {yaml_quote(args.ruleset)}",
        f"map: {yaml_quote(args.map)}",
        f"deckConfig: {yaml_quote(args.config)}",
        "drafts:",
    ]
    lines.extend(f"  - {yaml_quote(draft)}" for draft in drafts)
    lines.extend(
        [
            "players:",
            "  P1:",
        ]
    )
    p1 = next(player for player in players if player.id == "P1")
    append_yaml_block(lines, "strategy", p1.strategy, 4)
    lines.append(f"    startingUnits: {yaml_quote(args.p1_units)}")
    lines.append("  P2:")
    p2 = next(player for player in players if player.id == "P2")
    append_yaml_block(lines, "strategy", p2.strategy, 4)
    lines.append(f"    startingUnits: {yaml_quote(args.p2_units)}")
    lines.extend(run_result_lines(run_dir))
    if error:
        append_yaml_block(lines, "error", error, 0)
    write_text(run_dir / "run.yaml", "\n".join(lines))


def build_initial_prompt(args: Any, run_dir: Path, player: Any, players: list[Any], drafts: list[str]) -> str:
    opponent = next(candidate for candidate in players if candidate.id != player.id)
    values = {
        "player_id": player.id,
        "player_strategy": player.strategy,
        "opponent_id": opponent.id,
        "opponent_strategy": opponent.strategy,
        "run_dir": rel(run_dir),
        "ruleset": args.ruleset,
        "map": args.map,
        "deck_config": args.config,
        "board_rules": rel(ROOT / "game" / "board-rules.md"),
        "units_file": rel(ROOT / "game" / "units.json"),
        "map_file": rel(ROOT / "game" / "map.json"),
        "deck_config_content": read_text(ROOT / args.config),
        "board_rules_content": read_text(ROOT / "game" / "board-rules.md"),
        "units_json_content": read_text(ROOT / "game" / "units.json"),
        "map_json_content": read_text(ROOT / "game" / "map.json"),
        "drafts": "\n".join(drafts),
        "starting_units": f"P1={args.p1_units}\nP2={args.p2_units}",
    }
    return render_prompt("playtest-initial.user.md", values)


def build_turn_prompt(args: Any, run_dir: Path, player: Any, turn_id: str) -> str:
    briefing = build_state_briefing(args, run_dir)
    context_dir = run_dir / "context"
    context_dir.mkdir(parents=True, exist_ok=True)
    write_json(context_dir / f"{turn_id}.{player.id}.briefing.json", briefing)

    values = turn_values(args, run_dir, player, turn_id)
    values["briefing_json"] = json.dumps(briefing, separators=(",", ":"))
    prompt = render_prompt("playtest-turn.user.md", values)
    write_text(context_dir / f"{turn_id}.{player.id}.turn.user.rendered.md", prompt)
    return prompt


def build_repair_prompt(run_dir: Path, player: Any, turn_id: str, error: str, attempt: int) -> str:
    values = {
        "run_dir": rel(run_dir),
        "player_id": player.id,
        "turn_id": turn_id,
        "attempt": str(attempt),
        "error": error,
    }
    prompt = render_prompt("playtest-repair.user.md", values)
    context_dir = run_dir / "context"
    context_dir.mkdir(parents=True, exist_ok=True)
    write_text(context_dir / f"{turn_id}.{player.id}.repair-{attempt}.user.rendered.md", prompt)
    return prompt


def turn_values(args: Any, run_dir: Path, player: Any, turn_id: str) -> dict[str, str]:
    return {
        "turn_id": turn_id,
        "player_id": player.id,
        "run_dir": rel(run_dir),
        "deck_config": args.config,
        "deck_state": rel(run_dir / "deck.json"),
        "board_state": rel(run_dir / "board.json"),
        "timeline": rel(run_dir / "timeline.json"),
        "deck_actions": rel(run_dir / "actions" / f"{turn_id}.deck.json"),
        "board_actions": rel(run_dir / "actions" / f"{turn_id}.board.json"),
        "win_events": rel(run_dir / "actions" / f"{turn_id}.win-events.json"),
        "terminal_win_events": rel(run_dir / "actions" / f"{turn_id}.terminal-win-events.json"),
        "deck_result": rel(run_dir / "results" / f"{turn_id}.deck.result.json"),
        "board_result": rel(run_dir / "results" / f"{turn_id}.board.result.json"),
    }


def build_state_briefing(args: Any, run_dir: Path) -> dict[str, Any]:
    deck = read_json(run_dir / "deck.json")
    board = read_json(run_dir / "board.json")
    map_data = read_json(ROOT / "game" / "map.json")
    unit_rules = read_json(ROOT / "game" / "units.json")

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

    legal_actions = run_silent(
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
    )

    return {
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


def render_prompt(name: str, values: dict[str, str]) -> str:
    template = Template((PROMPT_DIR / name).read_text())
    return template.safe_substitute(values).strip()


def run_silent(command: list[str], *, check: bool) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=ROOT, text=True, capture_output=True)
    if check and result.returncode != 0:
        raise RuntimeError(f"{' '.join(command)}\n{result.stdout}\n{result.stderr}")
    return result


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def read_text(path: Path) -> str:
    return path.read_text().strip()


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2) + "\n")


def write_text(path: Path, value: str) -> None:
    path.write_text(value.rstrip() + "\n")


def run_result_lines(run_dir: Path) -> list[str]:
    timeline_path = run_dir / "timeline.json"
    if not timeline_path.exists():
        return ["result:", "  turns: 0", "  terminal: false"]

    timeline = read_json(timeline_path)
    terminal_events = timeline.get("terminalWinEvents") or []
    lines = [
        "result:",
        f"  turns: {len(timeline.get('entries', []))}",
        f"  terminal: {str(bool(terminal_events)).lower()}",
    ]
    if terminal_events:
        event = terminal_events[0]
        winner = event.get("player") or event.get("winner")
        reason = event.get("type") or event.get("reason")
        if winner:
            lines.append(f"  winner: {yaml_quote(winner)}")
        if reason:
            lines.append(f"  reason: {yaml_quote(reason)}")
    return lines


def experiment_id(run_dir: Path) -> str:
    resolved = run_dir.resolve()
    if resolved.parent.name == "runs":
        return resolved.parent.parent.name
    return ""


def append_yaml_block(lines: list[str], key: str, value: str, indent: int) -> None:
    prefix = " " * indent
    if not value:
        lines.append(f"{prefix}{key}: \"\"")
        return
    lines.append(f"{prefix}{key}: |-")
    for line in value.splitlines():
        lines.append(f"{prefix}  {line}")


def yaml_quote(value: Any) -> str:
    escaped = str(value).replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rel(path: Path | str) -> str:
    path = Path(path)
    if not path.is_absolute():
        return str(path)
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)
