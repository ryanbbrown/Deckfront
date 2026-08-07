#!/usr/bin/env python3
"""Generate the rotationally symmetric Skirmish map asset."""

from __future__ import annotations

import json
from pathlib import Path

ROWS = 17
WALL_SEEDS = [
    (3, 1), (4, 1), (4, 2), (5, 3),
    (2, 6), (2, 7), (3, 8),
    (6, 5), (7, 6),
]


def width(row: int) -> int:
    return 9 if row % 2 == 0 else 10


def rotate(row: int, col: int) -> tuple[int, int]:
    return ROWS - 1 - row, width(row) - 1 - col


def coord(row: int, col: int) -> dict[str, int]:
    return {"col": col, "row": row}


def main() -> None:
    walls = sorted(set(WALL_SEEDS + [rotate(row, col) for row, col in WALL_SEEDS]))
    game_dir = Path(__file__).resolve().parents[1] / "game"
    game_dir.mkdir(exist_ok=True)
    map_data = {
        "id": "skirmish-v1",
        "name": "Skirmish V1",
        "orientation": "pointy",
        "coordinateSystem": "odd-row",
        "hexes": [coord(row, col) for row in range(ROWS) for col in range(width(row))],
        "blocked": [coord(row, col) for row, col in walls],
        "keyPoints": [
            {"id": "range", "stat": "range", **coord(8, 1)},
            {"id": "attack", "stat": "attack", **coord(8, 4)},
            {"id": "movement", "stat": "movement", **coord(8, 7)},
        ],
        "deployment": [
            {"player": "P1", "hexes": [coord(0, col) for col in range(width(0))]},
            {"player": "P2", "hexes": [coord(16, col) for col in range(width(16))]},
        ],
    }
    (game_dir / "map.json").write_text(json.dumps(map_data, indent=2) + "\n")
    board_data = {
        "schemaVersion": 1,
        "ruleset": "skirmish-v1",
        "map": "skirmish-v1",
        "players": ["P1", "P2"],
        "turn": {"activePlayer": "P1", "round": 1},
        "units": [],
        "notes": ["Submit both armies before play."]
    }
    (game_dir / "board.json").write_text(json.dumps(board_data, indent=2) + "\n")


if __name__ == "__main__":
    main()
