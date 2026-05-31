# LLM Playtest Workflow

## Files

- Deck state: choose a JSON file under `.games/`, for example `.games/sketch-v1/deck.json`.
- Board state: copy `scenarios/sketch-v1.board.json` to `.games/sketch-v1/board.json` for an experiment.
- Replay timeline: write `.games/sketch-v1/timeline.json` with one entry per complete player turn.
- Logged playthroughs: promote curated timelines and snapshots to `playthroughs/<name>/` when they should be committed.
- Rulesets: read `rulesets/territory-v1/`, but do not edit ruleset files during a game.
- Viewer: run `bun run viewer` and open the Vite URL.

## Start or Resume the Deck Game

```sh
bun run cli -- --config examples/territory-v1.yaml --state .games/sketch-v1/deck.json --seed 1
```

For bounded scripted runs:

```sh
bun run cli -- --config examples/territory-v1.yaml --state .games/sketch-v1/deck.json --seed 1 --script path/to/script.txt --max-actions 2
```

If the state file does not exist, the CLI creates a new game. If it exists, the CLI resumes from the saved deck state and RNG state.

## Player Turn Loop

1. Read the current deck state file.
2. Use the CLI to take the active player's deckbuilding choices.
3. Read the current board state file.
4. Apply board updates directly to the board state JSON.
5. Save before/after deck and board snapshots for the complete turn.
6. Append one entry to `timeline.json` with hand, played cards, purchases, produced counters, summary, and reasoning.
7. Keep ruleset files unchanged during the game.
8. Repeat for the next active player.

The frontend does not enforce rules. The LLM is responsible for legal movement, attacks, captures, and card effects.

Deck card effects that matter to the board are represented as player attributes such as `damage`, `heal`, `bonusHp`, `bonusAttack`, `reattack`, and `stormTargets`. The deckbuilding engine treats custom attributes as persistent counters, so an LLM should compare the active player's before/after deck state for the current turn when deciding what board effect was produced.

## Board State Expectations

- Coordinates use axial `{ "q": number, "r": number }` values.
- Unit `type` values should match `rulesets/territory-v1/units.json`.
- `ruleset` and `map` should reference existing ruleset/map files.
- Supply center `controller` is either `null` or a player id like `P1`.
- Movement values in the starter ruleset are placeholders for testing the iteration loop.

## Viewer

```sh
bun run viewer
```

Open the starter scenario directly, or point the viewer at a mutable playtest state:

```text
http://localhost:5173/?scenario=/game-data/.games/sketch-v1/board.json
```

The viewer polls the selected board scenario and reloads the referenced ruleset/map data. It is intentionally read-only.

Replay mode loads complete player turns instead of a single mutable board:

```text
http://localhost:5173/?timeline=/game-data/.games/sketch-v1/timeline.json
```

Replay frame 1 is the first entry's `before` snapshots, so the viewer opens on the starting state. Pressing Next advances to the first completed turn's `after` snapshots.

Committed playthroughs use the same timeline format:

```text
http://localhost:5173/?timeline=/game-data/playthroughs/territory-v1-playtest/timeline.json
```

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
