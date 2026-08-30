# Deckfront

Deckfront is a full-screen desktop deck-building game for two local players or one player against an AI opponent. Players build decks, move on a six-space arena, combine cards, buy improvements, and try to reduce the other fighter from 50 health to 0.

The table supports desktop screens from 1280×720 through 1920×1080. Mobile layouts are not supported.

## Requirements

- Node.js 22 or later
- npm

Install and start the browser and local server:

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4173`.

The server saves games in `.data/games` by default. You can set `PORT`, `HOST`, or `HEXDECK_DATA_DIR`. Saved game records, browser game views, and exports use schema version 14. The server rejects older saves and does not migrate them.

## Play

1. Refresh until one of the 30 trained 10-card kingdoms looks interesting. Copper, Silver, Gold, Step, and Focus are the five fixed market piles. Scrap is a starter card, not a market pile. Cull is a normal kingdom pile.
2. Choose two local players or the AI opponent. In an AI game, choose whether you or the AI goes first, select Easy, Normal, Hard, or Expert strength, and choose whether to animate AI turns.
3. For a local game, choose whether to use the starting draft. AI games always start without the draft.
4. With the local draft on, Player 1 spends up to 12 money on starting cards, then Player 2 builds. With the draft off, both players start immediately with 7 Copper and 3 Scrap.
5. Play any number of Action cards, end the Action phase to play Treasure cards, buy affordable cards, and end the Buy phase.

Draft-on decks start with 7 Copper. Up to 3 unspent starting money carries into the first Buy phase. Draft-off decks add 3 Scrap, have no carry, and skip the build. Only the first Scrap a player plays each turn deals its 1 damage. Scrap cannot be bought or gained. Starting-build cards do not reduce market piles. Mana persists between turns, but each player keeps at most 3 mana when their Buy phase ends.

AI games select from the server-only `src/server/pretrained-opponents.json` catalog. The catalog contains 1,588 final-Matrix ordered plans for 30 trained kingdoms, including 71 positive-weight equilibrium entries. The plans and equilibrium weights were trained at 40 starting health; playable games use 50 starting health, so this catalog is provisional rather than an exact equilibrium for the playable health setting. It is derived from `.data/starfire-12-balance-88/rust-balance-analysis-v2.json` (SHA-256 `9c8c0ff5bc09cda7ea4c44bacea99ff301dff23538b7c4047f8e8ecf8cc5a8de`). The source provenance is `.data/starfire-12-balance-88/source-provenance-v2.json` (SHA-256 `02ab1ab354d4571bc1e045006a77ee9db749cf90de24b342bafe4e1fdb7e6589`). Selection does not start strategy search or worker processes. Expert uses the saved equilibrium lottery. Easy, Normal, and Hard use the saved score against that lottery. The saved purchase plan controls buys, and the shared tactical agent controls card play and movement.

The arena has spaces 1 through 6. Fighters start on the symmetric middle spaces, Player 1 at 3 and Player 2 at 4. Fighters can share a space and move through each other. Distance 0 is Close, 1 is Near, and 2 or more is Far. See the [card reference](./.plans/09-card-list.md) for current costs and card text. Bought cards enter the discard pile and briefly appear as readable card previews above their market piles. Actions resolve at once. Played cards move from the hand to Played this turn, repeated stack plays use the same quick cadence, effect draws rise into the hand, and hits flash the damaged fighter with the damage amount. Small draw and discard piles at the bottom left show the exact draw count, discard count, and latest discarded card. The right rail keeps the public action record visible and shows both full deck compositions without zone counts. In an AI game, the server still resolves the complete turn before it returns, then the table shows the AI hand and replays visible card plays about half a second apart. Consecutive copies of the same card use the quick stack cadence instead. End-of-turn replenishment stays hidden. Turn off `Animate AI turns` for the immediate result. Undo can roll back every submitted action to the completed-setup boundary. Each undo of a turn-ending human action also removes the full AI response that it caused. Reload restores the active game and its undo history. New game clears the browser's active-game link.

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

Verify the committed catalog byte for byte against a final analysis file:

```sh
npx tsx scripts/verify_pretrained_catalog.ts --source /path/to/rust-balance-analysis-v2.json
```

Vitest checks the engine, trained kingdom selection, AI plan selection, server, persistence, replay, and simulator. Playwright uses the built browser and real local server to check the full-table preview, starting builds, AI turns, cards, undo, reload, victory, and the 1280×720 through 1920×1080 layouts. The E2E manifest maps required behavior to exact test IDs.

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

After all four full runs finish, generate the local diagnostic report:

```sh
npm run balance:report
```

The generator reads the ignored local `.experiments/` inputs, rejects stale rules fingerprints or
incomplete runs, and writes the ignored local file `.html/balance-report.html`.

The broad balance suite has 80 tuning kingdoms and 20 held-back validation kingdoms. Its variable
card pool is the same `VARIABLE_ACTION_IDS` list used by playable random markets. Regenerate its
committed manifest, resume its full searches, validate the artifacts, and build its report with:

```sh
npm run balance:suite:manifest
npm run balance:suite:run
npm run balance:suite:run -- --tuning-only
npm run balance:suite:validate
npm run balance:suite:report
npm run strategy:report
```

The batch runs two kingdoms at once with four workers each, so it uses at most eight pairing workers.
It keeps complete current results and reruns missing, failed, incomplete, or stale results. Raw output
is ignored under `.experiments/balance-suite/balance-suite-v3/`. Use the tuning split for repeated card
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

`npm run strategy:report` writes the exploratory `.html/strategy-report.html` from the completed
80-kingdom version 2 tuning corpus. The report shows equilibrium-weighted strategy types, pure-family
competitive depth and card relationships, and equilibrium-weighted card use.

## Code boundaries

The arrows show import direction:

```text
src/server -------------> src/sim -------------> src/game -> src/game-data
src/server -------------> src/shared, src/game
src/shared -------------> src/game
src/client -------------> src/shared, src/game
```

Game data defines cards and kingdoms. The game module contains deterministic rules. The simulator imports only simulator modules and the game module. The server selects a saved purchase strategy and uses the simulator tactical agent to run the AI opponent. The client does not import simulator code or the pretrained catalog. ESLint enforces the game and simulator limits.

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
.html/           Ignored local HTML reports and review artifacts
```
