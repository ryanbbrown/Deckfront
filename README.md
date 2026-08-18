# Hexdeck

Hexdeck is a Dominion-style deck builder with a five-space fighting arena. Play against a ThinHarness AI or play a two-player local game on one laptop. Each player creates a starting build, then uses complete turns to move through shared spaces, control range, combine cards, buy improvements, and reduce the opponent from 20 health to 0.

## Run

Use Node.js 22 or later, Python 3.11 or later, `uv`, `cproxy`, and a Codex login.

```sh
npm install
uv sync
uv tool install git+ssh://git@github.com/ryanbbrown/cproxy.git
codex login status
npm run dev
```

Open `http://localhost:4173`. Set `HEXDECK_AI_FAKE=1` before `npm run dev` to use the deterministic local AI instead of the model bridge.

Optional settings:

```sh
export HEXDECK_AI_MODEL='openai:gpt-5.6-luna'
export HEXDECK_AI_EFFORT='low'
export HEXDECK_AI_TIMEOUT_MS='240000'
export PORT='4173'
export HOST='127.0.0.1'
export HEXDECK_DATA_DIR='.data/games'
export HEXDECK_AI_TRACE_DIR='.data/ai-traces'
```

Saved games use schema version 8. Older saves are rejected and are not migrated.

## Play

1. Select an AI or local opponent. For AI games, select and edit the strategy prompt.
2. Select the first player.
3. Spend up to 12 money on any starting cards. In a local game, Player 1 builds before Player 2. Unspent money carries into each player's first Buy phase.
4. Play any number of Action cards during your complete turn.
5. End the Action phase to play all Treasure cards.
6. Buy any number of affordable cards, then end the Buy phase.

The arena has five spaces. Fighters can share a space and move through each other. A difference of 0 is Close, 1 is Near, and 2 or more is Far. Player 1 starts on space 2 and Player 2 starts on space 3. Bought cards enter the discard pile. Actions resolve immediately. Duplicate hand cards share one quantity-marked card, while played cards remain visible in order until cleanup. Completed AI turns have an expandable recap. One global Undo control restores the latest player action, and refresh restores the active game.

## Verify

```sh
npm test
npm run test:e2e:manifest
npm run test:e2e
npm run test:ai:live
npm run typecheck
npm run lint
npm run build
```

The backend suite covers setup, privacy, arena rules, every card, complete turns, purchases, replay, persistence, AI sequencing, and the balance simulator. Playwright drives every card and required selection through the production browser and real local server. `npm run test:ai:live` sets `HEXDECK_LIVE_AI=1` for the live Vitest case and uses `playwright.live.config.ts`, which sets `HEXDECK_E2E_LIVE=1` for the real-browser bridge case. Both use `HEXDECK_AI_MODEL` and `HEXDECK_AI_EFFORT` when set.

## Balance simulator

`src/sim/` plays headless matches to tune card values. It imports from `src/game/` only, which an ESLint rule enforces. `runMatch` plays one deterministic match between two agents. A strategy is plain data — a starting build, an ordered buy agenda, a preferred range, and scoring weights — and `strategyAgent` turns it into a player that searches the whole Action-phase tree for its best line.

Measure throughput before changing anything that runs inside a match:

```sh
npx tsx scripts/measure_search.ts
npx tsx scripts/measure_search.ts --kingdom rigged-melee --seeds 3 --repeats 5
node --cpu-prof --cpu-prof-dir .experiments/profiles --import tsx scripts/measure_search.ts --kingdom rigged-melee --seeds 3
```

It plays every baseline pairing in the kingdoms and seeds it is given and prints matches per second, wall clock per decision and per match, states visited, and stop reasons. Use the options to bound the workload for a profile, so a before-and-after pair comes from one measurement path.

`cloneGame` copies the mutable zones and shares the card and event objects, which nothing edits in place, because a deep clone of the whole event log on every action made one game quadratic in its action count. `test/clone.test.ts` holds the aliasing checks that make the sharing safe, and `test/sim/identity.test.ts` replays seven fixed matches against `test/sim/fixtures/match-oracle.json` so a faster engine cannot quietly change a result.

`evolve` runs the search: each generation plays every candidate against every leader over a fixed set of shared seeds, four games per pairing per seed, then keeps the best few as the next leaders and mutates them into the next population. `roundRobin` plays the final tournament between the last leaders, one retained leader per generation, and the fixed baselines, and reports the complete pairwise table. A strategy's id is a hash of its behaviour, so duplicates collapse on their own.

Generation 1 starts from the five fixed baselines, repaired into the kingdom. A kingdom that sells few of a baseline's cards cuts that baseline down, so generation-1 scores there say less. `seedFindings(kingdomId)` reports what each seed lost, so a run states it instead of leaving the reader to assume a fair first contest.

Run one experiment with `npm run experiment -- --kingdom <id> --mode smoke|full`. `--seed`,
`--candidates`, `--leaders`, `--generations`, `--seeds`, `--deadline-minutes`, and `--state-limit` may
lower a limit; none may raise one above the approved maximum. Output goes to
`.experiments/<kingdom-id>/<mode>/`: `run.json`, `generations.jsonl`, `tournament.json`,
`strategies.json`, `telemetry.json`, and `report.md`. Only `report.md` is committed. Partial output
survives a deadline, and a run that hits a blocker still writes its report.

The five curated experiment kingdoms are `current-duel`, `three-way-open`, `three-way-engine`, `range-rich-mixed`, and `rigged-melee`. `rigged-melee` is a calibration fixture: it re-prices Heavy Blow to 3 for 6 damage, and `src/sim/calibration.ts` checks that the search finds it. Its threshold, kingdom, and strategies must never be tuned to make it pass.

Card definitions live in `src/game-data/cards.json` and kingdoms in `src/game-data/kingdoms.json`. Strategy prompts live in `strategies/`. Saved AI traces live under `.data/ai-traces`.
