# Hexdeck

Hexdeck is a full-screen desktop deck-building game for two local players or one player against an AI opponent. Players build decks, move on a six-space arena, combine cards, buy improvements, and try to reduce the other fighter from 40 health to 0.

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

The server saves games in `.data/games` by default. You can set `PORT`, `HOST`, or `HEXDECK_DATA_DIR`. Saved game records, browser game views, and exports use schema version 13. The server rejects older saves and does not migrate them.

## Play

1. Refresh until the 10 unique variable cards make an interesting kingdom. Copper, Silver, Gold, Step, and Focus are in every market. Cull is a normal kingdom pile.
2. Choose two local players or the AI opponent. In an AI game, choose whether you or the AI goes first and select Easy, Normal, Hard, or Expert strength.
3. Choose whether to use the starting draft, then start the game. AI training can take several seconds because the server simulates strategies for the chosen kingdom.
4. With the draft on, Player 1 spends up to 12 money on starting cards, then Player 2 builds. With the draft off, both players start immediately with 7 Copper and 3 Scrap.
5. Play any number of Action cards, end the Action phase to play Treasure cards, buy affordable cards, and end the Buy phase.

Draft-on decks start with 7 Copper. Up to 3 unspent starting money carries into the first Buy phase. Draft-off decks add 3 Scrap, have no carry, and skip the build. Only the first Scrap a player plays each turn deals its 1 damage. Scrap is never sold or gained. Starting-build cards do not reduce market piles.

AI strategy training currently uses draft-on simulations. In a draft-off AI game, the trained starting build is ignored, but its purchase plan still controls the opponent.

The arena has spaces 1 through 6. Fighters start on the symmetric middle spaces, Player 1 at 3 and Player 2 at 4. Fighters can share a space and move through each other. Distance 0 is Close, 1 is Near, and 2 or more is Far. Bought cards enter the discard pile. Actions resolve at once. The right rail keeps the public action record visible and shows both full deck compositions without zone counts. In an AI game, a complete AI turn resolves before the server returns the next human state. Its public actions appear in the rail. Undo can roll back every submitted action to the completed-setup boundary. Each undo of a turn-ending human action also removes the full AI response that it caused. Reload restores the active game and its undo history. New game clears the browser's active-game link.

## Verify

```sh
npm test
npm run verify:native
npm run modal:test
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
npm run strategy:report
```

The batch runs two kingdoms at once with four workers each, so it uses at most eight pairing workers.
It keeps complete current results and reruns missing, failed, incomplete, or stale results. Raw output
is ignored under `.experiments/balance-suite/balance-suite-v3/`. Use the tuning split for repeated card
changes. Use the validation split only to confirm a proposed change.

The 50-health, draft-off deep-beam suite reuses the same 100 ten-pile card sets. Each player starts
with 7 Copper and 3 Scrap. It runs one kingdom at a time with 10 workers, 3 iterations, beam width 32,
4 confirmations, and at most 8 active purchase
slots. Run or resume it and check its status with:

```sh
npm run deep-beam:suite:run
npm run deep-beam:suite:run -- --limit 10
npm run deep-beam:suite:status
npm run deep-beam:strategy-ranges
```

`deep-beam:strategy-ranges` writes the current ten-kingdom selected/minimum/maximum archetype shares to the ignored `.data/deep-strategy-equilibrium-ranges-pilot-10.json` artifact. Each range optimizes an archetype jointly over the full equilibrium polytope of each kingdom’s discovered payoff matrix. It then averages kingdoms with equal weight. The range is conditional on the discovered matrix and does not cover strategies that search omitted. Damage archetypes use a fixed, provisional classification from the recorded matrix acquisitions; labels do not change when the LP weights change.

The fixed-reservoir five-run suite compares pool seeds 1–5 on Kingdoms 001 and 009. Prepare the reusable Kingdom 009 seed-1 and seed-2 artifacts once, then run, inspect, and report with:

```sh
npm run fixed-reservoir:five-run:prepare
npm run fixed-reservoir:five-run
npm run fixed-reservoir:five-run:status
npm run fixed-reservoir:five-run:report
```

The suite resumes each pool and PSRO run independently under `.experiments/fixed-reservoir-psro-five-run/`. The report command requires all ten deeply validated runs.

Use `--limit 10` for a resumable ten-kingdom balance pilot. At 330 seconds per kingdom, the serial search takes about 9.2 hours before overhead. Complete results
survive interruption. Inputs, results, and atomic status are ignored under
`.experiments/deep-beam-suite/deep-beam-v1/`.

The response-optimizer pilot compares stratified beam, uniform length-then-token policy racing, dependency-aware discrete CEM, and UCT MCTS against one validated saved target lottery. All four reserve 4,000 of the 60,000 candidate seed blocks for the same eight-candidate final training rerace. Held-out confirmation stays untouched. Run the recorded one-kingdom configuration with:

```sh
npm run response-optimizer:pilot -- --kingdom deep-beam-tuning-001 \
  --budget 60000 --seed 1 --restarts 1 --confirmation-blocks 200 --workers 10
```

The command prints the held-out comparison and writes ignored JSON under
`.experiments/response-optimizer-pilot/`. Pass `--out` to choose another ignored result path.
A score above 52% is a practical exploit. The held-out 95% lower bound must exceed 50% for statistical success.

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
80-kingdom version 2 tuning corpus. The first chart shows the selected deterministic maximum-support
witness and the feasible archetype-share range over each full discovered matrix. The report also shows
pure-family competitive depth and card relationships, and equilibrium-weighted card use. All equilibrium
ranges are conditional on discovered strategies and do not cover omitted strategies.

## Native strategy search

The ordered Kingdom 009 benchmark streams bounded chunks and folds candidate and ranking digests in traversal order. The original, lean TypeScript, and standalone Rust paths must return the same digest.

```sh
npm run goldfish:ordered-benchmark -- --limit 100000 --workers 10 --chunk-size 250 --scorer original
npm run goldfish:ordered-benchmark -- --limit 100000 --workers 10 --chunk-size 250 --scorer lean
npm run goldfish:ordered-benchmark -- --limit 100000 --workers 10 --chunk-size 250 --scorer rust
npm run psro:worker-benchmark -- --workers 4 --candidates 1000 --blocks 1 --mode score-only
npm run psro:worker-benchmark -- --workers 14 --candidates 1000 --blocks 8 --mode score-only
npm run staged-goldfish:native-pool -- --pool-seed 5 --chunk-size 1000 --shard-size 100000 --threads 10
```

The staged product command keeps generation on one ordered TypeScript coordinator. Both scoring stages retain independent bounded shard top sets and merge them deterministically. Goldfish scoring defaults to 10 Rust threads. Competitive pairing defaults to 4 workers, based on the 1,000-candidate one-block production race shape; it is separate from the goldfish default. The native workspace pins Rust 1.98.0. The local build targets the current host. The Modal image builds the pinned Linux x86-64 target. Build and verify the local target with:

```sh
npm run goldfish:native-build
npm run goldfish:native-verify
npm run goldfish:native-kingdom-write
npm run goldfish:native-kingdom-check
npm run modal:test
```

`hexdeck-goldfish` uses versioned line-delimited JSON. It rejects a thread count above the CPU request. Get the rule fingerprint with `npm run goldfish:native-metadata`.

The Modal launcher reserves the worst-case cost for all attempts before launch. It caps total reserved spend at $25, aggregate allocation at 192 physical cores, retries at two, and full-space runs at three. Ordered-run accounting includes the one-core controller. This unattended command launches a detached restart-safe controller. A repeat of the same command resumes the same run without a second reservation:

```sh
modal profile activate ryanburnettebrown
modal run --detach modal/native_strategy_search.py --build-version "$(git rev-parse HEAD)" \
  --rule-fingerprint "$(npm run goldfish:native-metadata --silent)" \
  --count 5000 --shard-size 2500 --cpu 4 --memory-gib 4 --threads 4 \
  --max-containers 2 --timeout-seconds 120 --max-cost-usd 1 --scorer rust
```

Shard checkpoints and the ordered merge live in the `hexdeck-native-strategy-results` Modal Volume. The local reservation ledger is `~/.hexdeck-modal-cost-ledger.json`. Ordered shards call the production TypeScript candidate helper in the image and send its versioned request to Rust. Python does not generate strategies.

Launch or resume the authorized ordered product correction. This configuration reserves at most $2.886 for all retry attempts, uses at most 191 physical cores, and does not launch a local full-space scorer:

```sh
modal run --detach modal/native_strategy_search.py --ordered-product \
  --authorization k009-ordered-product-correction-v1 \
  --build-version "$(git rev-parse HEAD)" \
  --rule-fingerprint "$(npm run goldfish:native-metadata --silent)" \
  --count 12972960 --retained-count 500000 --reservoir-count 20000 \
  --shard-size 250000 --cpu 2 --memory-gib 4 --threads 2 \
  --max-containers 95 --timeout-seconds 420 --max-cost-usd 5 --scorer rust
```

After the controller stops, fetch and validate the deterministic ranked artifact, then build and validate its exact ranked-prefix reservoir:

```sh
RUN_ID=<run-id-printed-by-launch>
mkdir -p .experiments/ordered-goldfish-product/$RUN_ID
modal volume get hexdeck-native-strategy-results \
  "$RUN_ID/ranked.json" ".experiments/ordered-goldfish-product/$RUN_ID/ranked.json"
modal volume get hexdeck-native-strategy-results \
  "$RUN_ID/ranked.json.sha256" ".experiments/ordered-goldfish-product/$RUN_ID/ranked.json.sha256"
npm run goldfish:ordered-product -- validate \
  --artifact ".experiments/ordered-goldfish-product/$RUN_ID/ranked.json"
npm run goldfish:ordered-product -- build-reservoir \
  --artifact ".experiments/ordered-goldfish-product/$RUN_ID/ranked.json" \
  --out ".experiments/ordered-goldfish-product/$RUN_ID/reservoir.json"
npm run goldfish:ordered-product -- validate-reservoir \
  --artifact ".experiments/ordered-goldfish-product/$RUN_ID/ranked.json" \
  --reservoir ".experiments/ordered-goldfish-product/$RUN_ID/reservoir.json"
```

The ranked bytes contain the 500,000-candidate stage-one cohort, all four-seed score evidence, ranks, and shard provenance. Runtime and container data remain in `run-summary.json` on the Modal Volume.

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
