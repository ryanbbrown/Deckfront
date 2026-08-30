# Strategy-search evidence

Read this before interpreting PSRO, equilibrium, strategy-family, or balance-report results.

## Use the project classifier

Use `classifyStrategyDamage` in `scripts/generate_balance_corpus.ts` for Melee, Ranged, Mage, and mixed strategy labels. It classifies a strategy from its starting build and recorded acquisitions. A family is part of a mixed label when it supplies at least 20% of the strategy's damage-package evidence. Improvise contributes to each damage family that the strategy owns.

The v2 Rust balance report uses this classifier for strategy-family shares. Generate it with `npm run strategy-search:rust-balance-report` after the stored equilibrium acquisition rates are available.

A card-family presence check on the purchase plan is not this classification. Do not use plan presence to report a kingdom's Ranged, Melee, or Mage percentage.

For Rust strategy-search evidence, calculate each strategy's acquisition rates against the stored equilibrium opponent before classification. For acting strategy `i`, opponent strategy `j`, stored equilibrium weight `p`, and normalized acquisition cell `A`, use `sum_j p_j × A[i,j]`. The diagonal cell comes from `self-play-v1.hst`; add both player-position totals and divide by 500 player sides. An off-diagonal HGM cell divides by 250 player games.

Balance headlines describe the stored equilibrium lottery playing against itself. Apply both weights: `sum_i p_i × sum_j p_j × A[i,j]`. Apply the same formula to played-card family damage. Each kingdom then has equal weight in the 30-kingdom summary. If one strategy has all equilibrium weight, use only that strategy's diagonal telemetry.

Raw unweighted full-Matrix counts are audit evidence. Do not use pooled counts, uniform opponents, or off-diagonal-only rates for strategy labels, card-usage headlines, family-damage headlines, or balance outliers. The Matrix payoff diagonal remains fixed at 50%; same-strategy games supply telemetry only.

V2 report generation structurally checks file formats, CRCs, source links, checkpoint completion, selected Matrix order, and HST evidence. It does not replay Goldfish ranking, Matrix solving, PSRO screening, decisions, or races. Deep verification is a separate, deliberate `psro-verify` run.

## Separate three kinds of consistency

- Candidate consistency: the ordered generator exhausts its specified 12,972,960-strategy space. With fixed code, rules, kingdom, and seeds, candidate generation and goldfish ranking are reproducible.
- Payoff consistency: PSRO estimates match payoffs from sampled games. Different evaluation seeds can produce different matrices and lotteries.
- Equilibrium consistency: one fixed payoff matrix can have several equilibria. The solver returns a deterministic maximum-support witness, but balance reporting must use feasible group-share ranges over the full equilibrium set.

A fixed matrix has one game value and an equilibrium set. It does not always have one unique lottery. Canonical support overlap and per-strategy weight changes are weak balance measures when several strategies have the same effective role. Compare lotteries by direct cross-play and compare balance by classified archetype ranges.

## Recorded equilibrium evidence

Earlier draft-off matrices had narrow equilibrium-selection ranges. For example, the selected Mage share was 7.5254%, and its feasible range was 7.5253% to 7.5255%. See `.plans/34-strategy-search-results.md`.

## Interpret candidate coverage by executed behavior

Canonical strategy identity is not behavioral identity. Infinite final buys, extra slots, and repeated cards can be irrelevant when games never reach those plan steps. Before claiming that the ordered grammar omitted a counter:

1. Cap infinite quantities at the observed purchase limit.
2. Remove plan steps that evaluated games never reach.
3. Compare shared-shuffle-seed outcomes and purchase telemetry.
4. Look up the behavior-preserving ordered strategy's goldfish rank.

Four inspected historical counters had effective equivalents in the 12,972,960-strategy space. Two finite equivalents produced identical outcomes and purchases. A six-slot counter had a stronger five-slot ordered prefix. A seven-slot counter had an ordered five-slot version with identical outcomes after its almost-unused Scour step and unused final Improvise step were removed. Three effective equivalents did not reach the top 500,000 goldfish set; one ranked 186,989.

These examples point first to goldfish retention, not candidate grammar. The 23 historical counter IDs are 23 canonical forms, not proof of 23 distinct behaviors. Audit all counters by executed behavior before changing the exhaustive grammar.
