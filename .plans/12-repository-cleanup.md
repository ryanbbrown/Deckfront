# Repository cleanup

## Approved scope

The browser and server support two local players on one device. The deterministic game engine and balance simulator remain. The browser and server do not use simulator strategies yet.

This cleanup removes the complete remote-model gameplay path, its configuration, prompts, tests, generated data, and UI. It keeps the current source module layout and does not add an agent framework.

## Dependency direction

The arrows show import direction:

```text
src/sim ----------------> src/game -> src/game-data
src/shared -------------> src/game
src/client -------------> src/shared, src/game
src/server -------------> src/shared, src/game
```

`src/sim` may use `src/game`, but not client, server, or shared modules. Client and server do not import `src/sim` yet. ESLint enforces the game and simulator limits.

## Removals

- Remove `scripts/run_ai_action.py`, `src/ai/`, `src/server/aiRunner.ts`, `src/server/aiCoordinator.ts`, `src/server/strategies.ts`, `strategies/`, `pyproject.toml`, and `uv.lock`.
- Remove model routes, jobs, runtime settings, strategy prompts, remote-player privacy branches, action audits, summaries, recaps, polling, retries, and elapsed-time UI.
- Remove live-model tests, configuration, npm scripts, and E2E manifest entries.
- Remove the obsolete AI HTML mock.
- Delete approved ignored saves, traces, reports, Python environments, bytecode, and stale `dist/`. Keep `.experiments/`, `.reviews/`, and unrelated `.archive/` data.

## Local game contract

The setup accepts an optional integer seed and a first player. Player 1 and Player 2 submit starting builds in sequence. Each active player can play actions, buy cards, end phases, and undo the latest action. Reload, persistence, replay, export, revision locking, victory, and all card rules remain.

The server returns complete local game data for both players. The export is a game export, not a redacted export.

## Schema break

Saved `GameRecord` and browser `GameView` data use schema version 9. Version 9 removes remote-player fields and renames `humanBuildProposal` to `buildProposal`. Older saves are rejected with no migration or compatibility path. The internal deterministic `GameState` stays at schema version 8 because its game rules did not change.

## Checks

Run:

```sh
npm test
npm run test:e2e:manifest
npm run test:e2e
npm run typecheck
npm run lint
npm run build
npm run build:sim
```

Search the active tree for removed integration terms and obsolete board-rule terms. Those terms may exist only in `.plans/archive/`. Record `git status --short`, `git diff --stat`, and residual risks.

## Completion criteria

- The browser completes a two-player game with sequential builds and local turns.
- Old schema saves fail clearly.
- No remote-model code, configuration, route, test, UI, or documentation remains active.
- The E2E manifest names only useful local game, card, and layout flows.
- Active plans are only 09, 10, 11, and 12, plus `.gitkeep` and `archive/`.
- All required checks pass and `dist/` is rebuilt.
