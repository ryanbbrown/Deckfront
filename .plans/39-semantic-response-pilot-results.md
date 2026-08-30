# Semantic response pilot results

## Run

- Kingdom: `deep-beam-tuning-009`
- Version: `random-psro-v5`, artifact schema 4, consistency report schema 1
- Seeds: 35001 and 35002
- Proposal mix per 20,000 fresh policies: 12,000 semantic recipes, 5,000 local mutations, and 3,000 unrestricted policies

## Results

- Seed 35001 converged in 4m 33s after 17 rounds. It archived 131 finalists and admitted 45 strategies.
- Seed 35002 stopped incomplete in 3m 17s after 14 rounds. It archived 107 finalists and admitted 27 strategies. Its independent search found a 55.8% response with a 53.2% confidence-interval lower bound.
- Lottery cross-play was 49.6% and 49.1%, so performance parity passed.
- No support strategy had a held-out lower bound above 52% against the other lottery, so the cross-support pilot gate passed.
- Acquisition-based metagame shares were 70.7% Melee / 29.3% Ranged for seed 35001 and 100.0% Melee for seed 35002. The 29.3-point family-share gap failed the 10-point gate and was worse than v4's 14.9-point gap.
- The known v4 Precision Shot–Longshot challenger scored 49.7% against seed 35001 and 46.0% against seed 35002. Its confidence-interval lower bounds were 48.1% and 43.9%, so the canary gate passed.
- All generated support plans decoded as canonical response policies, so the cumulative and contiguous duplicate-target no-op gate passed.
- Seed 35002's final attack was a local count variant of its 89.8%-weight strategy: `Precision Shot ×3 → Sharpen ×3 → Strike ×4 → Step ×1 → Gold ×∞` instead of `Precision Shot ×4 → Sharpen ×3 → Strike ×3 → Step ×2 → Gold ×∞`.

## Decision

The first semantic generator is not good enough to scale. It removed the known v4 exploit and produced equal-strength lotteries, but it did not stabilize family representation and it missed a profitable local variant after five clean rounds. Inspect the local-parent allocation and recipe fitness before changing the semantic taxonomy or running ten kingdoms.

Ignored evidence is under `.experiments/random-psro-consistency/random-psro-v5/`.

## V6 follow-up

V6 replaced random local walks with exhaustive count combinations around equilibrium-support plans. Both seeds then reported convergence, but the independent comparison failed:

- Seed 35001 converged in 4m 30s after 17 rounds. It admitted 52 strategies and ended with 60 matrix strategies.
- Seed 35002 converged in 6m 34s after 29 rounds. It admitted 72 strategies and ended with 80 matrix strategies.
- Seed 35001 scored 41.0% against seed 35002. Seed 35002 scored 59.5% against seed 35001. Both confidence intervals exclude an even result.
- Seed 35002's three support strategies each beat seed 35001. Their scores were 57.7%, 62.9%, and 55.5%.
- The v4 Precision Shot–Longshot canary scored 63.2% against seed 35001 but only 34.0% against seed 35002.
- Acquisition-based shares were 79.6% Melee / 20.4% Ranged for seed 35001 and 57.1% Melee / 42.9% Ranged for seed 35002.
- None of either run's material support strategies appeared in the other run's archive.

V6 fixed the known count-neighborhood miss but not structural proposal coverage. Exhaustive count tuning only explores counts around a purchase-plan structure that the run already found. Each run still found different card combinations, purchase orders, and fallback cards, then optimized inside that region. Five clean batches can therefore mean that the run stopped proposing new regions, not that no strong region exists.

Do not scale V6 to ten kingdoms. The next experiment should separate structural discovery from count tuning: preserve a fixed quota of candidates for each purchase-plan structure, optimize counts within each structure, and compare the best structures globally only after that within-structure search.

Ignored V6 evidence is under `.experiments/random-psro-consistency/random-psro-v6/`.
