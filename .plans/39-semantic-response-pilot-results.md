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
