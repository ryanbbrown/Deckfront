# PSRO balance search

## Status

Approved after one plan review-panel cycle. This plan replaces the generation, leader-selection, retained-leader tournament, and fixed-seed initialization in [10-automated-balance-search.md](./10-automated-balance-search.md). The match runner and performance work in [11-search-performance.md](./11-search-performance.md) and the shared tactical pilot in [14-shared-tactical-pilot.md](./14-shared-tactical-pilot.md) remain authoritative.

## Goal

Find the small set of materially different strategies that can compete in one kingdom without hand-written strategy families.

The result must answer:

- which discovered strategies can participate in an equilibrium among the strategies found;
- what canonical weighted lottery the search used for new responses;
- how every discovered strategy performs against every other discovered strategy;
- whether the final searches still found a strategy that performed better than the lottery;
- which strategies came from automatic niche searches; and
- whether independent automatic restarts found compatible results.

This is evidence for card balancing. It does not prove that every possible strategy was found or that a card is fun.

## Sources and terms

- [Policy-Space Response Oracles](https://arxiv.org/html/1711.00832v2#S3) defines the empirical payoff matrix, meta-strategy, and approximate best-response loop.
- [Open-ended learning in symmetric zero-sum games](https://proceedings.mlr.press/v97/balduzzi19a.html) defines rectified-Nash niches for finding strategic directions that a global equilibrium search can miss.
- [Pipeline PSRO](https://proceedings.neurips.cc/paper/2020/hash/e9bcd1b063077573285ae1a41025f5dc-Abstract.html) shows why rectified Nash must not replace the global Nash-response loop.

A **strategy** is one complete starting build and purchase plan. A **mixture** is a weighted lottery over complete strategies. A **response search** generates candidates and tries to find one that performs better than a fixed mixture. A **niche** is an opponent mixture calculated from the payoff matrix; it is not a hand-written label such as melee or ranged.

## Decisions

- Use standard Nash-response PSRO as the equilibrium backbone.
- Use rectified-Nash searches only to discover additional strategies.
- Never require hand-written seeds or strategy families for a kingdom.
- Keep fixed strategies only as named diagnostic benchmarks. They do not initialize the matrix and are not mutation parents.
- Add at most one strategy to a search matrix per outer attempt.
- Remove exact duplicate executable strategies before simulation. Do not reject merely similar strategies before seeing their results.
- Keep the deterministic shared tactical pilot. Search changes only the starting build, finite purchase agenda, and repeated purchase.
- Do not preserve the old generation, leader, or tournament artifact schema or CLI aliases.

## Symmetric payoff matrix

Treat each kingdom as one symmetric constant-sum game:

- both players choose from the same strategy type;
- a win scores `1`, a draw scores `0.5`, and a loss scores `0`;
- every seed block uses the existing four orientations that balance first move, seat, and arena position; and
- each unordered strategy pair is simulated once and mirrored.

For strategy `i` against strategy `j`, store:

```text
A[i,j] = 2 × meanScore(i against j) - 1
A[j,i] = -A[i,j]
A[i,i] = 0
```

Store every four-game seed-block result, not only its mean. This supports top-ups, held-out checks, and uncertainty estimates.

An aborted match invalidates its complete matrix cell or mixture evaluation. Do not omit the abort and score the remaining games. Stop the run with the strategy ids, seed, orientation, and reason. Write `run.json` with `valid: false`, retain only completed iteration events, write the incomplete matrix without final weights, and explain the failure in `report.md`.

### Evaluation protocol and reuse

Use one run-level matrix seed namespace for every restart and the final union. A matrix cache key includes:

- kingdom id and resolved card definitions;
- the two canonical strategy ids;
- the exact matrix seed list;
- turn, action, and state limits; and
- the four-orientation protocol version.

Reuse a cell only when this complete key matches. Restart order must not affect cell bytes.

A new matrix cell uses up to the configured seed count. The existing two-sided exact sign test may stop an obviously settled new cell early. Add an explicit `allowEarlyStop` pairing option. It is `true` only for preliminary matrix cells and `false` for candidate screening, confirmation, diagnostics, and final top-ups.

Before the final union solve, top up every union matrix cell to the full configured seed count. Do not use a support-based top-up rule: support can change after a top-up. The final matrix is complete and full, or there is no final mixture.

## Equilibrium solver

Add and pin `yalps@0.6.4`, a pure-TypeScript linear-programming package. Use a shifted positive-matrix linear program for the row player's maximin distribution. Do not implement a simplex solver in this project.

The first LP finds the matrix value. The matrix is antisymmetric, so reject a result whose absolute value or feasibility residual exceeds a documented numerical tolerance.

An equilibrium is often not unique. A single arbitrary LP vertex would make valid strategies disappear from the headline result. Compute a **maximum-support equilibrium**:

1. Hold the payoff at the solved maximin value within the numerical tolerance.
2. For each strategy id, solve a second LP that maximizes that strategy's possible equilibrium weight.
3. Record this value as `maximumEquilibriumWeight`.
4. For every strategy whose maximum weight exceeds the support tolerance, keep the solver's witness equilibrium.
5. Average all witness equilibria. Averages of equilibria remain equilibria, and this average gives positive weight to every strategy that can appear in at least one equilibrium.

Sort every variable and constraint by canonical strategy id. Pin the dependency and require the same matrix to produce identical weights in repeated calls and separate Node processes. If that test fails, the dependency is not acceptable. Do not rely on installation order or object property order.

The solver returns:

- the canonical maximum-support mixture;
- `maximumEquilibriumWeight` for every strategy;
- the matrix value;
- the maximum known pure-strategy advantage against the canonical mixture; and
- residuals for nonnegative weights, total weight, value, and payoff constraints.

Tests use literal matrices with known results:

- one dominant strategy receives all weight;
- rock-paper-scissors receives one third on each strategy;
- a strictly dominated strategy has zero maximum equilibrium weight;
- payoff-identical rows can both participate without making output nondeterministic;
- a weakly dominated strategy follows the documented LP result rather than an incorrect zero assumption;
- adding a counter can return an old zero-weight strategy to support; and
- permuting matrix input order does not change output by strategy id.

## Automatic strategy generation

Keep the current mutation operators. They cover starting-build membership, finite-agenda membership, order and counts, and the repeated purchase.

Keep `repairStrategy` and canonical identity as the definition of executable equality. Every strategy must be legal for the kingdom, fit the starting budget, omit Copper purchases, have no duplicate or already-satisfied finite entries, and have a legal positive-cost repeated purchase.

Add a deterministic random legal-strategy generator that does not read the fixed baselines. It independently samples:

- a budget-valid starting build from the kingdom market;
- a finite subset, order, and desired counts from legal purchases; and
- a legal repeated purchase.

Bound raw list lengths so zero-cost cards cannot create an unbounded build. Normalize through `repairStrategy` and reject exact canonical duplicates.

The requested candidate split is 70% local mutations and 30% fresh random strategies. Allocate local mutation counts approximately by canonical mixture weight; break equal allocation remainders by canonical strategy id. A niche search mutates only its focal strategy.

If unique local mutations run out, use fresh random strategies for the shortfall. If the complete unique space cannot fill the requested batch, run the shorter non-empty batch and record requested count, actual count, duplicate rejections, and source shortfalls. An empty batch is a failed response attempt, not a multi-hour run error.

Do not add a manual distance rule. Similar plans can have different counters. A payoff-row similarity flag may appear in the report, with its threshold, but it never removes a strategy from the matrix.

## Seed namespaces and mixture schedules

Derive every seed from the run seed plus an explicit stable namespace label, restart index, attempt index, phase, and block index. Namespace labels include at least:

- `matrix`;
- `global-screen` and `global-confirm`;
- `niche-screen` and `niche-confirm`;
- `bootstrap`; and
- `diagnostic`.

Generate every configured seed list before a run starts and reject any collision between training, confirmation, matrix, or diagnostic lists.

For each mixture block, sample one opponent from the target weights using the namespace's seeded random generator. Keep the complete four-game orientation block. All candidates in one screen receive the exact same opponent ids, seeds, and orientations. The confirmation schedule uses a different namespace and can realize different opponent counts.

Record the target weights, realized opponent counts, and unsampled positive-weight strategies. A low-weight strategy can receive zero blocks in one finite Monte Carlo schedule; do not silently call the realized schedule exact. Across separate screen and confirmation namespaces, opponent sampling remains proportional to the target mixture.

## Held-out admission statistics

The existing block sign test is not an admission test. Blocks can face different opponents, and the sign test measures the median direction rather than the mixture mean.

Every screening and confirmation evaluation plays its full schedule. Rank training candidates by their mean block score. Confirm only the best training candidate on unused seeds.

Calculate a deterministic 95% percentile bootstrap interval for the mean by resampling complete blocks with replacement 2,000 times from the dedicated bootstrap namespace. This resamples the opponent draw and the four balanced games as one unit.

A global candidate is admitted only when:

- its held-out mean score is at least `0.52`; and
- the lower 95% bootstrap bound is greater than `0.50`.

A niche candidate and its focal strategy use the same held-out opponents and seeds. Bootstrap their paired per-block score differences. Admit the niche candidate only when:

- its held-out mean improvement over the focal strategy is at least `0.02`; and
- the lower 95% bootstrap bound for the paired improvement is greater than `0`.

Always record the best candidate's held-out mean and interval, even when it fails admission. The **observed oracle gap** is `max(0, heldOutMean - 0.5)` for the best final global candidate. It is observed search evidence, not exact exploitability. At a two-failure stop, report both failed searches and the larger observed gap with its interval and block count.

Smoke mode uses eight blocks. A deterministic dominant candidate can pass because every bootstrap resample remains dominant. Tests must include the earlier failure case: a candidate that wins strongly against 60% of the mixture and loses against 40% has a high mean and must not be rejected only because ten of 25 blocks are negative.

## Global response attempt

One global attempt does this:

1. Solve the current complete search matrix.
2. Generate the 70/30 exact-unique candidate batch.
3. Give every candidate the same full training schedule against the canonical mixture. Candidates do not play each other.
4. Rank candidates by training mean.
5. Confirm only the best candidate on the held-out schedule.
6. If it passes admission, evaluate it against every matrix strategy and add its one row and column.

An admitted strategy uses the run-level matrix protocol, so old matrix cells remain unchanged.

## Rectified-Nash discovery attempt

A failed global response does not immediately end a restart.

For each positive-weight focal strategy, derive a rectified niche from the current matrix: keep the Nash-weighted non-focal strategies that the focal strategy beats or ties, then renormalize. Exclude the focal diagonal. A niche is eligible when it contains at least one non-focal opponent and has not been tried against the current matrix version. Skip an empty or self-only niche.

Try one eligible niche in stable focal-id rotation:

1. Generate 70% local mutations of the focal strategy and 30% fresh random strategies.
2. Screen them on one shared niche schedule.
3. Confirm the best candidate and the focal strategy on one unused shared schedule.
4. Apply the paired held-out admission rule.
5. Evaluate an admitted strategy against the complete matrix and add one row and column, even if its global equilibrium weight becomes zero.

Rectified search never supplies the final mixture or global stop result. Cap niche admissions, not niche attempts. Failed niches are remembered only for the unchanged matrix; any admission changes the matrix and resets niche eligibility.

## Restart state machine

`--iterations` counts outer attempts, whether or not they admit a strategy. One attempt can add at most one strategy.

For each attempt:

1. Run one global response search.
2. If it admits a strategy, add it, reset consecutive global failures to zero, clear tried niches for the new matrix, and begin the next attempt.
3. If it does not admit a strategy, increment consecutive global failures and try the next eligible niche when the niche-admission cap allows it.
4. If the niche admits a strategy, add it, reset consecutive global failures to zero, clear tried niches, and begin the next attempt.
5. If the niche fails or none is eligible, keep its failure recorded and begin the next attempt.
6. Stop a restart when there have been at least two consecutive global failures and every eligible niche for the unchanged matrix has been tried, or when the attempt or deadline limit is reached.

The niche-admission cap is included within the outer-attempt cap. It does not allow extra matrix additions beyond `--iterations`.

## Independent restarts, union, and deadline

A full experiment uses three automatic restarts. Each restart has independent initialization and response namespaces. Fixed baselines do not participate.

| CLI flag | Meaning | Smoke | Full | Maximum |
| --- | --- | ---: | ---: | ---: |
| `--restarts` | independent search restarts | 1 | 3 | 3 |
| `--initial-strategies` | random initial strategies per restart | 5 | 8 | 12 |
| `--candidates` | requested candidates per response search | 20 | 100 | 100 |
| `--iterations` | outer attempts per restart | 4 | 12 | 16 |
| `--niche-additions` | niche-admission cap per restart | 1 | 4 | 4 |
| `--seeds` | four-game blocks per evaluation | 8 | 25 | 25 |
| `--union-iterations` | final global response attempts | 2 | 8 | 8 |
| `--deadline-minutes` | complete run deadline | 30 | 240 | 420 |
| `--state-limit` | action-search states per decision | 20,000 | 20,000 | 20,000 |
| `--workers` | deterministic pairing workers | 10 | 10 | 16 |

The turn limit remains 30 per player and the action cap remains 200 per turn. Remove `MIN_CANDIDATES`, `--leaders`, `--generations`, and their configuration fields. Do not add aliases.

Reserve the last 30% of the deadline for union completion, full-cell top-ups, final global attempts, diagnostics, and artifact rendering. Restarts stop at the 70% search deadline.

After restarts:

1. Union every exact-unique discovered strategy.
2. Fill every missing cross-restart cell with the run-level matrix protocol.
3. Top every union cell to the full seed count.
4. Solve the maximum-support union equilibrium.
5. Run global-only union attempts. An admission adds one row and column, tops the new cells fully, and re-solves.
6. Stop after two consecutive held-out global failures, `--union-iterations`, or the final deadline.

If the deadline interrupts a cell, top-up, or union fill, write the partial matrix with `complete: false` and no final weights. `report.md` may show complete restart mixtures as provisional diagnostics, but it must say that no final union result exists.

Restart agreement is reported before the union changes them:

- zero-extend each restart's canonical mixture over the union ids and report total-variation distance between restart pairs;
- report overlap between strategies with positive `maximumEquilibriumWeight`; and
- evaluate each restart mixture against every union strategy and report its worst known counter.

These are comparisons, not admission or stop rules.

## Match-count bound

Let:

- `R` be restarts;
- `I` be initial strategies per restart;
- `T` be attempts per restart;
- `C` be response candidates;
- `S` be seed blocks;
- `U` be union attempts; and
- `N = R × (I + T) + U`, the largest possible exact-unique union.

A conservative game bound, before diagnostic challengers, is:

```text
matrix games   = 4S × N(N - 1) / 2
restart games  = 4S × R × T × 2(C + 1)
union games    = 4S × U × (C + 1)
total bound    = matrix games + restart games + union games
```

The factor `2(C + 1)` assumes every restart attempt runs both a global and niche screen plus one confirmation for each. Full defaults give `N ≤ 68` and at most `1,035,800` games before diagnostics. Maximum settings give `N ≤ 92` and at most `1,469,000` games. Early-stopped preliminary cells can lower the actual count; final full-cell top-ups cannot exceed the matrix term.

## Calibration and reporting

For `rigged-melee`, report both diagnostics on a separate held-out namespace:

- whether at least one positive-weight discovered strategy actually acquires Heavy Blow; and
- the fixed melee benchmark's mean, 95% bootstrap interval, and observed advantage against the final mixture.

Do not claim that a nonsignificant benchmark is harmless. Report its interval. A failure is a calibration result, not a reason to change the kingdom or insert the benchmark into the matrix.

For every kingdom, report:

- canonical mixture weights and maximum possible equilibrium weight per strategy;
- the complete row-versus-column score table;
- deterministic block-bootstrap weight distributions as uncertainty diagnostics, without changing the search;
- the final observed oracle gap and interval;
- niche discoveries, focal strategies, and final weights;
- requested and actual candidate source counts and duplicate rejections;
- acquisition and damage telemetry by strategy;
- first-player, seat, draw, turn-limit, and abort rates; and
- the restart-agreement measurements.

Do not call two strategies equivalent from their card lists. A close-payoff-row flag must show its threshold and keep both rows.

## Modules and artifacts

Keep simulation code under `src/sim/`:

- `payoffMatrix.ts`: canonical entrants, protocol-keyed cells, block results, completeness, and top-ups;
- `equilibrium.ts`: LP construction, maximum-support mixture, and residual checks;
- `randomStrategy.ts`: automatic legal strategies;
- `mixtureEvaluation.ts`: opponent schedules, complete candidate evaluations, bootstrap intervals, and telemetry;
- `responseOracle.ts`: 70/30 batches, screening, held-out admission, and niche objectives;
- `psro.ts`: restart state machine, union consolidation, stopping, and progress events;
- `experiment.ts`: deadline split, runner lifecycle, artifact writes, diagnostics, and report orchestration.

Reuse the bounded worker pool and match simulation. Optimization and search policy do not belong in the CLI or report renderer.

Replace old evolution artifacts with:

- `run.json`: schema version, resolved kingdom, exact limits, all seed namespaces, stop state, and validity;
- `iterations.jsonl`: mixture before search, objective, candidate sources, schedules, confirmation, admission, matrix size, observed gap, matches, and elapsed time;
- `matrix.json`: protocol, canonical strategies, complete block cells, centered payoffs, maximum-support result, and solver residuals;
- `strategies.json`: every matrix strategy and discovery source;
- `telemetry.json`: matrix, screening, confirmation, and diagnostic aggregates;
- `report.md`: the human-readable result.

Remove `generations.jsonl`, `tournament.json`, retained-leader tournaments, and stale generation and leader language.

The committed `.html/balance-baseline.html` remains historical evidence. Add a visible “Pre-PSRO evolutionary baseline” banner and explain it in `README.md`. Archive plan 16 with a banner that names this plan. Remove the obsolete `scripts/write_balance_dashboard.ts`, `test/sim/balanceDashboard.test.ts`, and `test/sim/fixtures/balance-dashboard.ts`; a later full-run plan will build a new dashboard from `matrix.json`.

Update or remove all old-schema fixtures and callers, including `test/sim/bundle.test.ts`, experiment/report tests, CLI tests, and README commands.

## Tests

Tests enter through public solver, matrix, search, artifact, or compiled-CLI seams. Expected values are literal matrices, strategies, schedules, or simulator results—not a second implementation.

Required regressions:

- known dominant, cyclic, degenerate, strictly dominated, and weakly dominated matrix results;
- identical solver bytes across calls, processes, and matrix input orders;
- each unordered pair runs once and mirrors exactly;
- matrix cells use one run-level namespace independent of restart order;
- an abort invalidates an evaluation and emits no final mixture;
- preliminary matrix early stopping remains two-sided and is disabled for screens, confirmations, and final top-ups;
- every candidate receives the same complete screen schedule even when it wins the first blocks;
- a response batch plays one configured total budget against the mixture, not that budget against every opponent;
- training, confirmation, matrix, bootstrap, and diagnostic seeds are disjoint;
- a weighted-mean best response with split positive and negative blocks is admitted when its held-out interval passes;
- a noisy training winner that fails held-out confirmation is not added;
- smoke mode can admit a deterministic dominant candidate;
- adding `D` evaluates only `D`'s row and column and reuses old cells;
- final top-up fills every cell before the solver runs;
- a counter can restore an old zero-weight strategy;
- a rectified niche excludes the focal diagonal, contains only non-focal Nash-weighted strategies the focal beats or ties, and skips empty niches;
- a niche discovery can enter with zero global weight without deciding the final stop;
- niche admission resets global failures, while failed niches remain tried for the unchanged matrix;
- a short unique batch records its shortfall instead of throwing;
- automatic initialization works in a synthetic registered kingdom with no baseline entry;
- generated and mutated strategies are legal, Copper-free, deterministic, and exact-unique;
- candidate source targets use the 70/30 split and stable-id tie rule;
- independent restart union fills missing cross cells before solving;
- a restart-deadline fixture preserves the reserved union phase;
- a partial union never emits final weights;
- a two-failure stop still reports both held-out means, intervals, and observed gap;
- rigged-melee diagnostics use the final mixture and held-out benchmark schedule;
- output has no generation leaders, retained tournament, preferred range, tactical weights, or Copper purchases; and
- a repository sweep finds no live reader of `generations.jsonl`, `tournament.json`, `--leaders`, or `--generations`.

## Implementation order

1. Verify and pin `yalps`, then add the equilibrium boundary and literal matrix tests.
2. Add protocol-keyed block cells, mirrored storage, abort validity, early-stop control, and full top-ups.
3. Add seed namespaces, automatic random strategies, and 70/30 exact-unique batching with shortfall records.
4. Add mixture schedules, complete screening, held-out bootstrap admission, and observed-gap records.
5. Add one global PSRO restart and its state-machine tests.
6. Add rectified niche discovery without letting it control equilibrium or stopping.
7. Add independent restarts, union completion, full top-up, agreement measures, and final global attempts.
8. Replace experiment configuration, CLI, artifacts, report, calibration, and stale evolution paths.
9. Archive plan 16, label the historical HTML, remove the obsolete dashboard generator, and update `README.md`.
10. Run all validation and two compiled smoke experiments.

## Validation

Run:

```sh
npm run build:sim
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Run the bundled CLI in temporary output roots for `current-duel` and `rigged-melee` smoke modes. Confirm:

- every configured restart, union solve, and final response step finishes or records its explicit limit;
- every solved final matrix is complete and has full cells;
- no match aborts;
- all payoffs mirror within numerical tolerance;
- mixtures are nonnegative, sum to one, include every strategy with positive maximum equilibrium weight, and pass residual checks;
- candidates use one configured total mixture budget and complete schedules;
- confirmation uses unused seeds;
- artifacts regenerate byte-identically when time is injected;
- strategies contain only shared-pilot fields and never buy Copper;
- the report distinguishes equilibrium support, niche discoveries, diagnostics, and observed oracle gap; and
- actual games do not exceed the mechanical bound.

Measure games per second and total games for both smoke runs. Do not run five full kingdom searches in this implementation.

## Review

The required single plan review-panel cycle completed and this revision incorporates its verified findings.

After implementation and validation, run exactly one implementation review-panel cycle against the clean pre-implementation SHA. Verify every finding, send required fixes to the same writer, and rerun affected validation. Do not run a second panel cycle.
