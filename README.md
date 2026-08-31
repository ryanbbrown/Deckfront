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

The server saves games in `.data/games` by default. You can set `PORT`, `HOST`, `HEXDECK_DATA_DIR`, or `HEXDECK_STATIC_DIR`. Saved game records, browser game views, and exports use schema version 15. The server rejects older saves and does not migrate them.

## Deploy to Render

The root [`render.yaml`](render.yaml) creates one paid `0.5c-512mb` Docker web service and a 1 GB persistent disk.

1. Push the repository and the branch that you want Render to deploy to your Git provider.
2. In the [Render Dashboard](https://dashboard.render.com/), select **New > Blueprint**.
3. Connect the Git provider, select the Deckfront repository, and select `main`.
4. Review the `deckfront` service and `deckfront-data` disk, then select **Deploy Blueprint**.
5. Wait for the service to become live. Open `https://<your-service-host>/api/health`; a healthy service returns `{"ok":true}`.

Render deploys new commits from the connected branch. To deploy the current branch tip by hand, open the service, select **Manual Deploy > Deploy latest commit**, and wait for the health check to pass. The image reads Render's `PORT`, binds to `0.0.0.0`, serves the Vite client and API from one process, and saves games in `/var/data/games`.

Render's free web service cannot attach a persistent disk. It spins down after 15 inactive minutes and loses local files on spin-down, restart, or redeploy. The paid disk keeps saved games, but a service with a disk cannot use horizontal scaling or zero-downtime deploys.

## Play

1. Refresh until one of the 160 trained 10-card kingdoms looks interesting. Copper, Silver, Gold, Step, and Focus are the five fixed market piles. Scrap is a starter card, not a market pile. Cull is a normal kingdom pile.
2. Choose two local players or the AI opponent. In an AI game, choose whether you or the AI goes first, select Easy, Normal, Hard, or Expert strength, and choose whether to animate AI turns.
3. For a local game, choose whether to use the starting draft. AI games always start without the draft.
4. With the local draft on, Player 1 spends up to 12 money on starting cards, then Player 2 builds. With the draft off, both players start immediately with 7 Copper and 3 Scrap.
5. Play any number of Action cards, end the Action phase to play Treasure cards, buy affordable cards, and end the Buy phase.

Draft-on decks start with 7 Copper. Up to 3 unspent starting money carries into the first Buy phase. Draft-off decks add 3 Scrap, have no carry, and skip the build. Only the first Scrap a player plays each turn deals its 1 damage. Scrap cannot be bought or gained. Starting-build cards do not reduce market piles. Mana remains available until spent. At most 2 mana carries past the end of a turn.

AI games select from the server-only `src/server/pretrained-opponents.json` catalog. The catalog contains 8,650 final-Matrix ordered plans for all 160 balance-suite kingdoms, including 431 positive-weight equilibrium entries. The plans and equilibrium weights were trained with the playable 50 starting health, persistent mana, and carry cap of 2. Selection does not start strategy search or worker processes. Expert uses the saved equilibrium lottery. Easy, Normal, and Hard use the saved score against that lottery. The saved purchase plan controls buys, and the shared tactical agent controls card play and movement.

The arena has spaces 1 through 6. Fighters start on the symmetric middle spaces, Player 1 at 3 and Player 2 at 4. Fighters can share a space and move through each other. Distance 0 is Close, 1 is Near, and 2 or more is Far. Bought cards enter the discard pile and briefly appear above their market piles. Actions resolve at once. Played cards move from the hand to the played area, and the table replays visible AI actions when animation is on. The right rail keeps the public action record visible and shows both full deck compositions without zone counts. Undo can roll back every submitted action to the completed-setup boundary. Each undo of a turn-ending human action also removes the full AI response that it caused. Reload restores the active game and its undo history. New game clears the browser's active-game link.

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
```

Vitest checks the game, AI, server, persistence, balance suites, native conformance, and local operator contracts. Playwright uses the built browser and real local server to check the playable table. The E2E manifest maps required behavior to exact test IDs.

## Balance suites

The deterministic `balance-suite-v4` design has 128 tuning kingdoms and 32 held-back validation kingdoms. The 30-kingdom process-smoke set uses only tuning kingdoms. Regenerate or check the manifests and reports with:

```sh
npm run balance:suite:manifest
npm run balance:suite:manifest -- --check
npm run balance:suite:search-check
npm run balance:smoke:search
npm run balance:smoke:search-check
npm run balance:smoke:manifest -- --check
npm run balance:suite:validate
npm run balance:suite:design-report
npm run balance:suite:design-report -- --check
```

`balance:suite:search-check` compiles and reruns the fixed-seed covering search. It takes about five minutes on an Apple M4 Pro. `balance:smoke:search-check` reruns the YALPS and one-row-exchange selector for the 25-to-30 smoke curve. Normal manifest checks only validate and remeasure the pinned search sources, so they are faster. The design report is `.html/kingdom-suite-design.html`.

## Native strategy search

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

With no subcommand, `hexdeck-goldfish` keeps the versioned JSON line protocol for Rust-versus-TypeScript conformance tests. It rejects a thread count above the CPU request.

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
src/sim/         Game AI, balance suites, native adapters, and report models
scripts/         Balance, native-search, and E2E utilities
test/            Vitest and Playwright behavior tests
.plans/          Current plans and archived decision history
.html/           Kept HTML artifacts
```
