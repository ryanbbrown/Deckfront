# 11 — Search performance, useful seeds, and bounded pairings

Target: complete a design-maximum kingdom run in under five minutes on this machine. The named
baseline is the `current-duel` full run from 2026-08-18: 1,599,300 matches in 30.2 minutes, or 883.4
matches/s. The target therefore needs at least a 6.04× wall-clock speedup. A separate one-core
microbenchmark measured 1,203 matches/s before the first lookup optimization; do not mix that number
with the full-run baseline.

This plan changes approved behavior in three places, on explicit user direction recorded here:

1. **Per-kingdom seed strategies.** Hand-written per-kingdom seeds are now authorized. The old
   kingdom-agnostic baselines lose important cards during repair, and some repaired seeds cannot deal
   damage.
2. **Turn limit 100 → 30 per player.** A seed-only probe over all five curated kingdoms found 0%
   draws, 0% of games reaching turn 30, and five distinct canonical seeds in every kingdom.
3. **Early stopping.** A pairing still plays at most 100 games. It may stop after a statistically
   significant result, while keeping each four-orientation seed block intact.

The technical work is implemented before the behavior changes so its output can be compared with the
committed baseline. The Rust port remains out of scope; the final report estimates its likely extra
value from the post-optimization profile.

## Group A — faster execution without result changes

The acceptance check for this group is that a `current-duel` smoke run reproduces the committed
report data exactly apart from timing fields. Each optimization also has a focused equivalence test.

### A1 — replace the card-lookup string key

`src/game/kingdom.ts` builds `` `${kingdomId}\0${definitionId}` `` on every resolved-card lookup.
It was 22% of profiled self time.

Use `Map<kingdomId, Map<definitionId, CardDefinition>>`. `resetKingdoms` clears the outer map. The
measured isolated change was 1,203 → 1,551 matches/s, a 29% increase.

### A2 — remove unused action work from the search path

`listLegalActions` eagerly builds presentation labels and spreads each action to attach its id.
Search reads only commands, and then `applyAction` builds the same legal-action list again to resolve
the id it was just given.

- `legal()` accepts a label thunk. `LegalAction.label` is an enumerable getter so HTTP serialization
  and UI consumers still receive the same string.
- `ids()` attaches the id to each new action without spreading it.
- Add an engine-internal fast path that applies a `LegalAction` produced for the current state without
  listing actions again. Search uses it. Public `applyAction(state, id)` keeps its version-stamped,
  id-based safety contract for clients and untrusted agents.

Tests prove that search evaluates no labels, JSON serialization still includes labels, public stale
ids are still rejected, and the fast path produces the same state and events as public `applyAction`.

### A3 — replace memo-key sorting with an exact indexed encoding

`memoKey` currently maps, sorts, and joins four card zones at every visited node.

Build a `definitionId -> integer index` table from the complete `kingdomMarket(kingdomId)`, including
treasures and Cull. Cache it by kingdom id with a `kingdomEpoch()` guard. A missing card id throws.

- Hand and play are multisets encoded as fixed-length count arrays.
- Draw and discard keep ordered index sequences.
- Every field, count, and index uses an explicit delimiter. No digit concatenation is allowed.
- The key remains exact. Do not replace it with a hash.

Tests cover draw-order differences, two-digit adjacency collisions, count adjacency collisions,
Copper and Cull in every zone, cache invalidation after re-registering a kingdom id, and partition
equivalence between the old and new keys over recorded search states.

### A4 — run a declared compiled simulation bundle

Add the lockfile's current `esbuild` version as a direct dev dependency. Add `npm run build:sim` to
bundle `src/sim/cli.ts` for Node ESM at `dist-sim/experiment.mjs`, with no name retention. Verify that
the JSON import attribute bundles correctly. `npm run experiment` first builds the bundle, then runs
it with Node. Add `dist-sim/` to `.gitignore`.

Tests continue to import the TypeScript sources through Vitest.

## Group B — useful seeds and bounded games

### B1 — set the production turn limit to 30 per player

Set `TURN_LIMIT_PER_PLAYER` to 30. Keep `actionCapPerTurn` unchanged. Update the CLI comment,
`.plans/10-automated-balance-search.md`, README, current reporting text, and
`scripts/measure_search.ts` so production runs and performance measurements use 30.

The match runner continues to accept an explicit limit. The clone stress test, match boundary test,
identity fixture, and report-format fixture may keep an explicit 100 because they test the limit
mechanism or long-match scaling, not production defaults. `scripts/write_match_oracle.ts` also keeps
100 for its named long-match case.

### B2 — use five complete strategies for each curated kingdom

Replace `BASELINE_STRATEGIES` with a frozen table keyed by curated kingdom id. Remove the obsolete
kingdom-agnostic `baselineStrategy` API rather than preserving a compatibility layer. Migrate its
tests and callers to `seedStrategies(kingdomId)` or explicit local test fixtures. Rename
`baselineLabels` to `seedLabels`; calibration uses those labels to exclude seeds. Remove
`seedFindings`, `SeedFinding`, and the report's old repair-loss section because complete seeds make
them structurally vacuous. An unknown kingdom id throws. Keep `MIN_CANDIDATES = 5`.

All strategies use these complete-field templates:

| Template | Preferred range | Weights | Treasure | Trash | Reclaim | Discard |
| --- | --- | --- | --- | --- | --- | --- |
| standard | named per seed | existing `DEFAULT_WEIGHTS` | gold → silver | copper | gold → silver | copper → silver |
| mage | Far | `DEFAULT_WEIGHTS`, but preferred-range 0 and unspent-mana -3 | gold → silver | copper | gold → silver | copper → silver |
| money | named per seed | `NO_WEIGHTS`, but damage 10 and money-gained 4 | gold → silver | copper | gold → silver | copper → silver |

The table below specifies `id: build → ordered agenda`; agenda numbers are desired counts. All
unlisted fields come from the named template, so the table is implementable without writer judgment.

| Kingdom | Complete seed definitions |
| --- | --- |
| `current-duel` | `ranged-aim` standard Far: `volley, aim, footwork → volley×3, aim×3, footwork×2`; `melee-drive` standard Close: `drive, drive, footwork → drive×4, feint×2, footwork×2`; `flurry-tempo` standard Close: `flurry, footwork, footwork → flurry×3, feint×2, footwork×2`; `engine-draw` standard Near: `muster, volley → muster×3, volley×3, adapt×2, footwork×2`; `money-volley` money Far: `volley → volley×3, aim×2` |
| `three-way-open` | `melee` standard Close: `heavyBlow, drive, footwork → heavyBlow×3, drive×2, footwork×2`; `ranged` standard Far: `volley, aim, footwork → volley×3, aim×3, footwork×2`; `mage` mage Far: `channel, arcBolt, leyStep, footwork → fireball×2, arcBolt×3, channel×3, leyStep×2`; `money-drive` money Close: `drive → drive×3, footwork×2`; `tempo` standard Far: `stipend, aim, volley → volley×3, aim×2, stipend×2` |
| `three-way-engine` | `melee` standard Close: `heavyBlow, footwork, reclaim → heavyBlow×3, footwork×2, reclaim×2`; `ranged` standard Far: `steadyShot, steadyShot, footwork → steadyShot×4, footwork×2`; `mage` mage Far: `channel, prism, channel → fireball×3, channel×3, prism×2`; `engine` standard Near: `muster, stipend, reclaim → steadyShot×3, muster×3, stipend×2, reclaim×2`; `money` money Far: `steadyShot → steadyShot×3, footwork×2` |
| `range-rich-mixed` | `melee` standard Close: `heavyBlow, drive, footwork → heavyBlow×3, drive×2, footwork×2`; `ranged-volley` standard Far: `volley, aim, footwork → volley×3, aim×3, footwork×2`; `ranged-shot` standard Near: `steadyShot, quickShot, footwork → steadyShot×3, quickShot×3, footwork×2`; `mage` mage Far: `channel, arcBolt, arcBolt, footwork → arcBolt×4, channel×3, footwork×2`; `money-quick` money Near: `quickShot → quickShot×3, footwork×2` |
| `rigged-melee` | Use the same five definitions as `three-way-open`; those kingdoms have the same action piles. Kingdom overrides still resolve normally. |

Create each frozen seed with `identify`, so behavior retains the existing `sg-<hash>` identity and
`seedLabels` maps that hash to the readable table id. Do not call `repairStrategy`: a table entry that
references an unavailable card is an error caught by validation and tests, not content to cut down.
`three-way-open` and `rigged-melee` therefore produce the same seed hashes, while kingdom overrides
still apply when cards resolve in a match.

Acceptance tests prove, without vacuous collection checks, that every curated kingdom has exactly
five distinct canonical seeds, all referenced build and agenda cards are available, every build
costs at most 12, and every seed starts with or buys a damage card. A fixed-seed round robin also
records the already observed 0% draws and 0% turn-limit results at 30 turns.

Migrate every old baseline caller in `test/sim/{strategy,buy,evolution,mutation,identity}.test.ts`,
`test/clone.test.ts`, `scripts/measure_search.ts`, and `scripts/write_match_oracle.ts`. Tests that need
a no-attack or degenerate strategy define it explicitly as a fixture. Regenerate
`test/sim/fixtures/match-oracle.json`. Preserve the plan-10-8 near-limit clone case with a named
test-only no-attack strategy at an explicit 100-turn limit; production seeds must not regain it.

Update calibration and tournament comments. Seeds remain excluded from the final-leader calibration
because the gate measures evolved final leaders, not because seeds lack Heavy Blow.

### B3 — stop statistically settled pairings, at 100 games maximum

At the design maximum, keep 25 shared base seeds and the four orientations, so 100 games remains the
maximum. A seed block is all four orientations. Preserve `matchSeed(baseSeed, orientationIndex)`, so
the four games use deterministic orientation-specific match seeds exactly as they do now. Never stop
inside a block.

Use each base-seed block as the independent observation, because it is the cluster that balances
seat, first player, and arena position even though each orientation derives its own match seed:

1. For a block with completed games, compute the candidate's mean score in `{0, 0.5, 1}`. Aborted
   games are excluded. A block with no completed games is a tie.
2. Classify the block as candidate-positive, opponent-positive, or tied relative to 0.5.
3. The first interim look is immediately after block 5. For a run configured with `N` shared seeds,
   test after blocks 5 through `N - 1`. Runs with `N ≤ 5` have no interim look. Run a two-sided exact
   sign test over positive and negative blocks; tied blocks do not enter `n`.
4. The CLI permits 1–25 shared seeds, so there are at most 20 interim looks. Use the conservative
   fixed threshold 0.0005 at every look. Family-wise error is therefore at most 0.01 for every
   supported `N`, and lower for `N < 25`.
5. Stop after a significant interim result with reason `significant`; otherwise finish all `N`
   blocks with reason `maximum`. This includes all-tie, all-draw, and short smoke pairings.

This rule is deterministic, uses the seed block rather than correlated orientations as its sample,
and controls the repeated-look false-positive rate. A clean sweep can first stop after 12 non-tied
blocks, or 48 games. Record the stop reason and number of seed blocks in the pairing outcome.

Aggregate evolution and tournament scores as the mean of per-opponent pairing means. Change both
`evolution.ts` and `tournament.ts` tallies to store a sum of pairing means plus a completed-pairing
count; do not divide raw scores by raw games. Each opponent pairing therefore has equal weight whether
it stopped at 48 or ran to 100. A pairing with zero completed games has no mean and is excluded from
that denominator, while its aborted games are still reported. A strategy with no completed pairing
keeps score 0 and ranks below any strategy with one, matching current zero-result behavior.
`completedGames` and `abortedGames` remain real counts for reporting. Update `ScoredStrategy` and
report wording from mean-per-game to mean-per-opponent-pairing.

`TournamentResult` also returns actual attempted matches, and all totals, overflow denominators,
throughput, and CLI output use actual counts.

Tests pin `matchSeed` for every orientation; cover `sharedSeeds` values 1, 5, 8, 24, and 25; and cover
block integrity, the block-5 first look, the n=11/n=12 exact sign-test boundary, the 48-game earliest
clean-sweep stop, threshold equality, ties, draws, abort-only blocks, fully aborted pairings, the
100-game cap, equal pairing weight, and actual report counts.

## Group C — deterministic bounded parallelism

Pairings within one generation and within the tournament are independent. Add a `PairingRunner`
boundary and make `evolve`, `roundRobin`, and `runExperiment` async.

- The inline runner is the deterministic test default.
- The worker runner uses `node:worker_threads` and the A4 bundle. The bundle checks `isMainThread` and
  a discriminated `workerData.kind`: the main thread runs the CLI and a pairing worker runs only its
  job handler. `--workers N` accepts 1–16 and defaults to 10. Add workers to parsed options, maxima,
  `run.json`, and the report.
- The runner owns a bounded dispatcher. It starts at most `workers` jobs, and checks the injected
  deadline each time a worker becomes free before it starts another queued job. Queued jobs left
  after expiry are returned as unsubmitted. At most the active worker count can finish after expiry.
- Results are stored and folded in submission order, never completion order.
- On success, all workers close. On one worker error, stop dispatch, terminate the pool, and reject
  with the original error. No worker or pending promise may remain.
- Preserve evolution's current candidate-major, current-leader-minor submission order and the
  tournament's current left-major pair order. Partial generations and tournaments report exactly
  which jobs ran.

Make the complete call chain async: direct callers of `evolve`, `roundRobin`, and `runExperiment`
await them; `main` returns `Promise<number>`; and the entry block awaits `main` before assigning
`process.exitCode`. Promise rejection prints the original error, sets exit code 1, and still closes
the worker pool.

Tests compare inline, one-worker, and two-worker results; force reverse completion order; expire a
deadline mid-batch; inject a worker failure; and verify shutdown. Migrate synchronous evolution,
tournament, experiment, and CLI tests to await the new API. The same deadline-free experiment must
produce identical non-timing JSON under inline and pooled runners.

The pooled clean-checkout integration test must not depend on a pre-existing ignored artifact. Its
setup runs `npm run build:sim`, then invokes the resulting bundle in CLI and worker modes and checks
success and failure exit codes. Unit tests inject the inline runner or a fixture worker URL.

## Documentation and stale evidence

Update README, `.plans/10-automated-balance-search.md`, GOAL/PROGRESS statements that remain current,
report wording, and code comments to describe per-kingdom seeds, 30 turns, equal pairing weighting,
actual match counts, and worker count.

Seven reports will exist at the implementation base: the six currently committed reports plus the
newly committed `current-duel/full` baseline. Remove these exact stale targets before benchmarking:
`current-duel/{smoke,full}`, `range-rich-mixed/smoke`, `rigged-melee/{smoke,full}`,
`three-way-engine/smoke`, and `three-way-open/smoke`. Regenerate and commit current full reports only
for `current-duel`, `three-way-engine`, and `rigged-melee`, the three kingdoms this plan actually
reruns. Do not leave a stale report for an untested kingdom.

## Verification and benchmarks

Every implementation step ends with its focused tests. Final static verification is:

```text
npm run build:sim
npm test
npm run typecheck
npm run lint
npm run build
```

Then run, in order:

1. Group-A equivalence: reproduce the pre-behavior `current-duel` smoke data except timing.
2. Seed gate: all five curated kingdoms show five distinct seeds, 0% draws, and 0% turn-limit games
   in the fixed seed round robin at 30 turns.
3. Full `current-duel` at 100 candidates, 5 leaders, 32 generations, 25 seeds, and 10 workers. Record
   wall clock, actual matches, matches/s, early-stop distribution, and speedup against 30.2 minutes.
4. If correctness checks pass and `current-duel` is faster, run the same design maximum on
   `three-way-engine` and `rigged-melee`. Record the calibration verdict exactly as measured.
5. Profile the optimized `current-duel` run. Use the remaining simulator share and Amdahl's law to
   give a bounded Rust-port estimate. State assumptions and report both likely single-worker kernel
   gain and likely end-to-end gain with ten workers. Do not claim a Rust multiplier from language
   reputation alone.

The final user report gives measured wall-clock speedups for all three runs, the portion due to fewer
games versus faster games and parallelism, residual risks, and the evidence-based Rust estimate.
