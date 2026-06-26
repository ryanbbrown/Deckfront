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

Create a new state with game-level starting deck overrides:

```sh
bun run cli -- --config rulesets/territory-v1/deck.yaml --state .games/e001-baseline/deck.json --seed 1 --max-actions 0 --starting-deck P1=copper,copper,copper,copper,copper,copper,copper,zap,bandage --starting-deck P2=copper,copper,copper,copper,copper,copper,copper,village,silver
```

Create a new state from draft-start rules, using 7 Copper plus up to 12 coin of drafted cards per player. Unspent draft money carries into that player's first turn:

```sh
bun run cli -- --config rulesets/territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6/deck.yaml --state .games/e024/deck.json --seed 1 --max-actions 0 --draft P1=zap,bandage,silver --draft P2=village,silver
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

## Playtest Runs

Initialize a run:

```sh
bun run init-run -- --run .games/e001-baseline --ruleset territory-v1 --map sketch-v1
```

Initialize from the corrected starter board:

```sh
bun run init-run -- --run .games/e001-baseline --ruleset territory-v1 --map sketch-v1 --board .games/territory-v1-playtest/snapshots/turn-001.before.board.json
```

Validate a replay bundle:

```sh
bun run validate-run -- .games/e001-baseline/timeline.json
```

Run an experimental two-agent Claude Code playthrough:

```sh
uv run scripts/run_game.py --run .games/e024-claude-vs-claude --reset --max-turns 30
```

`scripts/run_game.py` creates one persistent Claude Code session per player and alternates turns. Each player session mutates the shared run directory on its own turn, using the existing `deck-turn`, `board-turn`, `commit-turn`, and strict validation CLIs. By default it uses the E024 high-movement six-center ruleset, `claude-opus-4-8` (Opus 4.8), low effort, and a 180-second per-turn timeout; override with `--model`, `--effort`, or `--timeout-seconds` if needed.

Shared playtest prompts live in `agent-context/prompts/`. Runners render those prompts and snapshot the exact run context under `.games/<run>/context/`, including the base player prompt, per-player initial prompts, per-turn prompts, compact briefings, and a manifest with prompt/rule/map file hashes.

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
- `src/board/`: map and board-state schemas, coordinates, and movement helpers.
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
