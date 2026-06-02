# Deckfront

Deckfront is a small TypeScript sandbox for designing a game that combines deck building with territory control.

The name is a blend of deck and front: the deckbuilding engine drives the decisions, while the battle front is the shared territory board those decisions affect.

## Why This Exists

I play a lot of board games. Dominion is probably my favorite game, and deck building in general is one of my favorite game systems. I also like a lot of games with territory control, area control, and tactical positioning.

There are not many games that combine deck building and territory control well. The main one I have played is Tyrants of the Underdark, which was fun at first, but has some clear flaws that made my group stop wanting to play it. Deckfront is an experiment in taking a step back and building my own version of that design space, using AI as a collaborator for implementation, playtesting, and iteration.

The repo has two main pieces:

- A Bun CLI that runs a Dominion-like deckbuilding engine from YAML game configs.
- A Vite/React viewer that renders board states and replay timelines for territory playtests.

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
bun run cli -- --config rulesets/territory-v1/deck.yaml --state .games/territory-v1-playtest/deck.json --seed 1
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

Open a mutable board from `.games/`:

```text
http://localhost:5173/?board=/game-data/.games/territory-v1-playtest/board.json
```

Open the sample playtest replay:

```text
http://localhost:5173/?timeline=/game-data/.games/territory-v1-playtest/timeline.json
```

Replay mode starts on the first entry's `before` snapshots, so frame 1 is the initial board state. Press Next to step through completed turn after-states.

## Project Layout

- `src/core/`: deckbuilding engine, actions, scoring, random state.
- `src/config/`: YAML config loading and validation.
- `src/cli/`: command-line interaction, scripting, persistence, rendering.
- `src/board/`: map and board-state schemas.
- `src/replay/`: replay timeline schema.
- `src/playtest/`: playtest run layout and replay bundle validation.
- `viewer/`: React board and replay viewer.
- `rulesets/`: deck config, board rules, unit rules, and board card metadata.
- `maps/`: board geometry, blocked hexes, supply centers, and home bases.
- `.games/`: mutable playtest runs, timelines, notes, and snapshots.
- `docs/`: playtest workflow notes and board conventions.
- `tests/`: unit and integration coverage.

## Playtest Runs

Use `.games/<run>/` for experiments and recorded replays. A run has one current `deck.json`, one current `board.json`, one `timeline.json`, and turn snapshots under `snapshots/`. Agents can add run notes in the same folder when a game is worth revisiting later.

The playtest helpers in `src/playtest/` define this layout and validate that replay timelines point at complete deck and board snapshots.
