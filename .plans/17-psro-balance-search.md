# PSRO balance search

## Status

Proposed. This plan replaces the generation, leader-selection, retained-leader tournament, and fixed-seed initialization in [10-automated-balance-search.md](./10-automated-balance-search.md). The shared tactical pilot in [14-shared-tactical-pilot.md](./14-shared-tactical-pilot.md) remains authoritative.

## Goal

Find the small set of materially different strategies that can compete in one kingdom without requiring hand-written strategy families.

The final result must answer:

- which discovered strategies have positive weight in the least-exploitable known mixture;
- how every discovered strategy performs against every other discovered strategy;
- whether a new search can still find a strategy that beats the mixture;
- which additional strategies came from automatic niche searches; and
- whether independent restarts agree on the competitive set.

This is evidence for card balancing. It does not prove that every possible strategy was found or that a card is fun.

## Sources and terms

- [Policy-Space Response Oracles](https://arxiv.org/html/1711.00832v2#S3) defines the empirical payoff matrix, meta-strategy, and approximate best-response loop.
- [Open-ended learning in symmetric zero-sum games](https://proceedings.mlr.press/v97/balduzzi19a.html) defines rectified-Nash niches for finding useful strategic directions that a global equilibrium search can miss.
- [Pipeline PSRO](https://proceedings.neurips.cc/paper/2020/hash/e9bcd1b063077573285ae1a41025f5dc-Abstract.html) shows that rectified Nash must not replace the convergent global Nash-response loop.

A **strategy** is one complete starting build and purchase plan. A **mixture** is a weighted lottery over complete strategies. A **response search** generates candidate strategies and tries to find one that beats a fixed mixture. A **niche** is an opponent mixture calculated from the payoff matrix; it is not a hand-written label such as melee or ranged.

## Decisions

- Use standard Nash-response PSRO as the equilibrium backbone.
- Use rectified-Nash searches only to discover additional strategies.
- Never require hand-written seeds or strategy families for a kingdom.
- Keep the existing fixed strategies only as named diagnostic benchmarks. They do not initialize the matrix and are not mutation parents.
- Add at most one strategy to a search matrix per outer iteration.
- Remove exact duplicate executable strategies before simulation. Do not reject merely similar strategies before seeing their results.
- Keep the existing deterministic shared tactical pilot. Search still changes only the starting build, finite purchase agenda, and repeated purchase.
- Do not preserve the old generation, leader, or tournament artifact schema.

## Symmetric payoff matrix

Hexdeck is treated as one symmetric constant-sum game per kingdom:

- both players choose from the same strategy type;
- a win scores `1`, a draw scores `0.5`, and a loss scores `0`;
- every seed block uses the existing four orientations that balance first move, seat, and arena position; and
- each unordered strategy pair is simulated once and mirrored.

For strategy `i` against strategy `j`, store the centered payoff:

```text
A[i,j] = 2 × meanScore(i against j) - 1
A[j,i] = -A[i,j]
A[i,i] = 0
```

The matrix stores every four-game seed-block result, not only its final mean. This supports independent checks, later top-ups, and uncertainty estimates.

An aborted match invalidates its matrix cell or mixture evaluation. Do not omit the aborted match and score the remaining games. Stop the run with the strategy ids, seed, orientation, and abort reason so a strategy-dependent overflow cannot bias the matrix.

### Matrix evaluation budget

- A matrix cell uses at most 25 shared seed blocks: 100 games.
- Keep the existing exact sign-test early stop for an obviously settled new cell.
- Before the final solve, top every cell that can affect a positive-weight strategy to the full configured seed count. The final mixture must not depend on an optionally stopped support cell.
- Reuse a completed cell whenever the same canonical strategy pair appears in another restart or the final union.

## Equilibrium solver

Add the small, pure-TypeScript `yalps` linear-programming package. Use a shifted positive-matrix linear program to solve the row player's maximin distribution. Do not implement a new simplex solver in this project.

The solver boundary returns:

- one weight per canonical strategy id;
- the matrix game value;
- the maximum advantage of any known pure strategy against the mixture; and
- numerical residuals for nonnegative weights, total weight, and all payoff constraints.

The matrix is antisymmetric, so its theoretical value is zero. Reject a solution whose numerical residual or absolute value exceeds a documented tolerance. Sort variables by canonical strategy id and apply a deterministic secondary tie rule so identical input bytes produce identical mixture bytes.

Tests use literal games with known answers:

- one dominant strategy receives all weight;
- rock-paper-scissors receives one third on each strategy;
- a dominated strategy receives zero;
- adding a new counter can return an old zero-weight strategy to support; and
- permuting matrix input order does not change weights by strategy id.

## Automatic strategy generation

Keep the current mutation operators. They already cover:

- adding, removing, and replacing starting-build cards;
- adding, removing, reordering, and changing counts in the finite agenda; and
- changing the repeated purchase.

Keep repair and canonical identity as the one definition of executable equality. A generated strategy must be legal for the kingdom, fit the starting budget, omit Copper purchases, have no duplicate or already-satisfied finite entries, and have a legal positive-cost repeated purchase.

Add a deterministic random legal-strategy generator that does not start from a fixed seed strategy. It independently samples:

- a budget-valid starting build from the kingdom market;
- a finite subset, order, and desired counts from legal purchases; and
- a legal repeated purchase.

Bound raw list lengths so zero-cost cards cannot create an unbounded build. Normalize every result through `repairStrategy`, reject exact canonical duplicates, and fail clearly if the bounded attempt count cannot fill a batch.

Each response batch contains 100 candidates in full mode:

- 70 unique local mutations; and
- 30 unique fresh random strategies.

Distribute local mutations over the positive-weight strategies in stable id order and approximately in proportion to their mixture weights. A niche search mutates its focal strategy. Smoke mode uses the same 70/30 ratio with a smaller batch. Candidate generation records the source, parent, mutation operators, and number of rejected exact duplicates.

Do not add a manual distance rule. Similar-looking plans can have different counters. The final report may compare payoff rows, but a similarity label never removes a strategy from the matrix.

## Global response search

One outer iteration does this:

1. Solve the current matrix mixture.
2. Create one deterministic opponent schedule from that mixture. A schedule contains complete four-game seed blocks and uses largest-remainder allocation, so a full 25-block schedule for `50% A / 30% C / 20% F` contains approximately `13 A / 7 C / 5 F` blocks.
3. Give every candidate the same opponent ids, training seeds, orientations, and total game budget. Candidates do not play each other.
4. Rank candidates by mean score over all completed blocks. Exact canonical duplicates of matrix strategies or earlier candidates never consume games.
5. Confirm only the best candidate against the same mixture on an unused seed namespace and a newly generated schedule.
6. Admit the candidate only when the held-out mean is at least `0.52` and a one-sided exact sign test over seed-block scores rejects `score ≤ 0.5` at `p ≤ 0.01`.
7. Evaluate an admitted strategy against every strategy already in the matrix, add one row and column, then solve again.

The held-out test happens after selecting the best training result. This prevents the best of 100 noisy training estimates from entering by selection luck. Confirmation always uses the full configured block count; it does not stop early.

Call the best confirmed advantage the **observed oracle gap**. Do not call it exact exploitability because the response oracle is an incomplete search over a large strategy space.

## Rectified-Nash discovery searches

A failed global response search does not immediately end a restart.

For each positive-weight focal strategy, derive its niche from the current matrix exactly as Balduzzi et al. describe: keep the Nash-weighted strategies that the focal strategy beats or ties, then renormalize those weights. This derives niches from matchups and creates no card-family labels.

Try one eligible niche at a time in stable rotation:

1. Generate the batch as 70% mutations of the focal strategy and 30% fresh random strategies.
2. Screen every candidate against the same niche schedule.
3. On unused seeds, compare the best candidate with the focal strategy on the same opponent schedule.
4. Admit the candidate only when its mean improvement is at least `0.02` and a one-sided paired sign test over block-score differences has `p ≤ 0.01`.
5. Evaluate the candidate against the complete matrix and add one row and column even if its global Nash weight becomes zero.

After a niche admission, return to the global Nash-response step. Rectified search never determines the final mixture or the global stop result. Cap niche admissions per restart so local niches cannot grow the matrix without bound.

## Restarts, union, and stopping

A full experiment uses three independent automatic restarts. Each restart has its own random initial strategies and response-search seed namespaces. It does not use the five fixed strategies.

Initial defaults:

| Setting | Smoke | Full | Maximum |
| --- | ---: | ---: | ---: |
| Restarts | 1 | 3 | 5 |
| Random initial strategies per restart | 5 | 8 | 20 |
| Response candidates per search | 20 | 100 | 100 |
| Added strategies per restart | 4 | 12 | 32 |
| Niche admissions per restart | 1 | 4 | 8 |
| Shared seed blocks per evaluation | 5 | 25 | 25 |
| Final union additions | 2 | 8 | 16 |

The CLI replaces `--leaders` and `--generations` with explicit `--initial-strategies`, `--iterations`, `--restarts`, and `--niche-additions`. `--candidates` and `--seeds` keep their direct meanings. Update help, validation, reports, and tests together; do not add compatibility aliases.

After all restarts:

1. Union every exact-unique discovered strategy.
2. Fill every missing union matrix cell with the standard matrix protocol.
3. Solve one union mixture.
4. Run global response searches against the union mixture, adding at most the configured final-union additions.
5. Stop when two consecutive held-out global searches with fresh candidates find no admissible response, or when the iteration or deadline limit is reached.

A deadline stops between complete evaluations. Preserve complete cells and iterations, but never solve or report a final mixture from a partial matrix.

The final result is credible when independent restarts stop finding new counters and the union search has a small observed oracle gap. It is not proof that no undiscovered strategy exists.

## Calibration and diagnostics

Fixed strategies remain optional diagnostic challengers, not search seeds.

For `rigged-melee`, report both checks:

- at least one positive-weight discovered strategy actually acquires Heavy Blow; and
- the existing fixed melee benchmark does not significantly beat the final mixture on held-out seeds.

A failure is a search-calibration result, not a reason to change the kingdom or threshold. Do not silently insert the benchmark into the matrix after a failure.

For every kingdom, report:

- final mixture weights and the source restart for each strategy;
- the complete row-versus-column score table;
- point weights across deterministic seed-block bootstrap resamples, without using them to alter the search;
- observed global oracle gap and its held-out block counts;
- niche discoveries, their focal strategies, and their final mixture weights;
- exact duplicates rejected during generation;
- acquisition and damage telemetry by strategy;
- first-player, seat, draw, turn-limit, and abort rates; and
- agreement between restart mixtures after solving their final matrices against the union strategy set.

Do not call two strategies equivalent from their card lists. The report can flag close payoff rows for inspection, but it must show the threshold and keep both rows.

## Modules and artifacts

Keep simulation code under `src/sim/`. Use these boundaries; exact filenames may change only when the resulting module remains as narrow:

- `payoffMatrix.ts`: canonical entrants, mirrored cells, block results, completeness, and top-ups;
- `equilibrium.ts`: linear-program construction, deterministic mixture, and residual checks;
- `randomStrategy.ts`: automatic legal strategies;
- `mixtureEvaluation.ts`: block allocation and candidate-versus-mixture evaluation;
- `responseOracle.ts`: 70/30 batches, screening, held-out admission, and niche objectives;
- `psro.ts`: one restart, union consolidation, stopping, and progress events;
- `experiment.ts`: deadline, runner lifecycle, artifact writes, telemetry, and report orchestration.

Reuse the existing bounded worker pool and pairing simulation. Do not put optimization or search rules in the CLI or report renderer.

Replace the old evolution artifacts with:

- `run.json`: schema version, resolved kingdom, exact limits, seed namespaces, stop state, and validity;
- `iterations.jsonl`: mixture before search, objective, candidate sources, confirmation result, admission, matrix size, observed oracle gap, matches, and elapsed time;
- `matrix.json`: canonical strategy ids, complete block-level cells, centered payoffs, final weights, and solver residuals;
- `strategies.json`: every matrix strategy and its generation source;
- `telemetry.json`: search, matrix, confirmation, and diagnostic aggregates; and
- `report.md`: the human-readable result described above.

Remove the final retained-leader tournament. The complete union matrix is the tournament. Remove stale generation and leader language from code, tests, CLI output, reports, and `README.md`.

Keep `.html/balance-baseline.html` as a labeled historical pre-PSRO artifact. Do not regenerate five full kingdoms in this implementation. Remove or update any generator that claims the old artifact schema is current; a later full-run plan can build the PSRO dashboard from `matrix.json`.

## Tests

Tests must enter through public search, matrix, solver, artifact, or compiled-CLI seams. Expected values must be literal game matrices, literal strategies, or observable simulator results—not a second implementation of the algorithm.

Required regressions:

- the solver returns the known dominant and rock-paper-scissors mixtures;
- matrix order, worker completion order, and restart order do not change final bytes;
- each unordered pair runs once and produces an exactly mirrored centered payoff;
- an abort invalidates an evaluation instead of disappearing from its denominator;
- a candidate batch plays the configured total games against a mixture, not that many games against every opponent;
- all candidates in one screen receive the same block schedule;
- training seeds and confirmation seeds are disjoint;
- the best noisy training candidate is rejected when it fails held-out confirmation;
- admitting `D` adds only `D`'s row and column and reuses every old cell;
- a counter can restore an old zero-weight strategy to the mixture;
- rectified niches contain only Nash-weighted strategies the focal strategy beats or ties;
- a niche discovery can enter the matrix with zero global weight without changing the global stop test;
- random initialization works for a kingdom with no fixed baselines;
- generated and mutated strategies are legal, Copper-free, deterministic, and exact-unique;
- candidate source counts follow the configured 70/30 split;
- independent restart union fills missing cross-restart cells before solving;
- a partial matrix never produces a final mixture;
- output artifacts contain no generation leaders, retained tournament, preferred range, tactical weights, or Copper purchases; and
- rigged-melee calibration reads the final mixture and held-out benchmark result.

## Implementation order

1. Add the equilibrium solver boundary and literal matrix tests.
2. Add block-level payoff cells, mirrored storage, validity rules, and top-ups.
3. Add automatic random strategies and refactor mutation batching around exact uniqueness.
4. Add mixture schedules, screening, held-out admission, and observed oracle-gap reporting.
5. Add one global PSRO restart and its deterministic progress events.
6. Add rectified niche discovery without letting it control the equilibrium solver or stop rule.
7. Add independent restarts, union-matrix completion, and final global consolidation.
8. Replace experiment configuration, CLI, artifacts, reports, calibration, and stale evolution paths.
9. Update `README.md` and label the committed dashboard as the pre-PSRO baseline.
10. Run project validation and compiled smoke experiments.

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

- every configured restart, union solve, and final consolidation step finishes or records its explicit limit;
- every solved matrix is complete;
- no match aborts;
- all matrix payoffs mirror within numerical tolerance;
- every mixture is nonnegative, sums to one, and passes solver residual checks;
- candidates use the configured total mixture budget;
- confirmation uses unused seeds;
- artifacts regenerate byte-identically from the same seed when time fields are injected;
- strategies contain only the shared-pilot fields and never buy Copper; and
- the report distinguishes equilibrium support, niche discoveries, diagnostic baselines, and observed oracle gap.

Measure matches per second and total matches for both smoke runs. Compare the actual match count with the configured upper bound. Do not run five full kingdom searches as part of this implementation.

## Review

Before implementation, run exactly one plan review-panel cycle and revise this plan from verified findings.

After implementation and validation, run exactly one implementation review-panel cycle against the clean pre-implementation SHA. Verify every finding, send required fixes to the same writer, and rerun the affected validation. Do not run a second panel cycle.
