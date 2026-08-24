# Movement-aware goldfish enrichment results

## Run

- Kingdom: `deep-beam-tuning-009`, draft off
- Pool: 200,000 unrestricted random policies
- Goldfish evidence: four shared shuffles under stationary, chasing, and kiting targets
- Runtime on 10 workers: 119.72 seconds goldfish, 58.18 seconds competitive screen, 36.09 seconds confirmation, and 218.49 seconds total
- Cohorts: top 100 movement-aware scores and 100 deterministic random controls from the same pool
- Competitive screen: 32 shared blocks against each of six saved V4–V6 lotteries
- Confirmation: each cohort’s five screen leaders on 400 fresh blocks against every lottery

## Result

| Cohort | Screen mean | Median | Maximum | At least 40% | At least 50% |
|---|---:|---:|---:|---:|---:|
| Movement-aware goldfish | 20.4% | 19.8% | 49.3% | 1 | 0 |
| Random control | 2.4% | 1.5% | 14.2% | 0 | 0 |

The goldfish cohort’s confirmed leader was:

`Sharpen ×3 → Strike ×3 → Scour ×2 → Gold ×1 → Step ×2 → Reforge ×∞`

It averaged 47.4% across all six lotteries with a 95% interval of 45.9%–48.8%. It scored 50.9% against V4 seed 35001 and 54.9% against V4 seed 35002, but 42.5%–47.4% against the other four lotteries. The random cohort’s confirmed leader averaged 15.4%.

## Decision

Movement-aware goldfish scoring strongly enriched this 100-policy sample relative to ordinary random selection, and it was much better than the stationary-only top five. It still did not produce a strategy competitive with the combined saved-lottery set. Use it only as a cheap first-stage filter before competitive racing.

This result does not compare goldfish filtering with a full 20,000-policy random competitive race. That equal-budget comparison is required before adding the filter to PSRO.

Ignored detailed evidence: `.experiments/goldfish-k009/enrichment.{json,md}`.
