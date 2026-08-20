# One-hundred-kingdom balance suite

## Goal

Measure the current cards without changing card values, health, starting money, first-player rules, or
strategy search. Generate 100 reproducible ten-pile kingdoms, run the full PSRO search for each, and
produce one aggregate HTML report for card health and strategy diversity.

Remove Rigged Melee and its calibration-only paths. Keep the four normal hand-built kingdoms and
their report as separate diagnostic examples. They do not count toward the 100-kingdom aggregate.

## Kingdom design

- The eligible pool is every Action card except always-available Cull and the non-market cards Step,
  Strike, and Shot. The current pool has 19 cards, including Starfire.
- Generate 80 tuning kingdoms and 20 validation kingdoms from independent fixed seeds. Each kingdom
  has 40 health, ten distinct eligible piles, ten cards per pile, and no overrides.
- The manifest is deterministic and committed under `src/sim/`. It records the generator version,
  seeds, split, eligible-card ids, design measures, and every kingdom definition.
- Within each split, make card appearance counts differ by at most one. Optimize pair appearance
  counts with deterministic local swaps. Reject duplicate kingdoms and any two kingdoms that share
  nine or ten piles. Require at least one direct-damage card.
- Report card-count range, card-pair-count range and standard deviation, and the largest overlap.
  Tests use independent literal counts from a small fixture and invariant checks on the committed
  manifest; they do not reproduce the optimizer as the oracle.
- The validation split is evidence for confirming a proposed change. Repeated card tuning uses the
  tuning split, not validation results.

## Runtime modules

1. Put generation and design measurement behind one small interface that accepts the eligible card
   ids, split sizes, kingdom size, and seed, then returns the manifest. Keep optimization details
   private.
2. Register generated kingdoms only in the simulator entry point. The browser game library must not
   import them. The compiled pairing workers must register the same manifest before accepting jobs.
3. Let the experiment CLI accept either a hand-built experiment kingdom or an id in the committed
   balance-suite manifest. Keep unknown ids invalid.
4. Add a resumable batch command. It runs two kingdoms at once and gives each experiment four pairing
   workers, for at most eight pairing workers. It skips only complete, valid full artifacts whose
   rules fingerprint matches the manifest kingdom and current simulator rules. It reruns missing,
   invalid, incomplete, stale, or failed results.
5. Store ignored raw runs under `.experiments/balance-suite/<suite-version>/<kingdom-id>/full/` and a
   batch status file beside them. Preserve completed results if the batch stops.

## Remove calibration code

- Remove `rigged-melee` from kingdom data, curated experiment ids, diagnostic strategies, seed
  namespaces, reports, and tests.
- Remove the calibration diagnostic and its artifact field. Bump the experiment artifact schema and
  rerun the four normal diagnostic kingdoms so their current report remains reproducible.
- Regenerate the diagnostic report with four kingdoms and language that does not mention a
  calibration kingdom.

## Aggregate report

Generate and commit `.html/balance-corpus.html`. Regeneration requires the ignored local run
artifacts. The report must show tuning and validation separately, then a combined descriptive view.

For strategy diversity, show:

- lottery-strategy and near-50%-strategy distributions;
- the effective lottery size, `1 / sum(weight²)`, so one dominant strategy is not mistaken for a
  diverse lottery;
- the percentage of kingdoms with at least two viable strategies;
- acquired action-card family shares for Engine, Melee, Ranged, and Mage;
- draw rate, turns per player, and first-player score as diagnostics only.

For each card, show:

- kingdom availability;
- viable starting-build, finite-plan, and repeat-plan presence;
- actual acquisition in evaluation games;
- average material-lottery weight of strategies that use it;
- acquired family share and the tuning/validation split;
- cards with no viable use or no acquired use.

Calculate per-strategy acquisition rates against the final material lottery. For self-play, divide
same-id acquisition counts between the two players. Use actual acquisition rates for the strategy's
family profile; do not classify it from unreachable late purchase steps.

Show a compact row for all 100 kingdoms. Select five non-duplicate kingdoms for full plans and
matchup tables with stable rules: lowest effective lottery size, highest effective lottery size,
highest ranged acquisition share, lowest ranged acquisition share, and closest to median effective
lottery size. State why each kingdom was selected.

## Commands and documentation

- Add commands to regenerate the manifest, build and resume the 100 full runs, regenerate both HTML
  reports, and validate a completed suite.
- Keep README instructions short. State the expected worker count, ignored artifact location,
  resumable behavior, and that the validation split should not guide repeated tuning.
- Open the final corpus report in the user's normal macOS Google Chrome with a terminal command. Do
  not render it inline.

## Tests

- Generator: fixed-seed byte identity, split sizes, eligible cards, pile size, unique ids and sets,
  balanced card counts, overlap limit, damage requirement, and design measures.
- Registration: generated ids work in the main simulator and a compiled pairing worker, while the
  browser built-in registry remains unchanged.
- Batch: resume keeps a matching valid run and reruns stale, invalid, and partial runs. Test through
  the batch interface with a temporary output root and injected experiment adapter; do not start 100
  real searches in tests.
- Report: hand-calculated effective size, split aggregation, per-strategy acquisition rates, family
  shares, card metrics, five-selector tie breaks, calibration absence, and deterministic HTML.
- Artifacts: schema and fingerprint validation at the public loader seam.

## Acceptance checks

- The committed manifest has exactly 80 tuning and 20 validation kingdoms, with ten piles each, all
  stated design constraints satisfied, and byte-identical regeneration.
- All 100 full runs are valid, complete, current-fingerprint results with zero aborted games. If a
  kingdom fails, preserve the evidence, fix only a simulator or runner defect, and rerun that kingdom;
  do not change cards or replace a difficult kingdom to make the suite pass.
- The four normal diagnostic runs and both committed HTML reports use the current artifact schema.
- The aggregate report independently cross-checks its counts against the manifest and raw artifacts.
- Desktop and 390-pixel Chrome checks pass; wide tables scroll inside their sections.
- A second report generation is byte-identical.
- Focused tests, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`,
  `npm run build:sim`, `npm run test:e2e:manifest`, and `git diff --check` pass.
