# Hexdeck

Hexdeck is a full-screen desktop deck-building game for two local players or one player against an AI opponent. Players build decks, move on a five-space arena, combine cards, buy improvements, and try to reduce the other fighter from 40 health to 0.

The table is designed for a 1920×1080 screen. Mobile and smaller desktop layouts are not supported.

## Requirements

- Node.js 22 or later
- npm

Install and start the browser and local server:

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4173`.

The server saves games in `.data/games` by default. You can set `PORT`, `HOST`, or `HEXDECK_DATA_DIR`. Saved game records, browser game views, and exports use schema version 12. The server rejects older saves and does not migrate them.

## Play

1. Refresh until the 10 unique variable cards make an interesting kingdom. Copper, Silver, Gold, Step, Cull, and Focus are in every market.
2. Choose two local players or the AI opponent. In an AI game, choose whether you or the AI goes first and select Easy, Normal, Hard, or Expert strength.
3. Start the game. AI training can take several seconds because the server simulates strategies for the chosen kingdom.
4. Player 1 spends up to 12 money on starting cards in the compact market. Player 2 builds next. The AI submits its own build automatically.
5. Play any number of Action cards, end the Action phase to play Treasure cards, buy affordable cards, and end the Buy phase.

Every deck starts with 7 Copper. Up to 3 unspent starting money carries into that player's first Buy phase. Starting-build cards do not reduce market piles.

Fighters can share a space and move through each other. Distance 0 is Close, 1 is Near, and 2 or more is Far. Bought cards enter the discard pile. Actions resolve at once. The right rail keeps the public action record visible and shows both full deck compositions without zone counts. In an AI game, a complete AI turn resolves before the server returns the next human state. Its public actions appear in the rail. Undo can roll back every submitted action to the completed-setup boundary. Each undo of a turn-ending human action also removes the full AI response that it caused. Reload restores the active game and its undo history. New game clears the browser's active-game link.

## Verify

```sh
npm test
npm run test:e2e:manifest
npm run test:e2e
npm run typecheck
npm run lint
npm run build
npm run build:sim
```

Vitest checks the engine, random kingdoms, AI training, server, persistence, replay, and simulator. Playwright uses the built browser and real local server to check the full-table preview, starting builds, AI turns, cards, undo, reload, victory, and the 1920×1080 layout. The E2E manifest maps required behavior to exact test IDs.

## Balance simulator

The simulator plays seeded headless matches between strategy players. A strategy contains a starting build, finite purchase targets, and one card to repeat after those targets are complete. Every strategy uses the same deterministic Action-phase pilot. The pilot chooses from visible state with bounded rules for movement, setup cards, attacks, spells, draw, Cull, Prism, and Reclaim. It does not read the hidden draw order.

Production experiments run through a compact mutable kernel that stores cards as numeric indexes and counts telemetry directly. The browser keeps the immutable event-producing game engine. Tests compare complete match results from both implementations. The old full-tree pilot remains only as a behavior and speed reference.

Build and run an experiment:

```sh
npm run build:sim
npm run experiment -- --kingdom current-duel --mode smoke
npm run experiment -- --kingdom current-duel --mode full
```

Measure the full-tree reference, the shared pilot on the immutable engine, and the production kernel:

```sh
npx tsx scripts/measure_search.ts --kingdom current-duel --pilot full
npx tsx scripts/measure_search.ts --kingdom current-duel --pilot tactical
npx tsx scripts/measure_search.ts --kingdom current-duel --pilot kernel --repeats 20
npm run compare:pilots
npm run measure:workers -- --workers 4 --jobs 500 --seeds 25
```

Experiment output goes to `.experiments/<kingdom>/<mode>/`. Each run writes `run.json`,
`iterations.jsonl`, `matrix.json`, `strategies.json`, `telemetry.json`, and `report.md`. Reports are
ignored by Git. Generated inputs and results are local experiment artifacts, not cleanup targets. The curated
kingdoms are `current-duel`, `three-way-open`, `three-way-engine`, and `range-rich-mixed`.

After all four full runs finish, generate the committed diagnostic report:

```sh
npm run balance:report
```

The generator reads the ignored local `.experiments/` inputs, rejects stale rules fingerprints or
incomplete runs, and writes `.html/balance-report.html`.

The broad balance suite has 80 tuning kingdoms and 20 held-back validation kingdoms. Its variable
card pool is the same `VARIABLE_ACTION_IDS` list used by playable random markets. Regenerate its
committed manifest, resume its full searches, validate the artifacts, and build its report with:

```sh
npm run balance:suite:manifest
npm run balance:suite:run
npm run balance:suite:run -- --tuning-only
npm run balance:suite:validate
npm run balance:suite:report
```

The batch runs two kingdoms at once with four workers each, so it uses at most eight pairing workers.
It keeps complete current results and reruns missing, failed, incomplete, or stale results. Raw output
is ignored under `.experiments/balance-suite/balance-suite-v2/`. Use the tuning split for repeated card
changes. Use the validation split only to confirm a proposed change.
The search uses policy-space response oracles. It starts each restart from random legal strategies,
solves a maximum-support equilibrium over the discovered payoff matrix, and searches for a response
to that weighted strategy mixture. Full mode uses three independent restarts, solves their completed
union matrix, and automatically repeats a broad random final search until it finds no admitted challenger.

Useful limits can be lowered for a quick run:

```sh
node dist-sim/experiment.mjs --kingdom current-duel --mode smoke --seed 1 \
  --restarts 1 --initial-strategies 5 --candidates 20 --iterations 4 \
  --seeds 8 --union-iterations 2 --workers 4
```

Four workers are the measured default on an Apple M4 Pro. More workers remain available with `--workers`, but short simulation jobs become slower when process messaging and result transfer exceed the saved game time.

The committed [.html/balance-report.html](.html/balance-report.html) reports the four diagnostic runs.
The committed [.html/balance-corpus-18-card.html](.html/balance-corpus-18-card.html) reports the latest
completed 80-kingdom run. It is historical evidence because that run excluded Strike and predates
Repelling Shot. The next `.html/balance-corpus.html` will be generated after the version 2 suite runs.

## Code boundaries

The arrows show import direction:

```text
src/server -------------> src/sim -------------> src/game -> src/game-data
src/server -------------> src/shared, src/game
src/shared -------------> src/game
src/client -------------> src/shared, src/game
```

Game data defines cards and kingdoms. The game module contains deterministic rules. The simulator imports only simulator modules and the game module. The server uses simulator strategies to train and run the AI opponent. The client does not import simulator code. ESLint enforces the game and simulator limits.

## Repository tree

```text
src/game-data/   Card and kingdom JSON
src/game/        Deterministic rules, state, commands, and replay
src/shared/      Browser-server API types
src/client/      React local-game UI
src/server/      HTTP routes, game service, and file persistence
src/sim/         Deterministic balance strategies and experiment runner
scripts/         E2E validation and simulator utilities
test/            Vitest and Playwright behavior tests
.plans/          Current plans and archived decision history
.experiments/    Balance reports and ignored generated run data
.html/           Kept HTML artifacts
```
