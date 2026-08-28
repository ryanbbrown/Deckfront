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

The deterministic `balance-suite-v4` design has 128 tuning kingdoms and 32 held-back validation
kingdoms. It uses the same 40 variable cards as playable random markets. Regenerate or check its
manifest, validate it, and reproduce the design report with:

```sh
npm run balance:suite:manifest
npm run balance:suite:manifest -- --check
npm run balance:suite:search-check
npm run balance:smoke:manifest -- --check
npm run balance:suite:validate
npm run balance:suite:design-report
npm run balance:suite:design-report -- --check
```

`balance:suite:search-check` compiles and reruns the fixed-seed covering search. It takes about five
minutes on an Apple M4 Pro. Normal manifest checks remeasure the pinned search result and are faster.

The 30-kingdom process-smoke set uses only tuning kingdoms. Its IDs, the 25-to-30 comparison, and
coverage statistics are in `src/sim/balance-smoke-suite-manifest.json`.

The report is `.html/kingdom-suite-design.html`. The production balance campaign is blocked on the
Kingdom 009 consistency protocol and needs separate spending approval. `balance:suite:run`, the old
corpus loader, and the old strategy report fail closed while that protocol is pending.

The 50-health, draft-off deep-beam suite uses the frozen 100-row v3 strategy-search manifest, not the
active v4 balance manifest. Each player starts
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

The response-optimizer pilot compares stratified beam, uniform length-then-token policy racing, dependency-aware discrete CEM, and UCT MCTS against one validated saved target lottery. All four reserve 4,000 of the 60,000 candidate shuffle-seed evaluations for the same eight-candidate final training rerace. Held-out confirmation stays untouched. Run the recorded one-kingdom configuration with:

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

The committed `.html/strategy-report.html` is a historical report from the completed 80-kingdom
version 2 tuning corpus. `npm run strategy:report` now fails closed while the Kingdom 009 production
protocol is pending. The historical equilibrium ranges remain conditional on discovered strategies and
do not cover omitted strategies.

## Native strategy search

The scalable command accepts one strict request with `kingdomIds` and `maxActiveCpus`. It derives all seeds, protocols, jobs, resources, and paths. Plan before any launch:

```sh
npm run strategy-search:campaign -- plan --request REQUEST.json
npm run strategy-search:campaign -- status --request REQUEST.json
npm run strategy-search:campaign -- run --request REQUEST.json --authorize TOKEN
```

`plan` makes no Modal call. Every `run` needs the exact token printed for that request and capacity. `run` builds and checks the Rust binary before the campaign starts. Rust maps strategy numbers to shopping lists, runs every Goldfish game, ranks rows, writes the final files, and verifies them. Matrix and PSRO read the reservoir after Rust verifies it. Use [the operator guide](docs/strategy-search-campaign-operator.md) for the request contract, status, output, and paid smoke boundaries.

Run the full Goldfish reservoir step locally with 10 threads:

```sh
npm run goldfish:reservoir -- balance-tuning-005 10 .data/goldfish/balance-tuning-005
```

The command writes:

- `goldfish/top-500000.hgf`: the best 500,000 rows after shuffle 1;
- `goldfish/reservoir.hgf`: the best 20,000 rows after shuffles 1 to 4;
- `reports/*.json`: command timings, byte counts, and verification output.

Verify the final files directly:

```sh
rust/target/release/hexdeck-goldfish verify --kingdom balance-tuning-005 \
  --kind top --file .data/goldfish/balance-tuning-005/goldfish/top-500000.hgf
rust/target/release/hexdeck-goldfish verify --kingdom balance-tuning-005 \
  --kind reservoir --file .data/goldfish/balance-tuning-005/goldfish/reservoir.hgf \
  --top .data/goldfish/balance-tuning-005/goldfish/top-500000.hgf
```

Run the complete PSRO response search after the initial matrix files exist:

```sh
npm run psro:search -- balance-tuning-005 10 \
  .data/goldfish/balance-tuning-005/goldfish/top-500000.hgf \
  .data/goldfish/balance-tuning-005/goldfish/reservoir.hgf \
  .data/matrix/balance-tuning-005 \
  .data/psro/balance-tuning-005
```

One Rust process screens the reservoir, confirms responses, admits one response at a time, solves each expanded matrix, and stops after two clean searches. It writes binary look and admission files, `checkpoint.hpc`, `decisions.hpd`, expanded matrix files after an admission, and `run-report.json`. Run the same command again to continue from the first unfinished look.

Verify the complete result directly:

```sh
rust/target/release/hexdeck-goldfish psro-verify \
  --kingdom balance-tuning-005 \
  --top-file .data/goldfish/balance-tuning-005/goldfish/top-500000.hgf \
  --reservoir .data/goldfish/balance-tuning-005/goldfish/reservoir.hgf \
  --matrix-dir .data/matrix/balance-tuning-005 \
  --out .data/psro/balance-tuning-005
```

The campaign still uses its existing JSON Matrix and PSRO path. Wiring the Rust commands into campaign publication is deferred until the campaign publishes the three Rust initial-matrix files. The old campaign PSRO path stays in place until that prerequisite is complete.

`rust/goldfish/kingdoms.json` contains every registered strategy-search kingdom. Generate it after kingdom or rule changes, then run the check:

```sh
npm run goldfish:native-kingdom-write
npm run goldfish:native-kingdom-check
npm run goldfish:native-verify
npm run modal:test
```

With no subcommand, `hexdeck-goldfish` keeps the versioned JSON line protocol for Rust-versus-TypeScript conformance tests and the competitive PSRO kernel. It rejects a thread count above the CPU request.

`nativeCompetitiveModalInput` creates the fixed candidate table and schedule artifact for one PSRO look. The competitive Modal entry point retries missing shards, writes digest-checked score-byte artifacts, and restores candidate-major output. The launch rejects more than 48 containers or a cost cap above $2:

```sh
modal run --detach modal/native_strategy_search.py::launch_competitive \
  --input-file competitive-input.json --build-version "$(git rev-parse HEAD)" \
  --cpu 4 --memory-gib 4 --threads 4 --max-containers 16 \
  --timeout-seconds 180 --max-cost-usd 2
```

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
