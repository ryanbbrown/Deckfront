# Hexdeck

Hexdeck is a Dominion-style deck builder with a five-space fighting arena. One human plays against a ThinHarness AI. Each player creates a private starting build, then uses complete turns to control range, combine cards, buy improvements, and reduce the opponent from 20 health to 0.

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

Saved games use schema version 3. Old ring-out saves are rejected and are not migrated.

## Play

1. Select and edit the AI strategy prompt.
2. Select the first player.
3. Spend up to 12 money on any starting cards. Unspent money carries into the first Buy phase.
4. Play any number of Action cards during your complete turn.
5. End the Action phase to play all Treasure cards.
6. Buy any number of affordable cards, then end the Buy phase.

The arena has five spaces. A difference of 1 is Close, 2 is Mid, and 3 or 4 is Far. Bought cards enter the discard pile. The browser saves previews, supports undo and confirmation, and restores the active game after refresh.

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

The backend suite covers setup, privacy, arena rules, every card, complete turns, purchases, replay, persistence, and AI sequencing. Playwright drives every card and required selection through the production browser and real local server. `npm run test:ai:live` is the opt-in real ThinHarness build-and-turn check.

Card definitions live in `src/game-data/cards.json`. Strategy prompts live in `strategies/`. Saved AI traces live under `.data/ai-traces`.
