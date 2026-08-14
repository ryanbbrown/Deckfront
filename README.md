# Hexdeck

Hexdeck is a deck-building tactics game on a 19-hex board. Two pieces on each side use movement and card effects to ring out opponents. The first player to score five points wins.

The prototype includes seeded decks, the first shared market, all cards, undo, replay, and maximum-point tactical search. An authoritative local server stores each game. A ThinHarness opponent plays from editable Markdown strategy instructions.

## Run the client

Use Node.js 22 or later. Install `uv` and Python 3.11 or later.

```sh
npm install
uv sync
export OPENAI_API_KEY='your-key'
npm run dev
```

Open `http://localhost:4173`.

Expose the running server when you use bb remotely:

```sh
bb connect expose 4173
```

Open the HTTPS URL that the command returns. The remote link uses your authenticated bb Connect session.

Active games are stored under `.data/games`. Refresh the browser to restore the current game. AI traces are stored under `.data/ai-traces/<game-id>/<revision>.json`.

The default opponent uses `openai:gpt-5.6-luna` with low reasoning effort. Set these optional environment variables before `npm run dev`:

```sh
export HEXDECK_AI_MODEL='openai:gpt-5.6-luna'
export HEXDECK_AI_EFFORT='low'
export HEXDECK_AI_TIMEOUT_MS='240000'
export PORT='4173'
export HOST='127.0.0.1'
export HEXDECK_DATA_DIR='.data/games'
export HEXDECK_AI_TRACE_DIR='.data/ai-traces'
```

Set `HEXDECK_AI_FAKE=1` to run the deterministic bridge fixture without a model request. This mode supports AI turns with no immediate point available.

## Verify the prototype

```sh
npm test
npm run typecheck
npm run lint
npm run build
```

Run the opt-in live ThinHarness smoke test when `OPENAI_API_KEY` is set:

```sh
npm run test:ai:live
```

The tests cover deck conservation, purchases, board rules, every card, status duration, replay, undo, persistence, redaction, concurrent writes, tactical search, and the AI bridge.

Card definitions and synergy tags live in `src/game-data/cards.json`. The first curated market lives in `src/game-data/first-market.json`.
