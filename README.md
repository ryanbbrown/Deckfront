# Hexdeck

Hexdeck is a deck-building tactics game on a 37-hex board. Two pieces on each side use movement and card effects to ring out opponents. The first player to score five points wins.

The prototype includes seeded decks, the first shared market, all cards, action previews, undo, replay, and atomic tactical search. An authoritative local server stores each game. A ThinHarness opponent plays from editable Markdown strategy instructions.

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

Players alternate one action at a time. Each piece has one baseline move per round. Select a card or a piece, then select the highlighted actor, target, or destination. Review the resolved preview. Confirm it to give the opponent control, or undo it.

Pass is final for the round. After both players pass, they each make one purchase in pass order. Remaining cards are discarded, both players draw five cards, and the other player starts the next round. Named action cards have no per-piece limit. Relay can be used once per player per round. Cull trashes exactly two cards.

The default opponent uses `openai:gpt-5.6-luna` with low reasoning effort. It receives every legal atomic action and returns one opaque action ID. Set these optional environment variables before `npm run dev`:

```sh
export HEXDECK_AI_MODEL='openai:gpt-5.6-luna'
export HEXDECK_AI_EFFORT='low'
export HEXDECK_AI_TIMEOUT_MS='240000'
export PORT='4173'
export HOST='127.0.0.1'
export HEXDECK_DATA_DIR='.data/games'
export HEXDECK_AI_TRACE_DIR='.data/ai-traces'
```

Set `HEXDECK_AI_FAKE=1` to run the deterministic bridge fixture without a model request. This mode chooses one listed action for each AI action step or purchase.

## Verify the prototype

```sh
npm test
npm run test:e2e
npm run typecheck
npm run lint
npm run build
```

Install `cproxy` and sign in through the Codex CLI before using the real opponent:

```bash
uv tool install git+ssh://git@github.com/ryanbbrown/cproxy.git
codex login status
```

Each real ThinHarness action runs through an isolated `cproxy` process. It does not use OpenAI API credits.

Run the opt-in live ThinHarness smoke test:

```sh
npm run test:ai:live
```

You can also run the live browser configuration directly:

```sh
npx playwright test --config playwright.live.config.ts
```

Each browser scenario starts a production server on an isolated port. It uses unique temporary game and trace directories. The suite attaches the saved game, server output, browser console, and page errors to every unexpected failure. Playwright also retains the trace, video, and screenshot.

The real-server browser suite drives every card through visible controls. It also covers action preview, undo, confirmation, stale revisions, handoffs, pass, both purchase orders, buy nothing, cleanup timing, refresh recovery, and AI retry safety. Unit and integration tests cover round rules, every exact card ability and cost, deck conservation, redaction, concurrent writes, tactical search, replay, persistence, and the one-action AI contract.

Card definitions and synergy tags live in `src/game-data/cards.json`. The first curated market lives in `src/game-data/first-market.json`.
