#!/usr/bin/env python3
"""Build concise, versioned context for Skirmish playtest agents."""

from __future__ import annotations

import json
import math
from collections import deque
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]


def system_prompt() -> str:
    return "\n\n".join([
        (ROOT / "agent-context/prompts/playtest-player.system.md").read_text().strip(),
        (ROOT / "agent-context/prompts/thinharness-player.system.md").read_text().strip(),
        (ROOT / "game/board-rules.md").read_text().strip(),
    ])


def state_briefing(run_dir: Path, player: str, produced: dict[str, int] | None = None) -> dict[str, Any]:
    board = json.loads((run_dir / "board.json").read_text())
    map_data = json.loads((ROOT / "game/map.json").read_text())
    unit_rules = json.loads((ROOT / "game/units.json").read_text())
    setup_phase = board["turn"]["phase"] == "setup"
    briefing: dict[str, Any] = {
        "player": player,
        "turn": board["turn"],
        "units": board["units"],
        "keyPoints": map_data["keyPoints"],
        "walls": map_data["blocked"],
        "activationOptions": activation_options(board, map_data, player, unit_rules) if not setup_phase else [],
    }
    if not setup_phase:
        return briefing

    deck = json.loads((run_dir / "deck.json").read_text())
    game = deck["game"]
    active = next(candidate for candidate in game["players"] if candidate["id"] == player)
    briefing["automaticKeyPointUpgrades"] = automatic_key_point_upgrades(board, map_data, player, unit_rules)
    briefing["producedThisTurn"] = produced or {}
    if produced is None:
        briefing.update({
            "deckPhase": game["phase"],
            "pendingDeckEffect": game.get("pending"),
            "deckChoiceRules": {
                "playsAllActionsRecursively": True,
                "trashDecisionAfterActions": True,
                "purchaseDecisionAfterTrash": True,
                "preferTrashCopper": True,
                "harnessAddsTreasuresAndEndTurn": True,
                "unspentMoneyCarriesOver": False,
            },
            "handIndexed": [
                {"index": index, **game["cards"][card_id]}
                for index, card_id in enumerate(active["hand"])
            ],
            "deckResources": {key: active[key] for key in ("actions", "buys", "money", "attributes")},
            "market": [
                {"id": card["id"], "cost": card["cost"], "remaining": game["supply"].get(card["id"], 0)}
                for card in game["cards"].values()
            ],
        })
    else:
        briefing["upgradeLaneBudgets"] = produced
        briefing["legalUpgrades"] = legal_upgrades(board, map_data, player, unit_rules, produced)
    return briefing


def automatic_key_point_upgrades(
    board: dict[str, Any],
    map_data: dict[str, Any],
    player: str,
    unit_rules: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    upgrades: list[dict[str, Any]] = []
    for point in map_data.get("keyPoints", []):
        unit = next(
            (candidate for candidate in board["units"] if candidate["player"] == player and coord_key(candidate) == coord_key(point)),
            None,
        )
        if not unit:
            continue
        if point["stat"] == "range" and not unit_rules[unit["type"]]["canUpgradeRange"]:
            continue
        upgrades.append({
            "target": unit["id"],
            "stat": point["stat"],
            "to": unit[point["stat"]] + 1,
            "keyPoint": point["id"],
        })
    return upgrades


def legal_upgrades(
    board: dict[str, Any],
    map_data: dict[str, Any],
    player: str,
    unit_rules: dict[str, dict[str, Any]],
    produced: dict[str, int],
) -> list[dict[str, Any]]:
    automatic = {
        (upgrade["target"], upgrade["stat"]): upgrade
        for upgrade in automatic_key_point_upgrades(board, map_data, player, unit_rules)
    }
    choices: list[dict[str, Any]] = []
    for unit in board["units"]:
        if unit["player"] != player:
            continue
        for stat in ("attack", "movement", "range"):
            if stat == "range" and not unit_rules[unit["type"]]["canUpgradeRange"]:
                continue
            if (unit["id"], stat) in automatic:
                continue
            to = unit[stat] + 1
            lane = f"{unit['type']}{stat[0].upper()}{stat[1:]}"
            available = produced.get(lane, 0)
            if to > available:
                continue
            choices.append({
                "target": unit["id"],
                "stat": stat,
                "to": to,
                "lane": lane,
                "cost": to,
                "available": available,
            })
    return choices


def activation_options(board: dict[str, Any], map_data: dict[str, Any], player: str, unit_rules: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    hexes = {coord_key(coord) for coord in map_data["hexes"]}
    walls = {coord_key(coord) for coord in map_data["blocked"]}
    occupied = {coord_key(unit) for unit in board["units"]}
    options: list[dict[str, Any]] = []
    for unit in board["units"]:
        if unit["player"] != player or unit["id"] in board["turn"]["activatedUnitIds"]:
            continue
        start = {"col": unit["col"], "row": unit["row"]}
        movement = unit["movement"]
        attack_range = unit["range"]
        blocked = walls | (occupied - {coord_key(start)})
        from_distances = movement_distances(start, movement, hexes, blocked)
        attack_choices = []
        for via_key, spent in from_distances.items():
            via = parse_coord(via_key)
            targets = [
                enemy["id"] for enemy in board["units"]
                if enemy["player"] != player
                and hex_distance(via, enemy) <= attack_range
                and (hex_distance(via, enemy) == 1 or line_of_sight(via, enemy, map_data))
            ]
            if not targets:
                continue
            remaining = movement - spent
            to_distances = movement_distances(via, remaining, hexes, blocked)
            attack_choices.append({
                "via": via,
                "spent": spent,
                "remaining": remaining,
                "attacks": [
                    {"id": attack_plan_id(unit["id"], via, target), "target": target}
                    for target in targets
                ],
                "to": [parse_coord(key) for key in to_distances],
            })
        options.append({
            "unit": unit["id"],
            "from": start,
            "movement": movement,
            "range": attack_range,
            "noAttackTo": [parse_coord(key) for key in from_distances],
            "attackChoicesByVia": attack_choices,
        })
    return options


def movement_distances(
    start: dict[str, int],
    budget: int,
    hexes: set[str],
    blocked: set[str],
) -> dict[str, int]:
    distances = {coord_key(start): 0}
    queue = deque([start])
    while queue:
        current = queue.popleft()
        distance = distances[coord_key(current)]
        if distance >= budget:
            continue
        for neighbor in neighbors(current):
            key = coord_key(neighbor)
            if key in distances or key not in hexes or key in blocked:
                continue
            distances[key] = distance + 1
            queue.append(neighbor)
    return distances


def neighbors(coord: dict[str, int]) -> list[dict[str, int]]:
    if abs(coord["row"]) % 2 == 0:
        deltas = [(1, 0), (1, -1), (0, -1), (-1, 0), (0, 1), (1, 1)]
    else:
        deltas = [(1, 0), (0, -1), (-1, -1), (-1, 0), (-1, 1), (0, 1)]
    return [{"col": coord["col"] + col, "row": coord["row"] + row} for col, row in deltas]


def hex_distance(left: dict[str, int], right: dict[str, int]) -> int:
    def cube(coord: dict[str, int]) -> tuple[int, int, int]:
        x = coord["col"] - ((coord["row"] + abs(coord["row"]) % 2) >> 1)
        z = coord["row"]
        return x, -x - z, z
    first = cube(left)
    second = cube(right)
    return max(abs(first[index] - second[index]) for index in range(3))


def line_of_sight(start: dict[str, int], target: dict[str, int], map_data: dict[str, Any]) -> bool:
    start_point = hex_center(start)
    target_point = hex_center(target)
    endpoints = {coord_key(start), coord_key(target)}
    return not any(
        coord_key(wall) not in endpoints and segment_enters_open_hex(start_point, target_point, hex_center(wall))
        for wall in map_data["blocked"]
    )


def hex_center(coord: dict[str, int]) -> tuple[float, float]:
    parity = abs(coord["row"]) % 2
    return math.sqrt(3) * (coord["col"] + 0.5 * (1 - parity)), 1.5 * coord["row"]


def segment_enters_open_hex(start: tuple[float, float], target: tuple[float, float], center: tuple[float, float]) -> bool:
    vertices = []
    for index in range(6):
        angle = math.radians(-30 + 60 * index)
        vertices.append((center[0] + math.cos(angle), center[1] + math.sin(angle)))
    lower = 0.0
    upper = 1.0
    epsilon = 1e-10
    for index, vertex in enumerate(vertices):
        following = vertices[(index + 1) % len(vertices)]
        edge_x = following[0] - vertex[0]
        edge_y = following[1] - vertex[1]
        start_cross = edge_x * (start[1] - vertex[1]) - edge_y * (start[0] - vertex[0])
        delta_cross = edge_x * (target[1] - start[1]) - edge_y * (target[0] - start[0])
        if abs(delta_cross) < epsilon:
            if start_cross <= epsilon:
                return False
            continue
        boundary = -start_cross / delta_cross
        if delta_cross > 0:
            lower = max(lower, boundary)
        else:
            upper = min(upper, boundary)
    return lower + epsilon < upper and upper > epsilon and lower < 1 - epsilon


def attack_plan_id(unit: str, via: dict[str, int], target: str) -> str:
    return f"{unit}@{coord_key(via)}>{target}"


def parse_coord(key: str) -> dict[str, int]:
    col, row = key.split(",")
    return {"col": int(col), "row": int(row)}


def coord_key(coord: dict[str, Any]) -> str:
    return f"{coord['col']},{coord['row']}"


def write_context_snapshot(run_dir: Path) -> None:
    target = run_dir / "context"
    target.mkdir(parents=True, exist_ok=True)
    (target / "playtest-player.system.rendered.md").write_text(system_prompt() + "\n")
