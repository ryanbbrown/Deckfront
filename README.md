# Deckbuild CLI

A small TypeScript sandbox for testing deckbuilding turns alongside a tactical territory board.

The repo has two main pieces:

- A Bun CLI that runs a Dominion-like deckbuilding engine from YAML game configs.
- A Vite/React viewer that renders board scenarios and replay timelines for territory playtests.

## Requirements

- Bun

Install dependencies:

```sh
bun install
```

## Commands

Run the test suite:

```sh
bun run test
```

Typecheck the CLI/core code:

```sh
bun run typecheck
```

Typecheck and build the viewer:

```sh
bun run viewer:typecheck
bun run viewer:build
```

## CLI

Run an interactive game from a config:

```sh
bun run cli -- --config examples/minimal-game.yaml --seed 1
```

Persist and resume state:

```sh
bun run cli -- --config examples/territory-v1.yaml --state .games/sketch-v1/deck.json --seed 1
```

Run from a numeric script:

```sh
bun run cli -- --config examples/minimal-game.yaml --script examples/script.txt --seed 1
```

Useful flags:

- `--config <path>`: YAML game definition.
- `--seed <number>`: deterministic shuffle seed.
- `--script <path>`: numeric choices, one per line.
- `--state <path>`: persisted game state JSON.
- `--max-actions <number>`: stop after this many accepted actions.

## Viewer

Start the viewer:

```sh
bun run viewer
```

Open the default board:

```text
http://localhost:5173/
```

Open a scratch scenario from `.games/`:

```text
http://localhost:5173/?scenario=/game-data/.games/sketch-v1/board.json
```

Open the committed sample playthrough:

```text
http://localhost:5173/?timeline=/game-data/playthroughs/territory-v1-playtest/timeline.json
```

Replay mode starts on the first entry's `before` snapshots, so frame 1 is the initial board state. Press Next to step through completed turn after-states.

## Project Layout

- `src/core/`: deckbuilding engine, actions, scoring, random state.
- `src/config/`: YAML config loading and validation.
- `src/cli/`: command-line interaction, scripting, persistence, rendering.
- `src/board/`: board/ruleset/scenario schemas.
- `src/replay/`: replay timeline schema.
- `viewer/`: React board and replay viewer.
- `rulesets/`: board maps, unit rules, and board card metadata.
- `scenarios/`: starter board states.
- `playthroughs/`: committed replay timelines and snapshots.
- `.games/`: ignored local scratch state for experiments.
- `docs/`: playtest workflow notes and board conventions.
- `tests/`: unit and integration coverage.

## Playthroughs

Use `.games/` for mutable experiments. When a replay is worth keeping, promote its timeline and snapshots into `playthroughs/<name>/` so it can be committed and loaded by the viewer.
