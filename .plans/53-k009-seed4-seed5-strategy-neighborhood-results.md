# K009 seed-4 versus seed-5 strategy neighborhood results

## Question

Did the 500,000-policy seed-4 raw pool contain strategies meaningfully similar to the Ranged strategies that held material equilibrium weight in seed 5?

## Targets

Seed 5's material Ranged strategies were:

- `sg-e6063a7ed8`, 32.4% weight: `Longshot ×1 → Improvise ×2 → Salvage Shot ×1 → Sharpen ×3 → Scour ×1 → Step ×3 → Improvise ×∞`.
- `sg-7c8790ccdb`, 6.3% weight: `Precision Shot ×1 → Sharpen ×3 → Precision Shot ×2 → Strike ×2 → Longshot ×5 → Step ×3 → Scour ×∞`.

The first strategy acquired about 1.19 Longshot, 1.11 Salvage Shot, 3.58 Sharpen, 3.58 Step, and 0.21 Improvise per game. The second acquired about 0.46 Precision Shot, 2.03 Strike, 0.52 Longshot, 3.10 Sharpen, and 3.07 Step.

## Raw seed-4 coverage

The deterministic seed-4 raw pool was regenerated in full.

| Measure | Pure-Ranged target | Mixed target |
|---|---:|---:|
| Exact ordered card skeleton, ignoring quantities | 0 | 0 |
| All required cards in any order | 1,133 | 1,103 |
| Relaxed ordered core | 55 | 1 |
| Relaxed ordered core retained in the 20,000 reservoir | 7 | 1 |
| Minimum card-sequence edit distance | 2 | 2 |
| Raw policies at that minimum distance | 17 | 19 |

The relaxed pure-Ranged core required Longshot before Salvage Shot before Sharpen before Step, with Improvise somewhere in the plan. The relaxed mixed core required Precision Shot before Sharpen before another Precision Shot before Strike before Longshot before Step.

Seed 4 therefore generated many plans containing the same broad card package. Goldfish also retained examples of both ordered cores. Exact strategy identity and exact skeleton overlap were absent.

## Competitive equivalence

All 56 seed-4 relaxed ordered-core analogs were tested on 400 fresh blocks against both the seed-4 and seed-5 final lotteries.

- The best pure-Ranged analog scored 10.6% against seed 4 and 28.5% against seed 5.
- The one mixed-core analog scored 23.3% against seed 4 and 27.5% against seed 5.
- Two independent 400-block checks put the actual seed-5 pure-Ranged target at 47.0% and 51.2% against seed 4. Their equal-size pooled point estimate is 49.1%.
- The actual seed-5 mixed target scored 25.8%–26.3% against seed 4.

The broad card package was present, but none of the relaxed seed-4 analogs was competitively equivalent to the seed-5 strategy. Quantities, ordering, fallback choice, and extra cards changed performance materially.

## Conclusion

Exact policy overlap understated seed-4's broad structural coverage. The raw pool did generate and goldfish did retain Ranged plans with similar card packages.

The effective pure-Ranged realization was still absent: no seed-4 plan had the same ordered card skeleton, and every relaxed analog performed far worse. This example supports improving proposal generation around coherent structures and their quantity/order variants, but it does not show that seed 4 omitted the Ranged family as a broad concept.

Ignored evidence:

- `.experiments/staged-goldfish-ab/staged-goldfish-ab-v1/deep-beam-tuning-009/seed-4-vs-seed-5-strategy-neighborhood.json`
- `.experiments/staged-goldfish-ab/staged-goldfish-ab-v1/deep-beam-tuning-009/seed-4-vs-seed-5-all-relaxed-analogs-competitive.json`
