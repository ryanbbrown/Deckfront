# Ordered-reservoir full Kingdom 009 PSRO

## Goal

Produce one representative Kingdom 009 lottery from the fixed ordered 20,000-strategy reservoir. Judge representation by actual acquisitions, card shares, damage-family shares, classifier labels, feasible equilibrium group ranges, closure evidence, and direct lottery cross-play. Exact strategy IDs are diagnostic only.

Implement the protocol, then run exactly two independent seed suites. Compare and report those two runs before any decision about a third run. The command will not accept a third run ID.

Do not regenerate strategies, expand the grammar, change cards or game rules, use Modal, or alter the existing challenge, robust PSRO, or race-benchmark commands and artifacts.

## Evidence behind the protocol

- The robust runs closed after 6, 8, and 10 scans, with final matrix widths 81, 94, and 114. Their selected Ranged shares still ranged from effectively 0% to 23.3%, while feasible archetype ranges inside each matrix were at most 0.0034 percentage points wide. Payoff sampling and candidate screening are the material uncertainty, not equilibrium witness selection.
- The current race removes about two thirds of the field after one four-game block. It has no false-negative bound.
- In the 5,000-rank benchmark, independent eight-block top-16 and top-50 sets were disjoint.
- In the 1,000-rank benchmark, 25 blocks gave tie-adjusted broad correlations of 0.905, 0.938, and 0.896 at eight blocks and 0.967, 0.917, and 0.889 at 25 blocks. The three 25-block top-100 sets shared 84 candidates, but the top-16 sets shared only four. Top-16 boundary ties contained 80, 36, and 36 candidates.
- Replaying the v2 evidence with complete score tiers gives 255 distinct candidates in the union of the three top-200 tiers. A wider tier union is practical; an exact top-16 cutoff is not justified.
- The v2 evidence has only 122 combined score vectors for 950 candidate IDs; 904 IDs belong to duplicate-vector groups. Exact IDs overstate observed behavioral diversity.
- Fresh 400-block cross-play between the three old robust lotteries scored 49.65%–51.12% despite disjoint or low-overlap supports. Direct play and acquisition composition are better product checks than support identity.
- Competitive simulation measured 10,200 to 12,800 games per second locally. Full 20,000-candidate evidence is practical if every candidate gets tens of blocks, not thousands of blocks, before confirmation.
- Fresh confirmation removes screen winner's curse, but the current independent bootstrap decisions do not correct for several finalists or repeated scans. The new protocol uses fresh evidence, anytime-valid tests, and run-level family-wise error allocation.

The broad screen remains a practical sensitivity gate, not a mathematical proof that every excluded strategy is below 51%. Reports must call the final state `protocol closure`, not global reservoir closure. Admission and retirement decisions after the screen have declared statistical error control.

## Frozen inputs and run IDs

- Kingdom: `deep-beam-tuning-009`, 50 health, draft off, current turn and action caps.
- Reservoir source: `.experiments/ordered-goldfish-product/native-e760135dba6f-5625a0ff0bf6048653f9`.
- Reservoir size and hash: 20,000 and `fa94c2084739ef`.
- Initial matrix: ordered ranks 1–50.
- Workers: four local pairing workers.
- Version: `ordered-reservoir-full-psro-v1`.
- Run IDs: `run-1` and `run-2` only. Every seed derives from the version, reservoir hash, run ID, phase, scan number, lane or look, and block index.
- Run 1 is designated as the representative before simulation. Run 2 is the replication. Run 1 is reported as representative only if all within-run and two-run gates pass.

Use a new ignored root:

`.experiments/ordered-reservoir-full-psro/ordered-reservoir-full-psro-v1/`

Never read a v1 robust or v1/v2 race artifact as resumable evidence for this protocol. They are rationale and regression fixtures only.

## Broad full-reservoir screen

Each scan freezes one matrix snapshot and its deterministic maximum-support equilibrium. Every ordered-reservoir strategy outside the active matrix receives the same broad evidence before any candidate is removed.

1. Build two independent lanes, A and B.
2. Each lane has 25 blocks. One block is four balanced games.
3. Draw each block opponent independently from the frozen equilibrium weights. Reuse the exact opponent and seed schedule for every candidate in that lane. Save target weights, realized opponent counts, unsampled positive-weight strategies, seeds, and all per-candidate block scores.
4. Evaluate all inactive candidates on both lanes. There is no cut before all 50 blocks, or 200 games per candidate, finish.
5. Rank by lane-A mean, lane-B mean, and pooled 50-block mean. Ordering inside a score tie is for display only.
6. Advance the union of:
   - the complete score tiers containing ranks 1–100 in lane A;
   - the complete score tiers containing ranks 1–100 in lane B;
   - the complete score tiers containing ranks 1–200 in the pooled ranking;
   - complete pooled score tiers immediately below the pooled boundary until at least 64 additional candidates are included; and
   - 64 deterministic screen-negative audit candidates: the 16 smallest stable hashes in each current inactive goldfish-rank band 51–1,000, 1,001–5,000, 5,001–10,000, and 10,001–20,000, after excluding all candidates already advanced.
7. Include every candidate tied at any boundary. Never truncate a tie or an empirical score-equivalence group.
8. Stop the run as `screen-width-unresolved` if the union exceeds 512 candidates. Do not silently rank-truncate it.

Screen evidence selects who receives expensive fresh confirmation. It is never pooled into admission evidence. Report every lane and pooled boundary score, tied count, advanced count, audit-sample count, score-equivalence-group count, and candidates excluded after the broad screen.

## Fresh adaptive confirmation and admission

Confirmation uses full telemetry and a new namespace. All advanced candidates share one independently sampled target-lottery schedule at each block index. Save scores, purchases, reached plan positions, and telemetry separately from screen evidence.

Use cumulative looks at 200, 800, 3,200, and 6,400 blocks. A candidate that receives a decision stops; all others get the next suffix. One block remains the atomic bounded observation in `[0,1]`.

Continuation has fail-closed width gates, not ranking cuts. At most 128 undecided candidates may continue after 200 blocks, 32 after 800 blocks, and 8 after 3,200 blocks. If a gate is exceeded, stop the run as `confirmation-width-unresolved`; never choose the strongest subset.

### Anytime-valid evidence

For block score `X_t` and threshold `mu`, use the mixture betting e-process:

`E+(mu) = mean over lambda of product_t(1 + lambda * (X_t - mu))`

`E-(mu) = mean over lambda of product_t(1 + lambda * (mu - X_t))`

with the fixed grid:

`lambda = 1/256, 1/128, 1/64, 1/32, 1/16, 1/8, 1/4, 1/2, 1`.

`E+` tests the null that conditional mean is at most `mu`. `E-` tests the null that conditional mean is at least `mu`. Factors are nonnegative for the declared thresholds. The anytime p-value is `min(1, 1 / max_prefix(E))`. Compute in log space. Tests must compare the implementation with direct products on small fixtures and reject NaN, infinity, changed order, or missing prefixes.

Invert the same e-process by bisection to `1e-6` for marginal anytime confidence bounds. Decisions use adjusted p-values, not unadjusted displayed bounds.

### Multiple testing and the 50–51% zone

The maximum is 10 scans per run. Reserve the run-level 5% family-wise error budget for false admissions. Divide it equally across 10 scans, so each scan has admission alpha `0.005`. At every look, apply Holm's step-down correction across the complete original confirmation cohort for that scan. Anytime p-values allow the four declared looks without another look penalty. Shared schedules create dependence across candidates, but Holm does not require independence.

False retirement is the practical screen-sensitivity trade-off. Retire only when the candidate's individual one-sided anytime `E-(0.51)` p-value is at most `0.025`, equivalent to an individual 97.5% anytime upper bound below 51%. Do not claim family-wise false-negative control. This is why the completed state is protocol closure rather than global reservoir closure.

Apply decisions in this order:

1. Retire a candidate when its individual anytime upper bound is below 51%.
2. Among candidates not retired, admit a candidate when its Holm-adjusted `E+(0.50)` p-value is at most `0.005`. This rejects no advantage while controlling false admissions across candidates and scans.
3. Continue every other candidate, subject to the fail-closed continuation-width gate.
4. After 6,400 blocks, any candidate without a decision is `unresolved`. One unresolved candidate stops the run as `confirmation-unresolved`; it cannot count as a clean scan.

The 50%–51% interval is the practical indifference zone. A precise interval wholly inside that zone retires under rule 1. A candidate that is clearly above 50% but cannot yet be ruled below 51% can be admitted under rule 2. The retirement-first order makes the rule deterministic if both tests pass.

Make every statistical decision per canonical ID before considering equivalence. Then partition admitted IDs only when their complete shared confirmation evidence is acquisition-equivalent: identical full block-score vector, per-block purchases and acquisitions, reached plan positions, starting build, and every other saved product-telemetry field. Score-only equality is never enough, and different acquisition or card evidence always creates different classes.

Choose the lowest UTF-16 strategy ID in each acquisition-equivalent class as its deterministic representative. Admit only the representative to the matrix and record every other class member as a shadow equivalent. Apply the width-128 matrix gate to representatives, not shadows. The representative carries the class's equilibrium weight for reporting; never divide or invent member weights.

Every later broad screen includes every shadow because shadows are not active matrix strategies. When an advanced shadow reaches confirmation, also evaluate its active class representative on the same complete full-telemetry confirmation schedule as a decision-exempt anchor. Keep the shadow collapsed only if its new complete evidence remains acquisition-equivalent to that anchor. A diverged shadow becomes a separate representative and enters the matrix if its own per-ID statistical decision admits it. Shadows can form new acquisition-equivalent classes with other newly admitted IDs under the same rules.

There is no finalist or representative-admission count cutoff. If adding all new representatives would make the matrix wider than 128 strategies, stop as `matrix-width-unresolved` before changing the matrix. Report every class representative, shadow member, divergence, merge decision, and class weight.

## Matrix evidence and adaptive precision

Do not change `PayoffMatrix` keys or validation because that could invalidate existing artifacts. Add a dedicated nested matrix-evidence type for this protocol.

- Derive 200 matrix seeds per run at startup.
- Store each unordered cell as validated 50-block batches with block scores, matches, and full telemetry.
- Derive exact 50-, 100-, and 200-block matrix snapshots from batch prefixes.
- Start and refill discovery matrices to 50 blocks per unordered pair.
- After the first scan with zero admissions and zero unresolved candidates, top every cell to 100 blocks and force a new full-reservoir scan. Any later admission is filled to the current matrix depth.
- At 100 blocks, require two consecutive clean full-reservoir scans against the unchanged matrix and lottery.

Compare the nested 50- and 100-block matrices. Use actual matrix acquisitions to produce provisional classifier labels, then compute selected Melee, Ranged, Mage, and mixed weights and each feasible group range. Top the full matrix to 200 blocks and force another scan if any of these occurs:

- a selected archetype share changes by more than 2 percentage points;
- a feasible group-range endpoint changes by more than 2 percentage points;
- a strategy with selected or maximum feasible weight of at least 0.5% changes classifier label; or
- the maximum known pure-strategy advantage changes by more than 0.5 percentage points.

At 200 blocks, require two consecutive clean scans. Reapply the same gates between 100 and 200 blocks. If any gate still fails, stop as `matrix-precision-unresolved`; do not add another unplanned depth.

A run completes protocol closure only at 100 or 200 blocks, after two consecutive clean scans at that final matrix depth, no unresolved confirmation, no safety cap, and all matrix-precision gates passing. Stop after 10 total scans as `scan-cap-unresolved`.

For every scan, report the number of advanced counter candidates, admissions, retirements at each look, unresolved candidates, continuation-width gates, strongest confirmed mean and anytime bounds, strongest retired upper bound, and complete boundary-tie counts. These are the closure counters; a clean scan has zero admissions and zero unresolved candidates.

## Final acquisition and self-play panels

After protocol closure, define the reporting support as every strategy with selected equilibrium weight above `1e-8` or maximum feasible equilibrium weight of at least 0.5%. Stop as `support-width-unresolved` if this set exceeds 32 strategies.

Run three independent full-telemetry panels. Each panel evaluates every reporting-support strategy for 1,000 blocks against the selected lottery. Use a stratified opponent allocation with at least 25 blocks against every reporting-support opponent, including itself; allocate the remaining blocks by largest remainder of equilibrium weight. Randomize block order with the panel seed. Compute the exact equilibrium-weighted estimate from per-opponent means, not from the distorted raw allocation.

For each panel and the pooled panels, report:

- acquisition-equivalent class membership, representative, shadow divergences, and the representative's full equilibrium class weight;
- expected acquired copies per card per player-game;
- each action card's share of all action-card acquisitions;
- continuous Melee, Ranged, and Mage damage-package acquisition shares;
- each strategy's label from `classifyStrategyDamage` using its starting build and recorded acquisitions;
- selected equilibrium-weighted Melee, Ranged, Mage, and mixed shares; and
- feasible Melee, Ranged, Mage, mixed, and no-damage group ranges over the full equilibrium set.

A card is material when its pooled normalized acquisition share is at least 1% or its expected copies are at least 0.02 per player-game.

The three-panel stability gate passes only when:

- every selected archetype share spans at most 2 percentage points;
- every material card's normalized share spans at most 2 percentage points;
- every material card's expected copies span at most 0.02 per player-game; and
- no strategy's panel damage-family evidence crosses the classifier's 20% mixed-family boundary or changes its label.

If the first three panels fail, add exactly two more 1,000-block panels and recompute all ranges over five panels. If the five-panel gate fails, stop as `acquisition-panel-unresolved`. Do not weaken a threshold.

Move the classifier implementation to `src/sim/strategyDamage.ts`. Import and re-export it from `scripts/generate_balance_corpus.ts` so the strategy report and its current tests keep one classifier. Add equilibrium-weighted acquisition helpers in simulator code; do not reuse the unweighted `acquiredFamilyShares` helper.

Before production, reproduce the observed YALPS cycle from the saved real 81–114 strategy robust matrices when solving feasible group-weight ranges. Harden `equilibriumGroupWeightRange` without changing its game-value, payoff, or group-objective semantics. Keep the current YALPS result when it is optimal and independently valid. On a cycle or invalid result, use a deterministic fallback solve of the same linear program. Independently verify every primary or fallback solution: finite and nonnegative weights, total weight within `1e-7` of one, every payoff constraint at least `value - 1e-7`, and reported group objective within `1e-7` of the recomputed weight. Validate optimality by solving the opposite signed objective and comparing the returned bound; reject infeasible, unbounded, inconsistent, or non-optimal results. Preserve all existing equilibrium outputs and tests. A full-PSRO report with any missing or invalid group range fails closed.

## Two independent runs and the comparison gate

Commands must expose only:

```sh
npm run ordered-reservoir:full-psro -- --run 1
npm run ordered-reservoir:full-psro -- --run 2
npm run ordered-reservoir:full-psro -- --status
npm run ordered-reservoir:full-psro -- --report
npm run ordered-reservoir:full-psro -- --compare
```

`--compare` requires two deeply valid completed runs and their final panels. It then runs one fresh 10,000-block balanced weighted-lottery cross-play panel. Its schedule and opponent draws are independent of both searches and both acquisition suites. Build its two-sided 95% anytime interval from the 97.5% one-sided `E+` and `E-` inversions.

The two-run comparison passes only when:

- direct Run-1-versus-Run-2 score is from 49% through 51%, inclusive, and its two-sided 95% anytime interval contains 50%;
- every selected archetype share differs by at most 2 percentage points;
- every feasible archetype-range endpoint differs by at most 2 percentage points;
- every card material in either run differs by at most 2 percentage points in normalized share and 0.02 expected copies per player-game; and
- total-variation distance between the complete normalized action-card acquisition vectors is at most 0.05.

If all gates pass, report Run 1 as the predeclared representative and report the two-run ranges beside it. If any gate fails, report `two-run-inconsistent` and do not name a representative lottery.

Also report admitted-ID overlap, selected-support Jaccard, exact-ID weight total variation, score-equivalence-class overlap, acquisition-equivalence-class overlap, and maximum feasible individual-strategy weights. These are diagnostics and never acceptance gates.

The suite must stop after this report. It must not launch, accept, or suggest an automatic third run. A later third-run decision requires a new approved protocol or plan.

## State, artifacts, and strict resumability

Add immutable protocol-keyed artifacts for:

- validated source identity;
- seed plan;
- matrix cell batches and derived prefix snapshots;
- each screen lane chunk and completed screen manifest;
- each confirmation look chunk and Holm decision manifest;
- run checkpoint and state transition;
- each acquisition panel;
- two-run cross-play; and
- JSON and Markdown reports.

Use 250-candidate screen chunks and atomic temporary-file rename. A valid existing chunk is skipped. A missing chunk is regenerated with the same seeds. An invalid existing artifact stops the command; it is never overwritten or silently repaired.

Deep validation must recompute:

- source SHA-256 values, reservoir hash, rule fingerprint, protocol, and run ID;
- every seed namespace and global seed uniqueness;
- exact candidate IDs, canonical strategies, chunk bounds, schedules, block counts, scores, matches, and telemetry totals;
- complete score tiers, tie inclusion, audit samples, and the 512-candidate gate;
- e-process values, anytime p-values, Holm order and decisions, indifference-zone priority, and unresolved state;
- complete per-block confirmation telemetry, acquisition-equivalence partitions, deterministic representatives, shadows, anchor comparisons, divergences, and representative-only width gates;
- matrix prefix batches, centered payoffs, equilibrium, representative admissions, widths, precision gates, and scan transitions;
- acquisition weighting, classifier inputs and labels, group ranges, panel gates, cross-play, and comparison gates; and
- evidence hashes excluding elapsed time only.

A checkpoint references child artifact hashes. It becomes valid only after every child is atomically complete. Resume reconstructs state only from deeply valid checkpoints and child artifacts. Status distinguishes `missing`, `running`, `complete`, `unresolved`, and `invalid` for each run.

## Implementation files and boundaries

Add:

- `src/sim/anytimeMeanEvidence.ts` for betting e-processes, inversion, and Holm decisions;
- `src/sim/orderedReservoirFullPsro.ts` for the frozen protocol, screen tiers, audit sample, state machine, artifacts, validation, and comparison gates;
- `src/sim/nestedPayoffMatrix.ts` for protocol-local 50-block matrix batches and prefix snapshots;
- `src/sim/strategyDamage.ts` for the shared classifier;
- `src/sim/lotteryAcquisition.ts` for stratified final panels, acquisition-equivalence evidence, and equilibrium weighting;
- `src/sim/equilibriumGroupRange.ts` for independently validated primary and fallback group-range LP solves;
- `scripts/ordered_reservoir_full_psro.ts` for run, resume, status, report, and compare orchestration;
- focused tests for each new simulator module and one small end-to-end resumability fixture.

Update `package.json`, `README.md`, and `scripts/generate_balance_corpus.ts`. Do not modify existing robust, challenge, race-benchmark protocol constants, roots, commands, or artifact validators.

## Tests and implementation gates

Tests must prove:

- all inactive candidates receive both complete 25-block screen lanes before selection;
- complete ties and score-equivalent groups advance, and an oversized union stops instead of truncating;
- deterministic rank-band audit sampling excludes shortlisted and active IDs;
- screen evidence cannot enter confirmation means or e-processes;
- direct-product and log-space e-values agree, p-values are anytime, and changed score order changes the validated hash;
- Holm admission decisions use the full cohort and run-level alpha allocation, while retirement uses the declared individual 97.5% anytime bound;
- 200/800/3,200/6,400 continuation, fail-closed width gates, and every unresolved/safety transition;
- only complete acquisition-equivalent confirmation evidence collapses admitted IDs, representatives are deterministic, shadows rescreen, and divergence separates;
- matrix width counts representatives while reports preserve class membership and class weight;
- the saved 81–114 strategy fixture reproduces the group-range cycle, the fallback returns independently validated bounds, and non-cycling existing outputs stay unchanged;
- nested matrix prefixes reuse exact blocks and telemetry without changing existing `PayoffMatrix` behavior;
- every matrix precision top-up forces a fresh screen;
- self-play is present in every final panel and equilibrium weighting matches a hand-calculated two-strategy fixture;
- actual acquisitions, not purchase-plan presence, drive classifier and card reports;
- feasible group ranges use the final fixed labels;
- no command accepts run 3 or compares fewer than two valid runs; and
- corrupt, stale, partial, wrong-source, wrong-rule, wrong-seed, or wrong-protocol artifacts fail closed.

Before production, commit implementation and run:

```sh
npm test -- --run test/sim/anytimeMeanEvidence.test.ts test/sim/orderedReservoirFullPsro.test.ts test/sim/nestedPayoffMatrix.test.ts test/sim/lotteryAcquisition.test.ts test/sim/balanceCorpus.test.ts
npm test
npm run typecheck
npm run lint
npm run build
npm run build:sim
git diff --check
```

Record the pre-production commit SHA. Run no production until implementation review passes.

## Production sequence and result record

1. Run or resume Run 1. Validate it and write an intermediate report. Do not infer two-run consistency.
2. Run or resume Run 2 only after Run 1 is valid or has a terminal unresolved state.
3. If both complete, run the comparison panel and write the two-run report. If either is unresolved, report both states without cross-play.
4. Stop. Do not run a third suite.
5. Commit `.plans/66-ordered-reservoir-full-psro-results.md` with exact game counts, wall times, all within-run gates, closure counters, matrix depths, panel metrics, feasible ranges, direct cross-play, two-run decision, artifact paths, validation, and blockers.

## Projected games and runtime

One hard-capped run has these maxima:

| Work | Maximum games |
|---|---:|
| 10 full screens: 19,950 candidates × 50 blocks × 4 games | 39,900,000 |
| 10 adaptive confirmations with 512/128/32/8 width gates | 11,264,000 |
| Width-128 matrix at 200 blocks | 6,502,400 |
| Five final panels: 32 strategies × 1,000 blocks × 4 games | 640,000 |
| Total per run | 58,306,400 |

The confirmation maximum per scan is `512×200×4 + 128×600×4 + 32×2,400×4 + 8×3,200×4 = 1,126,400` games. Two hard-capped runs plus 40,000 cross-play games are at most 116,652,800 games. At the measured 10,200–12,800 games per second, simulation time is 2.53–3.18 hours. Allowing 15% for source validation, JSON I/O, equilibrium solves, and reports gives a hard projected wall bound of 2.91–3.65 hours. Every width, scan, depth, and panel cap fails closed, so no path exceeds this bound without a new protocol version.

A practical projection uses eight scans, a 400-candidate confirmation cohort, 20% continuing from 200 to 800 blocks, 5% continuing from 800 to 3,200 blocks, 2% continuing from 3,200 to 6,400 blocks, a width-100 100-block matrix, 16 support strategies, and three final panels:

- screens: 31.9200 million games per run;
- confirmations: 6.4512 million games per run;
- matrix: 1.9800 million games per run;
- panels: 0.1920 million games per run;
- total: 40.5432 million games per run.

Two projected runs plus cross-play are 81.1264 million games, or 1.76–2.21 hours of simulation and about 2.03–2.54 hours of wall time with the same 15% allowance. Production reports must replace projections with exact recorded games and wall times.
