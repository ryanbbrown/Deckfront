# Ordered-reservoir robust PSRO results

## Result

The stronger PSRO process removed the earlier 88%–89% failures. It did not fully close the old-reservoir audit, but the evidence does not justify expanding the ordered candidate grammar.

- All three ordered-only runs reached a clean full-reservoir closure.
- The strongest historical counter scored 53.7% against evaluation seed 9,100,009. None passed against seed 9,200,009. The strongest scored 59.3% against seed 9,300,009.
- Fresh 400-seed weighted cross-play put each pair of ordered lotteries close to even: 51.12%, 50.21%, and 49.65% in the measured directions.
- The 24 confirmed audit results came from 23 canonical historical strategy forms. Canonical difference did not establish behavioral difference.
- Four inspected counters had effective equivalents inside the ordered 12,972,960-candidate space. Their extra or infinite steps were unused or unnecessary in evaluated games.
- Three effective equivalents did not reach the retained top 500,000 goldfish set. One ranked 186,989. These examples are goldfish-retention misses, not candidate-generation misses.

## Protocol and runtime

Each evaluation seed used only the corrected ordered 20,000-strategy reservoir. Every ordinary and closure scan used two independent cumulative 1/2/4/8 races, up to 16 union finalists, and 400 fresh confirmation blocks. Each run started from the top 50, used 25-block matrix cells, and stopped only after two clean ordinary scans plus a clean full-reservoir closure.

| Evaluation seed | Scans | Matrix | Material support | Search time |
|---:|---:|---:|---:|---:|
| 9,100,009 | 10 | 114 | 3 | 412.4 s |
| 9,200,009 | 6 | 81 | 14 | 231.3 s |
| 9,300,009 | 8 | 94 | 10 | 314.1 s |

The full command took 1,660.8 seconds, or 27 minutes 41 seconds. Ordered search took 957.8 seconds, the 15 historical audits took 483.7 seconds, and the original attacker diagnostics took 22.6 seconds. Local external cost was $0.

## Correct family classification

The family percentages use `classifyStrategyDamage` from `scripts/generate_balance_corpus.ts`, as used by the strategy report. It classifies recorded starting builds and matrix acquisitions. Purchase-plan family presence is not the report classification.

| Evaluation seed | Selected Melee | Feasible Melee range | Selected Ranged | Feasible Ranged range |
|---:|---:|---:|---:|---:|
| 9,100,009 | 99.999994% | 99.999865%–100% | 0.000006% | 0%–0.000135% |
| 9,200,009 | 76.666276% | 76.663292%–76.666683% | 23.333724% | 23.333317%–23.336708% |
| 9,300,009 | 90.641241% | 90.639488%–90.641599% | 9.358759% | 9.358401%–9.360512% |

The selected witnesses have no Mage or mixed weight. No matrix has a Mage label. Mixed Melee + Ranged can receive at most 0.000053% in another equilibrium. The largest archetype range spans 0.0034 percentage points, so equilibrium selection is not a material family-share concern inside any run.

The largest individual-strategy feasible band is 0.0024 percentage points for seed 9,100,009, 26.6667 points for seed 9,200,009, and 0.0189 points for seed 9,300,009. The seed-9,200,009 matrix has interchangeable Melee strategies. This strategy-level ambiguity does not change its narrow family-share range.

The remaining 0% to 23.3% Ranged difference is across sampled payoff matrices. It is not ambiguity among equilibria of one fixed matrix. Direct cross-play shows that these different family compositions still have similar competitive strength.

## Historical attacks

| Ordered evaluation seed | Historical pools with confirmed attacks | Strongest score | 95% interval |
|---:|---:|---:|---:|
| 9,100,009 | 2, 4, 5 | 53.7% | 51.3%–56.0% |
| 9,200,009 | none | none | none |
| 9,300,009 | 1, 2, 3, 4, 5 | 59.3% | 56.3%–62.5% |

The strongest seed-9,300,009 counter was `sg-e6063a7ed8`:

`Longshot ×1 → Improvise ×2 → Salvage Shot ×1 → Sharpen ×3 → Scour ×1 → Step ×3 → Improvise ×∞`

Across 1,600 shared-schedule games, it averaged 8.15 purchases and reached at most 11. Capping final Improvise at 3 produced the same block outcomes and purchase record. Scour was bought 0.000625 times per game. Removing Scour and the final Improvise gave this behavior-preserving ordered strategy:

`Longshot ×1 → Improvise ×2 → Salvage Shot ×1 → Sharpen ×3 → Step ×3`

It scored the same 57.8125% on the shared schedule and did not reach the retained top 500,000 goldfish set.

Two other exact examples were:

- `Salvage Shot ×2 → Sharpen ×3 → Step ×3 → Scour ×3 → Improvise ×∞`
- `Salvage Shot ×2 → Sharpen ×3 → Step ×3 → Gold ×3 → Scour ×∞`

Replacing each infinite final buy with a finite count of 3 produced an ordered candidate with identical block outcomes and purchase records. Neither finite candidate reached the top 500,000.

A six-slot example,

`Salvage Shot ×2 → Precision Shot ×1 → Sharpen ×3 → Step ×3 → Improvise ×3 → Salvage Shot ×∞`,

had a five-slot ordered prefix that scored better on the shared schedule. That prefix ranked 186,989.

No evaluated game among these four examples exceeded 11 purchases. The extra and infinite steps did not explain their strength.

## Decision

Keep the exhaustive ordered grammar as the current candidate-generation baseline. Do not infer missing behavior from a different canonical plan string.

The next analysis should audit all 23 historical forms by executed behavior, then identify each behavior-preserving ordered candidate's goldfish rank and whether the top 20,000 contains another strategy with the same role. Improve goldfish retention or the PSRO payoff process only where that audit supplies direct evidence.

Use `docs/strategy-search-evidence.md` for the reporting and interpretation rules.

## Artifacts

Ignored detailed evidence:

- `.experiments/ordered-reservoir-robust-psro/ordered-reservoir-robust-v1/report.md`
- `.experiments/ordered-reservoir-robust-psro/ordered-reservoir-robust-v1/report.json`
- `.experiments/ordered-reservoir-robust-psro/ordered-reservoir-robust-v1/historical-attacker-diagnostics.json`

Validation passed for all three run checkpoints, all 15 historical audits, and the complete diagnostics artifact.
