# Ordered-reservoir robust PSRO results

## Result

The stronger PSRO process removed the earlier 88%–89% failures, but it did not make the ordered reservoir reliable.

- All three ordered-only runs reached a clean full-reservoir closure.
- The strongest historical counter scored 53.7% against evaluation seed 9,100,009, none passed against seed 9,200,009, and the strongest scored 59.3% against seed 9,300,009.
- The three ordered lotteries were still inconsistent. Pairwise support Jaccard similarity was 0.000, 0.083, and 0.200. Pairwise lottery total-variation distance was 1.000, 1.000, and 0.848.
- Historical audits confirmed 24 attacker results from 23 distinct old strategies. No confirmed old strategy exists in the ordered 12,972,960-candidate space.
- Deterministic representable analogs still exposed the final lottery in 14 of 24 checks. One analog was in the top 20,000, eight were ranked from 20,001 through 500,000, and five did not reach the retained top 500,000.

The remaining problem is both candidate coverage and competitive evaluation. The ordered generator excludes useful plan shapes, goldfish rank removes useful representable plans, and competitive payoffs still vary enough across seeds to produce materially different lotteries.

## Protocol and runtime

Each evaluation seed used only the corrected ordered 20,000-strategy reservoir. Every ordinary and closure scan used two independent cumulative 1/2/4/8 races, up to 16 union finalists, and 400 fresh confirmation blocks. Each run started from the top 50, used 25-block matrix cells, and stopped only after two clean ordinary scans plus a clean full-reservoir closure.

| Evaluation seed | Scans | Matrix | Support | Search time |
|---:|---:|---:|---:|---:|
| 9,100,009 | 10 | 114 | 3 | 412.4 s |
| 9,200,009 | 6 | 81 | 14 | 231.3 s |
| 9,300,009 | 8 | 94 | 10 | 314.1 s |

The full command took 1,660.8 seconds, or 27 minutes 41 seconds. Ordered search took 957.8 seconds, the 15 historical audits took 483.7 seconds, and attacker diagnostics took 22.6 seconds. Local external cost was $0.

## Historical attacks

| Ordered evaluation seed | Historical pools with confirmed attacks | Strongest score | 95% interval |
|---:|---:|---:|---:|
| 9,100,009 | 2, 4, 5 | 53.7% | 51.3%–56.0% |
| 9,200,009 | none | none | none |
| 9,300,009 | 1, 2, 3, 4, 5 | 59.3% | 56.3%–62.5% |

The strongest seed-9,300,009 counter was `sg-e6063a7ed8`:

`Longshot ×1 → Improvise ×2 → Salvage Shot ×1 → Sharpen ×3 → Scour ×1 → Step ×3 → Improvise ×∞`

This plan combines movement, deck thinning, ranged damage, and an unlimited Improvise target. It is outside the ordered grammar because it has seven buy slots, repeats Improvise, uses an infinite count, and has an unsupported fifth-slot count.

Its representable analog was:

`Longshot ×1 → Salvage Shot ×1 → Sharpen ×3 → Scour ×3 → Step ×3`

The analog ranked 54,918, so goldfish excluded it from the final 20,000. It scored 59.2% against seed 9,100,009 and 65.3% against seed 9,300,009 on fresh 400-block checks.

Another clear failure was `sg-f00fd308c7`:

`Salvage Shot ×2 → Sharpen ×3 → Step ×3 → Scour ×3 → Improvise ×∞`

Its finite analog changes only Improvise infinity to Improvise ×3. That analog did not reach the retained top 500,000, but it scored 59.8%, with a 56.8% lower confidence bound, against seed 9,300,009.

These plans share a common shape: Step maintains range, Sharpen and Scour remove weak cards and draw replacements, Salvage Shot converts a ranged card into damage plus another draw, and a repeated damage card gives the deck a continuing purchase target. The ordered grammar fixes exactly five distinct cards and finite quantities. It cannot express repeated-card ladders, infinite repeat purchases, four-card plans, or six-to-eight-slot plans.

## PSRO evidence

The finite plan `sg-23c91658bc` is in the ordered reservoir at rank 11,867 and entered the seed-9,300,009 matrix. Its fresh score against that matrix's solved lottery was 53.6%, with a 51.0% lower confidence bound. This strategy was not missing from generation or goldfish selection. The saved 25-block matrix and fresh 400-block evaluation disagreed enough to leave a retained matrix strategy as a confirmed counter.

This result, plus the near-disjoint supports across the three runs, shows that stronger candidate racing did not remove payoff-estimation and equilibrium instability.

## Decision

Do not treat the current ordered top 20,000 or any one of its three lotteries as the production strategy set.

The next proposal space must support at least variable plan length, repeated cards, and an infinite final buy. Goldfish selection must also preserve competitively useful plans outside its top 20,000. Before another broad run, increase or adapt matrix evidence and require fresh direct checks of every active strategy plus independent closure evidence against the final lottery.

## Artifacts

Ignored detailed evidence:

- `.experiments/ordered-reservoir-robust-psro/ordered-reservoir-robust-v1/report.md`
- `.experiments/ordered-reservoir-robust-psro/ordered-reservoir-robust-v1/report.json`
- `.experiments/ordered-reservoir-robust-psro/ordered-reservoir-robust-v1/historical-attacker-diagnostics.json`

Validation passed for all three run checkpoints, all 15 historical audits, and the complete diagnostics artifact.
