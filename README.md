# Hexdeck

Hexdeck is a Dominion-style deck builder with a five-space fighting arena. Play against a ThinHarness AI or play a two-player local game on one laptop. Each player creates a starting build, then uses complete turns to move through shared spaces, control range, combine cards, buy improvements, and reduce the opponent from 20 health to 0.

## Run

Use Node.js 22 or later, Python 3.11 or later, `uv`, `cproxy`, and a Codex login.

```sh
npm install
uv sync
uv tool install git+ssh://git@github.com/ryanbbrown/cproxy.git
codex login status
npm run dev
```

Open `http://localhost:4173`. Set `HEXDECK_AI_FAKE=1` before `npm run dev` to use the deterministic local AI instead of the model bridge.

Optional settings:

```sh
export HEXDECK_AI_MODEL='openai:gpt-5.6-luna'
export HEXDECK_AI_EFFORT='low'
export HEXDECK_AI_TIMEOUT_MS='240000'
export PORT='4173'
export HOST='127.0.0.1'
export HEXDECK_DATA_DIR='.data/games'
export HEXDECK_AI_TRACE_DIR='.data/ai-traces'
```

Saved games use schema version 8. Older saves are rejected and are not migrated.

## Play

1. Select an AI or local opponent. For AI games, select and edit the strategy prompt.
2. Select the first player.
3. Spend up to 12 money on any starting cards. In a local game, Player 1 builds before Player 2. Unspent money carries into each player's first Buy phase.
4. Play any number of Action cards during your complete turn.
5. End the Action phase to play all Treasure cards.
6. Buy any number of affordable cards, then end the Buy phase.

The arena has five spaces. Fighters can share a space and move through each other. A difference of 0 is Close, 1 is Near, and 2 or more is Far. Player 1 starts on space 2 and Player 2 starts on space 3. Bought cards enter the discard pile. Actions resolve immediately. Duplicate hand cards share one quantity-marked card, while played cards remain visible in order until cleanup. Completed AI turns have an expandable recap. One global Undo control restores the latest player action, and refresh restores the active game.

## Verify

```sh
npm test
npm run test:e2e:manifest
npm run test:e2e
npm run test:ai:live
npm run typecheck
npm run lint
npm run build
```

The backend suite covers setup, privacy, arena rules, every card, complete turns, purchases, replay, persistence, AI sequencing, and the balance simulator. Playwright drives every card and required selection through the production browser and real local server. `npm run test:ai:live` sets `HEXDECK_LIVE_AI=1` for the live Vitest case and uses `playwright.live.config.ts`, which sets `HEXDECK_E2E_LIVE=1` for the real-browser bridge case. Both use `HEXDECK_AI_MODEL` and `HEXDECK_AI_EFFORT` when set.

## Balance simulator

`src/sim/` plays headless matches to tune card values. It imports from `src/game/` only, which an ESLint rule enforces. `runMatch` plays one deterministic match between two agents. A strategy is plain data — a starting build, an ordered buy agenda, a preferred range, and scoring weights — and `strategyAgent` turns it into a player that searches the whole Action-phase tree for its best line.

Measure search throughput before changing anything that runs inside that tree:

```sh
npx tsx scripts/measure_search.ts
```

It plays every baseline pairing in every curated kingdom and prints wall clock per decision and per match, states visited, and stop reasons.

The five curated experiment kingdoms are `current-duel`, `three-way-open`, `three-way-engine`, `range-rich-mixed`, and `rigged-melee`. `rigged-melee` is a calibration fixture: it re-prices Heavy Blow to 3 for 6 damage, and `src/sim/calibration.ts` checks that the search finds it. Its threshold, kingdom, and strategies must never be tuned to make it pass.

Card definitions live in `src/game-data/cards.json` and kingdoms in `src/game-data/kingdoms.json`. Strategy prompts live in `strategies/`. Saved AI traces live under `.data/ai-traces`.
