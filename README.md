# Hexdeck

Hexdeck is a full-screen desktop deck-building game for two local players or one player against an AI opponent. Players build decks, move on a six-space arena, combine cards, buy improvements, and try to reduce the other fighter from 50 health to 0.

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

1. Refresh until one of the 30 trained 10-card kingdoms looks interesting. Copper, Silver, Gold, Step, and Focus are in every market. Cull is a normal kingdom pile.
2. Choose two local players or the AI opponent. In an AI game, choose whether you or the AI goes first and select Easy, Normal, Hard, or Expert strength.
3. For a local game, choose whether to use the starting draft. AI games always start without the draft.
4. With the local draft on, Player 1 spends up to 12 money on starting cards, then Player 2 builds. With the draft off, both players start immediately with 7 Copper and 3 Scrap.
5. Play any number of Action cards, end the Action phase to play Treasure cards, buy affordable cards, and end the Buy phase.

Draft-on decks start with 7 Copper. Up to 3 unspent starting money carries into the first Buy phase. Draft-off decks add 3 Scrap, have no carry, and skip the build. Only the first Scrap a player plays each turn deals its 1 damage. Scrap is never sold or gained. Starting-build cards do not reduce market piles.

Normal AI play selects from the server-only `src/server/pretrained-opponents.json` catalog. The catalog contains all 1,572 final-matrix ordered plans for the 30 trained kingdoms, derived from `.data/strategy-search-30/rust-balance-analysis-v1.json`. Selection does not start Rust, strategy-search, or worker processes. Expert uses the saved equilibrium lottery. Easy, Normal, and Hard use the saved score against that lottery. The saved purchase plan controls buys, and the shared tactical agent controls card play and movement.

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

The separate Goldfish-only Modal route runs two container tasks per kingdom: `goldfish-one-reduce` and `goldfish-two-reduce`. Intermediate score files stay on container-local disk, and only the two final files reach the Modal Volume. Its strict request sets 16 to 64 worker cores, maximum active CPUs, scientific wall time, and maximum cost. Plan makes no Modal call, and paid run needs the exact plan token:

```sh
npx tsx scripts/strategy_search_goldfish_modal.ts plan --request REQUEST.json
npx tsx scripts/strategy_search_goldfish_modal.ts run --request REQUEST.json --authorize TOKEN
```

Use [the Goldfish-only operator guide](docs/strategy-search-goldfish-modal.md) for the `balance-tuning-005` request, 32×16, 16×32, and 8×64 comparison shapes at 512 active CPUs, current Modal rates, hard cost guard, exact outputs, and timing split. The route never creates Matrix or PSRO work.

The separate PSRO batch route runs Matrix locally, then runs one complete Rust PSRO search per Modal machine. Every request field is required. `plan`, `status`, `download`, and `report` do not start paid PSRO work. `run` needs the exact token from `plan`:

```sh
npx tsx scripts/strategy_search_psro_modal.ts matrix --request REQUEST.json --root ROOT --goldfish-campaign CAMPAIGN_ID
npx tsx scripts/strategy_search_psro_modal.ts plan --request REQUEST.json --root ROOT
npx tsx scripts/strategy_search_psro_modal.ts run --request REQUEST.json --root ROOT --authorize TOKEN
npx tsx scripts/strategy_search_psro_modal.ts status --request REQUEST.json --root ROOT
npx tsx scripts/strategy_search_psro_modal.ts download --request REQUEST.json --root ROOT
npx tsx scripts/strategy_search_psro_modal.ts report --root ROOT
```

Use [the Modal PSRO batch operator guide](docs/strategy-search-psro-modal.md) for the request limits, current cost formula, ten-minute Volume commit cadence, resume rules, output layout, deep verification, byte comparison, and local dynamic queue.

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

Add verified same-strategy telemetry to a completed local evidence set with:

```sh
npm run strategy-search:self-play-backfill -- \
  --root .data/strategy-search-30 \
  --binary rust/target/release/hexdeck-goldfish \
  --threads 10 \
  --report .data/strategy-search-30/self-play-backfill-v1.json
```

The local command structurally checks file headers, CRCs, source links, checkpoint completion, and final Matrix order. Deep verification is a separate, deliberate `psro-verify` run. It then plays only the 125-seed same-strategy telemetry games. It writes `self-play-v1.hst` beside the initial Matrix and, when PSRO admitted strategies, beside the expanded Matrix. It does not replay Goldfish ranking, Matrix solving, PSRO screening, PSRO decisions, or PSRO races. Existing valid HST files are retained.

Generate the equilibrium-weighted balance analysis with:

```sh
npm run strategy-search:rust-balance-report -- \
  --root .data/strategy-search-30 \
  --binary rust/target/release/hexdeck-goldfish \
  --provenance .data/strategy-search-30/source-provenance-v2.json
```

The command structurally checks Goldfish and HGM formats and CRCs, source links, checkpoint completion, selected Matrix order, and HST evidence before it decodes a kingdom. Deep verification is a separate, deliberate `psro-verify` run; reporting does not replay Goldfish, Matrix, or PSRO. It writes deterministic JSON to `.data/strategy-search-30/rust-balance-analysis-v2.json` and standalone HTML to `.html/strategy-search-30-rust-balance-v2.html`. The native `verify`, `matrix-verify`, and `psro-verify` commands remain available for a deliberate deep audit.

The report weights each telemetry cell by both the acting strategy's stored equilibrium weight and the opponent's stored equilibrium weight. Strategy classification uses acquisitions against the equilibrium opponent. Raw unweighted Matrix counts are audit evidence, not balance headlines. The Matrix payoff diagonal stays fixed at 50%. A paired score byte of 2 does not identify one success and one failure versus two ties, so the report does not claim exact W/D/L.

Generate the Plan 84 eight-kingdom directional comparison after its new evidence is complete:

```sh
npm run strategy-search:card-balance-smoke-report -- \
  --baseline .data/strategy-search-30/rust-balance-analysis-v2.json \
  --root .data/card-balance-smoke-84 \
  --binary rust/target/release/hexdeck-goldfish
```

The command reads the completed 30-kingdom report without changing it. It structurally checks the eight new evidence sets and writes deterministic before/after JSON to `.html/card-balance-smoke-84.json` and matching HTML to `.html/card-balance-smoke-84.html`. The output is a directional smoke, not final balance evidence.

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
