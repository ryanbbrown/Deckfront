# Hexdeck

Hexdeck is a deck-building tactics game on a 37-hex board. Two pieces on each side use movement and card effects to ring out opponents. The first player to score five points wins.

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

Select a card before you act. The board highlights only friendly pieces that can use that card. Select one friendly piece. Then select a highlighted target or destination. Select the active piece again to change your choice.

Each piece can use each named action once during its turn. A duplicate card can use the other piece when that piece has a legal action. Relay can be used once per turn. Cull and treasure cards remain unrestricted.

The default opponent uses `openai:gpt-5.6-terra` with medium reasoning effort. Set these optional environment variables before `npm run dev`:

```sh
export HEXDECK_AI_MODEL='openai:gpt-5.6-terra'
export HEXDECK_AI_EFFORT='medium'
export HEXDECK_AI_TIMEOUT_MS='240000'
export PORT='4173'
export HOST='127.0.0.1'
export HEXDECK_DATA_DIR='.data/games'
export HEXDECK_AI_TRACE_DIR='.data/ai-traces'
```

Set `HEXDECK_AI_FAKE=1` to run the deterministic bridge fixture without a model request. This mode takes a maximum-point line and makes one opening board action.

## Verify the prototype

```sh
npm test
npm run test:e2e
npm run test:e2e:manifest
npm run typecheck
npm run lint
npm run build
```

Install `cproxy` and sign in through the Codex CLI before using the real opponent:

```bash
uv tool install git+ssh://git@github.com/ryanbbrown/cproxy.git
codex login status
```

Each real ThinHarness turn runs through an isolated `cproxy` process. It does not use OpenAI API credits.

Run the opt-in live ThinHarness smoke test:

```sh
npm run test:ai:live
```

You can also run the live browser configuration directly:

```sh
npx playwright test --config playwright.live.config.ts
```

Each browser scenario starts a production server on an isolated port. It uses unique temporary game and trace directories. The suite attaches the saved game, server output, browser console, and page errors to every unexpected failure. Playwright also retains the trace, video, and screenshot.

The browser suite drives every card and rule branch through visible controls. Its checked-in manifest maps 100 required rules to exact Playwright test IDs. The manifest validator uses Playwright test discovery and rejects missing, renamed, skipped, comment-only, or substring-only IDs.

The other tests cover deck conservation, redaction, concurrent writes, tactical search, and the AI bridge.

Card definitions and synergy tags live in `src/game-data/cards.json`. The first curated market lives in `src/game-data/first-market.json`.
