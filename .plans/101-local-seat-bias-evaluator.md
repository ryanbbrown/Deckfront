# Local seat-bias evaluator

## Goal

Add a deterministic local evaluator for first-player health penalties without changing production rules or existing scientific evidence. The evaluator replays the tracked 160-kingdom pretrained catalog through the current Rust competitive simulation kernel. This plan does not authorize the full 160-kingdom evaluation.

## Design

- Extend the existing long-lived native competitive protocol with one deep `score_seat_bias` operation. Load each kingdom and its production purchase plans once. Send all matched strategy pairs for that kingdom in one native batch instead of starting a process per game.
- Keep the production competitive path fixed at the current penalty of 3. Parameterize the shared competitive-game implementation so only the evaluator can request comparison penalties.
- Add a TypeScript seat-bias module and a small operator script. The module owns deterministic schedule generation, equal-kingdom aggregation, uncertainty, and the JSON report. The script owns argument parsing, the one-thread native process, file output, and concise console output.
- For each kingdom, derive a kingdom-local random stream from the configured global seed and kingdom ID. For each matched pair, draw the two players independently from positive stored equilibrium weights and draw one shuffle seed. Reuse that strategy pair and seed for both first-player orientations and for every compared penalty.
- Configure `blocksPerKingdom` and `gamesPerKingdom`. Games are counted per kingdom per penalty. Require an even game count that is divisible by twice the block count. Each native matchup produces two games with opposite first players.
- Default the compared penalties to 2, 3, and 4. Mark penalty 3 as current and report its first-player starting health as 47 from the catalog kingdom base health of 50.
- Keep each kingdom's contribution equal when calculating the aggregate first-player score. Do not pool kingdom scores. Use half-credit for draws and exclude aborts from the score denominator.
- Report explicit first-player wins, second-player wins, draws, aborts, played games, and first-player score. Include block-based Monte Carlo standard error and a clipped normal 95% interval for each kingdom and for the equal-kingdom aggregate. Also report cross-kingdom standard deviation as descriptive heterogeneity.
- Write deterministic JSON with protocol/config/catalog/kernel identity, aggregate metrics by penalty, and per-kingdom diagnostics. Do not add wall-clock timestamps.

## Files

Expected changes:

- `rust/goldfish/src/kernel.rs`
- `rust/goldfish/src/main.rs`
- `src/sim/nativeCompetitiveProtocol.ts`
- `src/sim/rustGoldfishScorer.ts`
- `src/sim/seatBias.ts`
- `scripts/evaluate_seat_bias.ts`
- `test/sim/seatBias.test.ts`
- focused native protocol or Rust tests as needed
- `package.json`

Do not change `src/game/**`, `src/server/pretrained-opponents.json`, `src/sim/balance-suite-manifest.json`, `rust/goldfish/kingdoms.json`, existing report artifacts, or frozen evidence files.

## Acceptance checks

- Orientation accounting identifies the winner by first-player role, not by Ochre or Indigo identity.
- Draws receive half credit. Aborts stay explicit and do not silently become draws or completed games.
- The same configuration produces the same schedule and byte-identical JSON.
- Both players are independent equilibrium-weighted draws.
- Adding unequal-size kingdom fixtures proves that aggregate score is the arithmetic mean of kingdom scores, not a pooled game score.
- Penalties 2, 3, and 4 reach the native kernel. Production competitive scoring still uses penalty 3.
- A tiny local smoke run exercises the tracked catalog and native kernel without launching the full evaluation.

## Validation limits

Use one CPU thread for all work:

```sh
export CARGO_BUILD_JOBS=1 RAYON_NUM_THREADS=1
```

Run focused Rust tests, formatting, Clippy, focused Vitest with `--maxWorkers=1`, typecheck, lint on changed files if practical, the native kingdom check, catalog integrity tests, rule-fingerprint tests, and a tiny one-kingdom smoke. Do not run the full 160-kingdom evaluation.

## Proposed full command

```sh
CARGO_BUILD_JOBS=1 RAYON_NUM_THREADS=1 npm run strategy-search:seat-bias -- \
  --blocks-per-kingdom 20 \
  --games-per-kingdom 1000 \
  --penalties 2,3,4 \
  --seed 20260901 \
  --threads 1 \
  --output .data/seat-bias-160.json
```

This command schedules `160 × 1,000 × 3 = 480,000` games. It contains 500 matched strategy-pair seeds per kingdom, split into 20 blocks, with two opposite-first-player games per pair and the same schedule reused across penalties.
