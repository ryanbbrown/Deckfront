# Hexdeck

Hexdeck is a local two-player deck-building game for one browser. Player 1 and Player 2 build decks, move on a five-space arena, combine cards, buy improvements, and try to reduce the other fighter from 20 health to 0.

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
3. The chosen first player starts after both builds finish. Unspent starting money carries into that player's first Buy phase.
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

The simulator plays seeded headless matches between strategy players. A strategy contains a starting build, finite purchase targets, and one card to repeat after those targets are complete. Every strategy uses the same deterministic Action-phase pilot. The pilot searches legal lines without reading the hidden draw order. It compares wins, damage, purchases, Copper thinning, obsolete Cull retirement, draws, and printed attack range in that order.

Build and run an experiment:

```sh
npm run build:sim
npm run experiment -- --kingdom current-duel --mode smoke
npm run experiment -- --kingdom current-duel --mode full
```

Measure search speed before changing match-search code:

```sh
npx tsx scripts/measure_search.ts
npx tsx scripts/measure_search.ts --kingdom rigged-melee --seeds 3 --repeats 5
```

Experiment output goes to `.experiments/<kingdom>/<mode>/`. Reports are committed. Generated JSON inputs and results stay ignored but are not cleanup targets. The curated kingdoms are `current-duel`, `three-way-open`, `three-way-engine`, `range-rich-mixed`, and `rigged-melee`.

The committed balance baseline uses run seed 1, 100 candidates, 5 leaders, 32 generations, 25 shared seeds, 10 workers, 30 turns per player, a 20,000-state search limit, and a 420-minute deadline. Run each curated kingdom with these limits before regenerating the dashboard:

```sh
npm run build:sim
node dist-sim/experiment.mjs --kingdom current-duel --mode full --seed 1 --candidates 100 --leaders 5 --generations 32 --seeds 25 --workers 10 --deadline-minutes 420 --state-limit 20000
```

Repeat the experiment command for the other four curated kingdom ids. Each run replaces its own full-run directory.

Generate and open the dashboard:

```sh
npx tsx scripts/write_balance_dashboard.ts
open -a "Google Chrome" .html/balance-baseline.html
```

The generator reads `run.json`, `generations.jsonl`, `strategies.json`, `telemetry.json`, and `tournament.json` from each ignored `.experiments/<kingdom>/full/` directory. It rejects old strategy shapes, lower limits, incomplete runs, and missing cross-file data. It writes the committed `.html/balance-baseline.html` file.

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
