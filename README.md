# Deckfront

Deckfront is a small TypeScript sandbox for designing a game that combines deck building with territory control.

The name is a blend of deck and front: the deckbuilding engine drives the decisions, while the battle front is the shared territory board those decisions affect.

## Why This Exists

I play a lot of board games. Dominion is probably my favorite game, and deck building in general is one of my favorite game systems. I also like a lot of games with territory control, area control, and tactical positioning.

There are not many games that combine deck building and territory control well. The main one I have played is Tyrants of the Underdark, which was fun at first, but has some clear flaws that made my group stop wanting to play it. Deckfront is an experiment in taking a step back and building my own version of that design space, using AI as a collaborator for implementation, playtesting, and iteration.

The repo has three main pieces:

- A Bun CLI that runs a Dominion-like deckbuilding engine from YAML game configs.
- A Vite/React viewer that renders board states and replay timelines for territory playtests.
- Experiment sandboxes under `experiments/`, each with its own copied game definition, prompts, and playthrough scripts.

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
bun run cli -- --config experiments/E001-current-best/code/game/deck.yaml --state /tmp/deckfront-state.json --seed 1
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
- `--starting-deck <cards>`: override a new state's starting deck; use `P1=card,card` for one player.

## Experiments

Create a new experiment from the canonical base:

```sh
uv run scripts/experiment.py create --id E002-my-hypothesis --from-base --hypothesis "Describe the design question."
```

Create a new experiment from an existing experiment:

```sh
uv run scripts/experiment.py create --id E003-next-variant --from-experiment E002-my-hypothesis --hypothesis "Describe the variant."
```

Each experiment has one mutable game definition:

```text
experiments/<id>/code/game/
  board-rules.md
  cards.json
  deck.yaml
  map.json
  units.json
```

Run playthroughs from inside an experiment's copied code directory:

```sh
cd experiments/E001-current-best/code
uv run scripts/run_game_codex.py --run ../runs/rush-vs-engine-01 --reset --max-turns 30
```

The playthrough runner stores outputs under the experiment:

```text
experiments/<id>/runs/<run>/
  deck.json
  board.json
  timeline.json
  actions/
  results/
  context/
```

Experiment-local prompts live in:

```text
experiments/<id>/code/agent-context/prompts/
```

Prompt changes are therefore part of the experiment's copied code state.

Validate a replay bundle from inside an experiment code directory:

```sh
bun run validate-run -- ../runs/rush-vs-engine-01/timeline.json
```

## Viewer

Start the viewer from the repo root:

```sh
bun run viewer
```

Open the default board:

```text
http://localhost:5173/
```

Open an experiment replay:

```text
http://localhost:5173/?timeline=/game-data/experiments/E001-current-best/runs/rush-vs-engine-01/timeline.json
```

Replay mode starts on the first entry's `before` snapshots, so frame 1 is the initial board state. Press Next to step through completed turn after-states.

## Project Layout

- `src/core/`: deckbuilding engine, actions, scoring, random state.
- `src/config/`: YAML config loading and validation.
- `src/cli/`: command-line interaction, scripting, persistence, rendering.
- `src/board/`: map and board-state schemas, coordinates, and movement helpers.
- `src/replay/`: replay timeline schema.
- `src/playtest/`: playtest run layout and replay bundle validation.
- `viewer/`: React board and replay viewer.
- `experiment-base/`: canonical copied-code template for new experiments.
- `experiments/`: isolated experiment sandboxes and their runs.
- `docs/`: playtest workflow notes and board conventions.
- `tests/`: unit and integration coverage.

Root `src/` and `viewer/` are shared implementation surfaces. Experiment-specific game rules, maps, prompts, and playthrough scripts live under `experiments/<id>/code/`.
