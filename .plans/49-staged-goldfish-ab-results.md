# Staged goldfish A/B results

## Run

- Kingdom: `deep-beam-tuning-009`
- Pool seed: 5
- Raw strategies: the same 500,000 canonical strategies as the baseline
- Baseline: four goldfish shuffle seeds for all strategies
- Staged: one shuffle seed for all strategies, then the other three seeds for the top 50,000
- Reservoir: 18,000 four-seed goldfish leaders plus 2,000 deterministic unrestricted random-tail strategies
- Competitive evaluation seed: 7,100,009

## Speed

- Stage one: 110.5 seconds
- Three-seed rescore: 26.6 seconds
- Staged pool: 142.2 seconds, compared with 506.9 seconds for the saved baseline
- Staged pool speedup: 3.56×
- Pool plus PSRO: 222.7 seconds, compared with 605.4 seconds for the saved baseline
- End-to-end speedup: 2.72×
- Theoretical goldfish-work reduction: 3.08×

## Retention

- Baseline top 50 retained: 50 of 50
- Baseline top 18,000 retained: 17,309 of 18,000
- Baseline material support retained: 3 of 3
- Baseline admitted strategies retained: 10 of 10
- Total reservoir overlap: 19,309 of 20,000

## Competitive result

Both runs converged in four rounds with 60 matrix strategies, 10 admitted strategies, and the same three support strategies at the same equilibrium weights. Acquisition-based card and family usage was identical, including 24.8% continuous Ranged share.

Held-out lottery cross-play was 51.0% in both directions, with both 95% intervals containing 50%.

The baseline reservoir's strongest confirmed finalist against the staged lottery scored 48.2%, with a 95% interval of 44.7%–51.6%. The staged reservoir's strongest confirmed finalist against the baseline lottery scored 46.1%, with a 95% interval of 43.6%–48.7%. Neither reservoir found a confirmed exploit.

## Decision

The staged method passes the Kingdom 009 seed-5 A/B. It cut pool time by more than threefold without changing the discovered game, equilibrium, or usage estimates. Test the contrasting seed-4 pool before using staged goldfish for the full production suite.

Ignored detailed evidence: `.experiments/staged-goldfish-ab/staged-goldfish-ab-v1/deep-beam-tuning-009/seed-5/`.
