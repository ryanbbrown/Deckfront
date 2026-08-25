# Staged goldfish K009 multi-seed results

## Run

Kingdom 009 pool seeds 1–5 used the staged 500,000 → 50,000 → 18,000 plus 2,000 protocol. Each run recreated the exact baseline raw pool and used the same four goldfish seeds and competitive evaluation seed as its saved baseline.

## Timing

| Seed | Staged pool | PSRO | Search total | Pool speedup | Total speedup |
|---:|---:|---:|---:|---:|---:|
| 1 | 2.5m | 1.1m | 3.5m | 2.40× | 2.10× |
| 2 | 2.4m | 1.3m | 3.7m | 2.31× | 1.79× |
| 3 | 2.1m | 1.0m | 3.1m | 4.39× | 3.30× |
| 4 | 2.3m | 0.6m | 2.9m | 3.22× | 2.75× |
| 5 | 2.4m | 1.3m | 3.7m | 3.56× | 2.72× |

The mean search time was 3.4 minutes per seed. Three seeds took 10.3 minutes of search time. Five seeds took 17.0 minutes. Mean pool speedup was 3.18× and mean pool-plus-PSRO speedup was 2.53× against the saved baselines.

## Fidelity

- Every run retained all baseline top-50 strategies, all material support strategies, and all admitted strategies.
- Baseline top-18,000 retention was 17,250–17,309, or 95.8%–96.2%.
- Total reservoir overlap was 19,250–19,309 of 20,000.
- Every staged run matched its baseline rounds, matrix size, admission count, support identities, acquisition-based card usage, and continuous family shares. Seed 1 had only solver-scale weight differences below 0.000004 percentage points.

Continuous Ranged shares were 9.8%, 17.4%, 17.9%, 0.2%, and 24.8%. Staging therefore preserved the known between-pool variation rather than adding new variation.

## Fresh cross-attacks

Seeds 1, 2, 4, and 5 found no confirmed cross-reservoir exploit. Seed 3 failed in both directions despite the baseline and staged runs producing the same restricted game:

- Baseline reservoir against staged lottery: `sg-391da704db`, goldfish rank 635, scored 61.8% with a 95% interval of 58.6%–65.1%.
- Staged reservoir against baseline lottery: `sg-2e83709eda`, stage-one rank 29,857 and four-seed rank 1,452, scored 57.8% with a 95% interval of 54.5%–61.1%.

Neither strategy reached the original run's eight finalists. Both were retained in their reservoirs. This localizes the seed-3 failure to stochastic competitive racing, not raw proposal generation, staged goldfish filtering, admission, or equilibrium solving.

## Decision

Adopt staged goldfish as the pool-scoring method. It reduced search time materially and preserved every measured baseline conclusion across five seeds.

Do not treat the current 1/2/4/8-block competitive race as fully reliable for the 100-kingdom production run. The seed-3 fresh attacks found decisive retained challengers after two clean scans. Test a stronger early race or a mandatory fresh final reservoir scan before production.

Ignored detailed evidence: `.experiments/staged-goldfish-ab/staged-goldfish-ab-v1/deep-beam-tuning-009/seed-1/` through `seed-5/`.
