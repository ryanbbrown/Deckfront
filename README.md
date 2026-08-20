# Hexdeck

Hexdeck is a local two-player deck-building game for one browser. Player 1 and Player 2 build decks, move on a five-space arena, combine cards, buy improvements, and try to reduce the other fighter from 40 health to 0.

The browser has no computer opponent. `src/sim/` has deterministic strategy players for balance experiments. Those simulator strategies are separate from browser play and are not a browser opponent.

## Requirements

- Node.js 22 or later
- npm

Install and start the browser and local server:

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:4173`.

The server saves games in `.data/games` by default. You can set `PORT`, `HOST`, or `HEXDECK_DATA_DIR`. Saved game records use schema version 9. Browser game views and exports use schema version 10. The server rejects older saves and does not migrate them.

## Play

1. Choose Player 1 or Player 2 as the first player. You can also enter a seed to repeat the same shuffle.
2. Player 1 spends up to 12 money on starting cards. Player 2 builds next.
3. The chosen first player starts after both builds finish. Up to 3 unspent starting money carries into that player's first Buy phase.
4. Play any number of Action cards.
5. End the Action phase to play all Treasure cards.
6. Buy any number of affordable cards, then end the Buy phase.

Fighters can share a space and move through each other. Distance 0 is Close, 1 is Near, and 2 or more is Far. Bought cards enter the discard pile. Actions resolve at once. Undo restores the latest action. Reload restores the active game. New game clears the browser's active-game link.

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

Vitest checks the engine, server, persistence, replay, and simulator. Playwright uses the built browser and real local server to check setup, cards, turns, undo, reload, victory, and layout. The E2E manifest maps required behavior to exact test IDs.

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

The broad balance suite has 80 tuning kingdoms and 20 held-back validation kingdoms. Regenerate its
committed manifest, resume its full searches, validate the artifacts, and build its report with:

```sh
npm run balance:suite:manifest
npm run balance:suite:run
npm run balance:suite:validate
npm run balance:suite:report
```

The batch runs two kingdoms at once with four workers each, so it uses at most eight pairing workers.
It keeps complete current results and reruns missing, failed, incomplete, or stale results. Raw output
is ignored under `.experiments/balance-suite/balance-suite-v1/`. Use the tuning split for repeated card
changes. Use the validation split only to confirm a proposed change.

The search uses policy-space response oracles. It starts each restart from random legal strategies,
solves a maximum-support equilibrium over the discovered payoff matrix, and searches for a response
to that weighted strategy mixture. Rectified-Nash niches help discovery but never define the final
mixture. Full mode uses three independent restarts and solves their completed union matrix.

Useful limits can be lowered for a quick run:

```sh
node dist-sim/experiment.mjs --kingdom current-duel --mode smoke --seed 1 \
  --restarts 1 --initial-strategies 5 --candidates 20 --iterations 4 \
  --niche-additions 1 --seeds 8 --union-iterations 2 --workers 4
```

Four workers are the measured default on an Apple M4 Pro. More workers remain available with `--workers`, but short simulation jobs become slower when process messaging and result transfer exceed the saved game time.

The committed [.html/balance-report.html](.html/balance-report.html) reports the four diagnostic runs.
The committed [.html/balance-corpus.html](.html/balance-corpus.html) reports the 100-kingdom suite.

## Code boundaries

The arrows show import direction:

```text
src/sim ----------------> src/game -> src/game-data
src/shared -------------> src/game
src/client -------------> src/shared, src/game
src/server -------------> src/shared, src/game
```

Game data defines cards and kingdoms. The game module contains deterministic rules. The simulator imports only simulator modules and the game module. The browser and server do not import simulator code yet. ESLint enforces the game and simulator limits.

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
