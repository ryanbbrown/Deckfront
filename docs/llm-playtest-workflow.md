# LLM Playtest Workflow

## Files

- Deck state: choose a JSON file under `.games/`, for example `.games/territory-v1-playtest/deck.json`.
- Board state: write or update `.games/<run>/board.json` for the experiment.
- Replay timeline: write `.games/territory-v1-playtest/timeline.json` with one entry per complete player turn.
- Rulesets: read `rulesets/territory-v1/`, but do not edit ruleset files during a game.
- Maps: read `maps/<map-id>.json`, but do not edit map files during a game.
- Viewer: run `bun run viewer` and open the Vite URL.

Use one directory per playtest run. A run directory has:

- `deck.json`: current persisted deck state.
- `board.json`: current mutable board state.
- `timeline.json`: replay entries for completed player turns.
- `snapshots/`: before/after deck and board snapshots for each completed turn.

Initialize a run directory:

```sh
bun run init-run -- --run .games/e001-baseline --ruleset territory-v1 --map sketch-v1
```

For baseline territory-v1 runs, seed from the corrected starter board:

```sh
bun run init-run -- --run .games/e001-baseline --ruleset territory-v1 --map sketch-v1 --board .games/territory-v1-playtest/snapshots/turn-001.before.board.json
```

## Start or Resume the Deck Game

```sh
bun run cli -- --config rulesets/territory-v1/deck.yaml --state .games/territory-v1-playtest/deck.json --seed 1
```

For bounded scripted runs:

```sh
bun run cli -- --config rulesets/territory-v1/deck.yaml --state .games/territory-v1-playtest/deck.json --seed 1 --script path/to/script.txt --max-actions 2
```

If the state file does not exist, the CLI creates a new game. If it exists, the CLI resumes from the saved deck state and RNG state.

To create a new deck state with run-level starting decks, pass `--starting-deck` before the first save. Use a plain comma-separated list to apply one deck to all players, or a player prefix for one player:

```sh
bun run cli -- --config rulesets/territory-v1/deck.yaml --state .games/e001-baseline/deck.json --seed 1 --max-actions 0 --starting-deck P1=copper,copper,copper,copper,copper,copper,copper,zap,bandage --starting-deck P2=copper,copper,copper,copper,copper,copper,copper,village,silver
```

`--starting-deck` is ignored when resuming an existing state file.

## Player Turn Loop

1. Read the current deck state file.
2. If the active rules allow it, optionally use the CLI's start-of-turn trash action before playing or spending cards.
3. Use the CLI to take the active player's deckbuilding choices.
4. Read the current board state file.
5. Apply board updates directly to the board state JSON.
6. Save before/after deck and board snapshots for the complete turn.
7. Append one entry to `timeline.json` with hand, played cards, purchases, produced counters, summary, and reasoning.
8. Keep ruleset files unchanged during the game.
9. Repeat for the next active player.

The frontend does not enforce rules. The LLM is responsible for legal movement, attacks, captures, and card effects.

Deck card effects that matter to the board are represented as turn attributes such as `damage`, `heal`, `upgradeHealth`, `upgradeDamage`, `reattack`, and `stormTargets`. These reset at cleanup like actions, buys, and money. Persistent deck-player counters must use `persistentAttributes` explicitly; the current territory ruleset does not use them.

## Board State Expectations

- Coordinates use `{ "col": number, "row": number }` values.
- The current map declares `coordinateSystem: "odd-column"`: flat-top hexes, columns left-to-right, rows top-to-bottom, odd columns shifted half a hex south.
- Use the Movement section in `rulesets/territory-v1/board-rules.md` for north, northeast, southeast, south, southwest, and northwest offsets.
- Unit `type` values should match `rulesets/territory-v1/units.json`.
- Unit `hp`, `maxHp`, and `attack` are current board-state values. Permanent upgrades should modify the specific unit, not every unit of that type.
- `ruleset` should reference an existing ruleset folder.
- `map` should reference an existing file in `maps/`.
- Supply control entries reference map supply center ids; `controller` is either `null` or a player id like `P1`.
- Saved board supply is tracked per player under `supply`.
- Movement values in the starter ruleset are placeholders for testing the iteration loop.

## Viewer

```sh
bun run viewer
```

Open the current playtest board:

```text
http://localhost:5173/?board=/game-data/.games/territory-v1-playtest/board.json
```

The viewer polls the selected board state and reloads the referenced ruleset/map data. It is intentionally read-only.

Replay mode loads complete player turns instead of a single mutable board:

```text
http://localhost:5173/?timeline=/game-data/.games/territory-v1-playtest/timeline.json
```

Replay frame 1 is the first entry's `before` snapshots, so the viewer opens on the starting state. Pressing Next advances to the first completed turn's `after` snapshots.

Each timeline entry should point to both deck and board snapshots:

```json
{
  "id": "turn-001",
  "player": "P1",
  "round": 1,
  "deck": {
    "before": "snapshots/turn-001.before.deck.json",
    "after": "snapshots/turn-001.after.deck.json",
    "drawnHand": ["Rest", "Zap", "Bandage", "Rest", "Copper"],
    "played": ["Zap", "Bandage"],
    "bought": [],
    "produced": { "money": 2, "damage": 1, "heal": 1 }
  },
  "board": {
    "before": "snapshots/turn-001.before.board.json",
    "after": "snapshots/turn-001.after.board.json"
  },
  "summary": "P1 advanced toward the northeast supply center.",
  "reasoning": "Zap had no target in useful range, so the turn prioritized positioning."
}
```

Replay timelines should be validated as bundles before review. A valid bundle has all referenced deck and board snapshots, matching active player and round metadata for each entry, and continuous deck and board states between adjacent turns.

```sh
bun run validate-run -- .games/territory-v1-playtest/timeline.json
```
