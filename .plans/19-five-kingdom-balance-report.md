# Five-kingdom balance report

## Goal

Generate one local HTML report from the completed 40-health full runs for `current-duel`,
`three-way-open`, `three-way-engine`, `range-rich-mixed`, and `rigged-melee`. The report must help a
designer judge kingdom strategy diversity and card usefulness. It must not change game or simulator
rules.

## Definitions

- A **lottery strategy** has at least 0.1% weight in the final equilibrium. This removes the solver's
  tiny maximum-support witness weights while preserving every material strategy.
- A **near-competitive strategy** has less than 0.1% lottery weight and scores at least 48% against
  the material lottery. The two-point band is a visible provisional threshold, not proof that the
  strategy is equally strong.
- A **viable strategy** is either a lottery strategy or a near-competitive strategy.
- A strategy's score against the lottery is its payoff-matrix score against the normalized material
  lottery weights. The matchup table uses the same complete matrix.
- Action cards have one fixed reporting family: engine, melee, ranged, or mage. Treasure is separate.
  A strategy can use several families.
- A card counts as used when it appears in a viable strategy's starting build, finite purchase plan,
  or repeat purchase. The report must distinguish plan presence from proof that a game acquired it.
- `rigged-melee` is a calibration kingdom. Show it, but exclude it from normal-kingdom totals.

## Implementation

1. Add a deterministic TypeScript report generator that loads and validates the five existing full
   artifact sets. Fail with a useful message when a run is absent, invalid, incomplete, or uses an
   unsupported schema.
2. Keep balance calculations in exported pure transformations. Calculate material lottery weights,
   score against the lottery, viable strategies, pairwise viable-strategy scores, strategy card
   families, and cross-kingdom card-use counts.
3. Use the saved payoff matrix for scores and cross-strategy matchups. Run only missing self-play
   cells with the matrix's saved seeds and protocol so the report can calculate final-lottery turns,
   draws, and first-player results. Do not rerun search.
4. Render and commit `.html/balance-report.html`. Put the conclusions and definitions before detail.
   For each kingdom, show lottery weights, near-competitive strategies, build and one column per
   purchase step, repeat purchase, families, score against the lottery, and the viable-strategy
   matchup matrix.
5. Add a normal-kingdom card table with availability, viable-strategy use, lottery use, and the
   kingdoms that use each card. State that five curated kingdoms are an initial sample and cannot
   establish corpus-wide card health.
6. Add an npm command and concise README instructions for regeneration.

## Tests

- Test the public artifact-to-report-model transformation with a small independent fixture whose
  equilibrium weights and matchup scores have hand-calculated expected values.
- Prove the 0.1% material-weight rule, 48% near-competitive boundary, weight renormalization,
  calibration exclusion, fixed card families, and card-use counting.
- Test artifact validation errors and deterministic HTML output.
- Assert required report sections and labels. Do not use a snapshot as the only oracle.

## Acceptance checks

- The committed report is generated from all five current full artifact sets and names their run
  completion times.
- Current Duel shows one material lottery strategy; the other normal kingdoms match the saved
  equilibrium and payoff data.
- The report clearly separates lottery membership, near-competitive results, and card-plan use.
- The page works at desktop and narrow widths, with wide tables scrolling inside their sections.
- A second generation is byte-identical.
- Focused tests, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`,
  `npm run build:sim`, and `git diff --check` pass.
