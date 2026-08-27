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

`plan` makes no Modal call. Every `run` needs the exact token printed for that request and capacity. `status` is bounded and read-only. The runtime has no paused-campaign import, source repair, manual launch recovery, or code-level cost gate. Final artifacts live under per-kingdom evidence IDs, so a later request can reuse a complete matching kingdom. Use [the operator guide](docs/strategy-search-campaign-operator.md) for the request contract, authorization, status, output, and the K007 smoke boundary.

The ordered Kingdom 009 benchmark streams bounded chunks and folds candidate and ranking digests in traversal order. The original, lean TypeScript, and standalone Rust paths must return the same digest.

```sh
npm run goldfish:ordered-benchmark -- --limit 100000 --workers 10 --chunk-size 250 --scorer original
npm run goldfish:ordered-benchmark -- --limit 100000 --workers 10 --chunk-size 250 --scorer lean
npm run goldfish:ordered-benchmark -- --limit 100000 --workers 10 --chunk-size 250 --scorer rust
npm run psro:worker-benchmark -- --workers 4 --candidates 1000 --blocks 1 --mode score-only
npm run psro:worker-benchmark -- --workers 14 --candidates 1000 --blocks 8 --mode score-only
npm run psro:competitive-benchmark
npm run staged-goldfish:native-pool -- --pool-seed 5 --chunk-size 1000 --shard-size 100000 --threads 10
```

The staged product command keeps generation on one ordered TypeScript coordinator. Both scoring stages retain independent bounded shard top sets and merge them deterministically. Goldfish scoring defaults to 10 Rust threads. The K007 threshold-racing controller loads its strategy table into the Rust process once, scores two-player blocks as exact quarter-point bytes, and keeps matrix telemetry in TypeScript. Confidence bounds run in parallel by candidate without changing the bound calculation. Local Rust is the default execution mode. Pass `--execution modal` to submit each screening and confirmation look to the restart-safe Modal adapter; matrix telemetry stays on the local TypeScript runner:

```sh
npm run successive-halving:double-oracle-pilot -- --run --inputs INPUTS.json --out OUTPUT \
  --run-id 1 --workers 4
npm run successive-halving:double-oracle-pilot -- --run --inputs INPUTS.json --out OUTPUT \
  --run-id 1 --workers 4 --execution modal
npm run psro:modal-digest-smoke -- --local
npm run psro:modal-digest-smoke -- --modal --out .experiments/modal-competitive-digest-smoke
```

The digest smoke uses a saved 16-candidate slice of the first run-1 broad eight-block look. `--local` runs no paid work. `--modal` compares the downloaded candidate-major score digest with local Rust. `psro:competitive-benchmark` checks exact parity before reporting local kernel and worker-shape timings. The native workspace pins Rust 1.98.0. The local build targets the current host. The Modal image builds the pinned Linux x86-64 target. Build and verify the local target with:

```sh
npm run goldfish:native-build
npm run goldfish:native-verify
npm run goldfish:native-kingdom-write
npm run goldfish:native-kingdom-check
npm run modal:test
```

`hexdeck-goldfish` uses versioned line-delimited JSON. It rejects a thread count above the CPU request. Get a supported kingdom's rule fingerprint with `npm run goldfish:native-metadata -- --kingdom <kingdom-id>`.

The Modal launcher reserves the worst-case cost for all attempts before launch. It caps total reserved spend at $25, aggregate allocation at 192 physical cores, retries at two, and full-space runs at three. Ordered-run accounting includes the one-core controller. This unattended command launches a detached restart-safe controller. A repeat of the same command resumes the same run without a second reservation:

```sh
modal profile activate ryanburnettebrown
modal run --detach modal/native_strategy_search.py --build-version "$(git rev-parse HEAD)" \
  --kingdom deep-beam-tuning-009 \
  --rule-fingerprint "$(npm run goldfish:native-metadata --silent -- --kingdom deep-beam-tuning-009)" \
  --count 5000 --shard-size 2500 --cpu 4 --memory-gib 4 --threads 4 \
  --max-containers 2 --timeout-seconds 120 --max-cost-usd 1 --scorer rust
```

Shard checkpoints and the ordered merge live in the `hexdeck-native-strategy-results` Modal Volume. The local reservation ledger is `~/.hexdeck-modal-cost-ledger.json`. Ordered shards call the production TypeScript candidate helper in the image and send its versioned request to Rust. Python does not generate strategies.

`nativeCompetitiveModalInput` creates the fixed candidate-table and schedule artifact for one PSRO look. The competitive Modal entry point shards broad looks by candidates and narrow looks by contiguous schedule ranges. It keeps one loaded Rust process per warm container, retries only missing shards, writes digest-checked score-byte artifacts, and assembles exact candidate-major output. The automatic adapter waits for the detached controller, resumes its existing call and valid shards after interruption, and validates `complete.hps` before confidence calculation. The launch rejects more than 48 containers or a cost cap above $2:

```sh
modal run --detach modal/native_strategy_search.py::launch_competitive \
  --input-file competitive-input.json --build-version "$(git rev-parse HEAD)" \
  --cpu 4 --memory-gib 4 --threads 4 --max-containers 16 \
  --timeout-seconds 180 --max-cost-usd 2
```

The deterministic ordered product supports `deep-beam-tuning-001`, `deep-beam-tuning-007`, `deep-beam-tuning-008`, and `deep-beam-tuning-009`. Their original one-use authorizations are `k001-ordered-product-calibration-v2`, `k007-ordered-product-calibration-v2`, `k008-ordered-product-calibration-v2`, and `k009-ordered-product-correction-v1`. These contracts use seeds 4,100,000 through 4,100,003, and existing artifacts with those seeds remain valid. Set one matching kingdom and authorization before launch. This configuration reserves at most $2.88503333 for all retry attempts, uses at most 191 physical cores, and does not launch a local full-space scorer:

```sh
KINGDOM=deep-beam-tuning-009
AUTHORIZATION=k009-ordered-product-correction-v1
modal run --detach modal/native_strategy_search.py --ordered-product \
  --kingdom "$KINGDOM" --authorization "$AUTHORIZATION" \
  --build-version "$(git rev-parse HEAD)" \
  --rule-fingerprint "$(npm run goldfish:native-metadata --silent -- --kingdom "$KINGDOM")" \
  --count 12972960 --retained-count 500000 --reservoir-count 20000 \
  --shard-size 250000 --cpu 2 --memory-gib 4 --threads 2 \
  --max-containers 95 --timeout-seconds 420 --max-cost-usd 5 --scorer rust
```

Kingdom 007 has three independent paid replication contracts. Run each command at most once:

```sh
modal run --detach modal/native_strategy_search.py --ordered-product --kingdom deep-beam-tuning-007 \
  --authorization k007-ordered-product-seed-replication-1-v1 --shuffle-seeds 5100000,5100001,5100002,5100003 \
  --build-version "$(git rev-parse HEAD)" --rule-fingerprint "$(npm run goldfish:native-metadata --silent -- --kingdom deep-beam-tuning-007)" \
  --count 12972960 --retained-count 500000 --reservoir-count 20000 --shard-size 250000 \
  --cpu 2 --memory-gib 4 --threads 2 --max-containers 95 --timeout-seconds 420 --max-cost-usd 5 --scorer rust

modal run --detach modal/native_strategy_search.py --ordered-product --kingdom deep-beam-tuning-007 \
  --authorization k007-ordered-product-seed-replication-2-v1 --shuffle-seeds 6100000,6100001,6100002,6100003 \
  --build-version "$(git rev-parse HEAD)" --rule-fingerprint "$(npm run goldfish:native-metadata --silent -- --kingdom deep-beam-tuning-007)" \
  --count 12972960 --retained-count 500000 --reservoir-count 20000 --shard-size 250000 \
  --cpu 2 --memory-gib 4 --threads 2 --max-containers 95 --timeout-seconds 420 --max-cost-usd 5 --scorer rust

modal run --detach modal/native_strategy_search.py --ordered-product --kingdom deep-beam-tuning-007 \
  --authorization k007-ordered-product-seed-replication-3-v1 --shuffle-seeds 7100000,7100001,7100002,7100003 \
  --build-version "$(git rev-parse HEAD)" --rule-fingerprint "$(npm run goldfish:native-metadata --silent -- --kingdom deep-beam-tuning-007)" \
  --count 12972960 --retained-count 500000 --reservoir-count 20000 --shard-size 250000 \
  --cpu 2 --memory-gib 4 --threads 2 --max-containers 95 --timeout-seconds 420 --max-cost-usd 5 --scorer rust
```

All three reservations total $8.6551, within the existing $25 ledger. After each controller stops, set its printed run ID and matching seed set. Then fetch and validate the ranked artifact and exact ranked-prefix reservoir:

```sh
KINGDOM=<same-kingdom-id-used-for-launch>
SEEDS=<same-comma-separated-seed-set-used-for-launch>
RUN_ID=<run-id-printed-by-launch>
mkdir -p .experiments/ordered-goldfish-product/$RUN_ID
modal volume get hexdeck-native-strategy-results \
  "$RUN_ID" ".experiments/ordered-goldfish-product/$RUN_ID"
npm run goldfish:ordered-product -- validate --kingdom "$KINGDOM" --seeds "$SEEDS" \
  --artifact ".experiments/ordered-goldfish-product/$RUN_ID/ranked.json"
npm run goldfish:ordered-product -- build-reservoir --kingdom "$KINGDOM" --seeds "$SEEDS" \
  --artifact ".experiments/ordered-goldfish-product/$RUN_ID/ranked.json" \
  --out ".experiments/ordered-goldfish-product/$RUN_ID/reservoir.json"
npm run goldfish:ordered-product -- validate-reservoir --kingdom "$KINGDOM" --seeds "$SEEDS" \
  --artifact ".experiments/ordered-goldfish-product/$RUN_ID/ranked.json" \
  --reservoir ".experiments/ordered-goldfish-product/$RUN_ID/reservoir.json"
```

The ranked bytes contain the 500,000-candidate stage-one cohort, all four-seed score evidence, ranks, and shard provenance. Runtime and container data remain in `run-summary.json` on the Modal Volume.

Build or resume protocol v2 calibration for ordered ranks 1–50:

```sh
npm run initial-matrix:calibrate -- \
  --kingdom "$KINGDOM" \
  --ranked ".experiments/ordered-goldfish-product/$RUN_ID/ranked.json" \
  --reservoir ".experiments/ordered-goldfish-product/$RUN_ID/reservoir.json" \
  --out ".experiments/initial-matrix-calibration-v2/$KINGDOM" \
  --max-seeds 125 --chunk-size 5 --prefixes 75,100 --held-out-start 100 --workers 4
```

The maximum is 125 seeds. Prefixes use seed ordinals 1–75 and 1–100. The held-out suffix uses ordinals 101–125. The complete run has 306,250 off-diagonal payoff and telemetry games plus 12,500 diagonal telemetry games, for 318,750 games. Prefix 75 costs 183,750 + 7,500 = 191,250 games. Prefix 100 costs 245,000 + 10,000 = 255,000 games. Held-out ordinals 101–125 cost 61,250 + 2,500 = 63,750 games.

The command validates the current rules, both ordered artifacts and hashes, the exact 20,000-entry reservoir, and every saved v2 cell chunk. It rejects v1, stale, corrupt, incomplete, or unexpected resume evidence. The payoff matrix uses only off-diagonal cells and always has zero diagonals. Each prefix's acquisition metric applies that prefix's selected lottery to the same untouched ordinals 101–125, including diagonal games. This keeps P75 and P100 telemetry sampling fixed. The project damage classifier uses those held-out lottery-versus-itself rates. Feasible archetype ranges hold the resulting labels fixed while equilibrium weights vary over the prefix matrix. They are conditional on the held-out selected-lottery labels and the discovered 50-strategy matrix, and do not cover omitted strategies. Reports separate payoff, diagonal, and total game costs. Their measured chunk wall times are exact sums of saved chunk times, not CPU estimates or complete command times.

Calibrate fixed screening and standard Successive Halving against one of the three approved saved P75 lotteries. Run the command once for each of Kingdoms 001, 007, and 008:

```sh
npm run response-oracle:calibrate -- --run \
  --kingdom "$KINGDOM" \
  --ranked ".experiments/ordered-goldfish-product/$RUN_ID/ranked.json" \
  --reservoir ".experiments/ordered-goldfish-product/$RUN_ID/reservoir.json" \
  --p75-manifest ".experiments/initial-matrix-calibration-v2-125/$KINGDOM/manifest.json" \
  --p75-report ".experiments/initial-matrix-calibration-v2-125/$KINGDOM/report.json" \
  --out ".experiments/response-oracle-calibration/$KINGDOM" --workers 4
```

The command accepts only the audited max-125 reservoir, manifest file, report file, and manifest evidence hashes pinned for Kingdoms 001, 007, and 008. The calibration evaluates exact reservoir ranks 51–20,000 on independent shared-schedule lanes A and B. It saves fixed prefixes at 8, 16, 25, 32, and 50 seeds, replays standard cumulative Successive Halving through 16,384 seeds with top-ups after the shared 50-seed prefix, and saves one independent complete 100-seed all-candidate reference lane. Atomic 250-candidate artifacts reject corrupt resume evidence. The report contains raw cross-fit scores, regrets, ties, top-one and top-four diagnostics, games, and measured simulation time. It does not run PSRO, admit a response, confirm closure, apply a tolerance, or extend reference evidence to 200 or 400 seeds. Use `--status --out PATH` or `--report --out PATH` to inspect saved artifacts.

Extend one validated calibration from 100 to 200 reference seeds without changing the original files:

```sh
npm run response-oracle:extend-reference -- --run \
  --base ".experiments/response-oracle-calibration/$KINGDOM" \
  --out ".experiments/response-oracle-calibration-200/$KINGDOM" \
  --workers 4
```

The extension reuses all saved search and first-100 reference evidence. It builds the full deterministic 200-seed opponent schedule and simulates only its second half, ordinals 101–200. Each kingdom adds exactly 1,995,000 candidate-seed evaluations and 3,990,000 games. The 80 atomic chunks and per-kingdom report go under the separate output root. The report compares folds 1–100 and 101–200 and contains raw metrics, Pareto diagnostics, and exact accounting. It does not rerun search, apply a tolerance, admit a response, test closure, pool kingdoms, or start another extension.

Inspect a partial run or build and validate its report without starting simulations:

```sh
npm run response-oracle:extend-reference -- --status --base ORIGINAL_ROOT --out EXTENSION_ROOT
npm run response-oracle:extend-reference -- --report --base ORIGINAL_ROOT --out EXTENSION_ROOT
```

Run or resume one fixed-reservoir response round from the validated final 20,000-strategy Kingdom 009 prefix, then compare it with all five saved fixed-reservoir lotteries:

```sh
npm run ordered-reservoir:challenge
npm run ordered-reservoir:challenge:status
```

The command accepts only `.experiments/ordered-goldfish-product/native-e760135dba6f-5625a0ff0bf6048653f9` as its ordered source. It runs the ordered-product validation CLI before the first adaptation. It validates the five historical `fixed-reservoir-psro-v1` pools and runs in read-only mode against the current rules fingerprint; it does not rewrite or regenerate them. It does not run goldfish scoring or Modal. Checkpoints, five independent held-out comparisons, and the report go under `.experiments/ordered-reservoir-challenge/ordered-reservoir-challenge-v1/`. A one-round result is not a convergence result; the report labels it incomplete when the round admits strategies.

The robust ordered-only suite runs three evaluation seeds to a clean independent closure, then audits all five historical pools without admitting their strategies:

```sh
npm run ordered-reservoir:robust
npm run ordered-reservoir:robust:status
npm run ordered-reservoir:robust:report
```

Ordinary and closure scans each use two independent cumulative 1/2/4/8 races, a union of at most 16 finalists, and 400 fresh confirmation shuffle seeds. Atomic checkpoints and ignored reports go under `.experiments/ordered-reservoir-robust-psro/ordered-reservoir-robust-v2/`. Historical-attacker diagnostics stream the split ranked artifact, report exact ordered-space membership, and test a deterministic representable analog with fresh evidence.

Measure early-race ranking consistency without changing the fixed lottery:

```sh
npm run ordered-reservoir:race-benchmark
npm run ordered-reservoir:race-benchmark:status
npm run ordered-reservoir:race-benchmark:report
```

The current v3 benchmark uses the same v1-seeded 25-shuffle-seed matrix for ordered ranks 1–50. It evaluates ranks 51–1,000 on three independent schedules shared by all candidates in each trial. Every candidate gets 25 shuffle seeds, or 50 games, with no elimination. Reports compare the saved evidence after 1, 8, and 25 shuffle seeds. Resumable artifacts live under `.experiments/ordered-reservoir-race-benchmark/ordered-reservoir-race-benchmark-v3/`; the completed 5,000-rank v1 artifacts remain unchanged. The benchmark does not admit strategies or rebuild the matrix.

The full Kingdom 009 PSRO protocol runs two independent searches from the fixed ordered 20,000 reservoir:

```sh
npm run ordered-reservoir:full-psro -- --run 1
npm run ordered-reservoir:full-psro -- --run 2
npm run ordered-reservoir:full-psro -- --status
npm run ordered-reservoir:full-psro -- --report
npm run ordered-reservoir:full-psro -- --compare
```

Each full screen gives every inactive candidate two shared 25-shuffle-seed lanes before tied-tier selection. Fresh adaptive confirmation uses full acquisition telemetry and multiple-testing control. Only candidates with identical complete acquisition evidence collapse behind one matrix representative; every confirmed shadow gets a synthetic-ID anchor check and remains in later screens. Matrix evidence adapts from 50 to 100 or 200 shuffle seeds. Final reports use full-telemetry self-play panels, feasible group ranges, five audit-only historical reservoir attacks, and saved direct cross-play seed evaluations. Deep validators recompute schedules, decisions, classes, gates, and resume transitions. Artifacts live under `.experiments/ordered-reservoir-full-psro/ordered-reservoir-full-psro-v3/`. Only run IDs 1 and 2 are valid.

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
