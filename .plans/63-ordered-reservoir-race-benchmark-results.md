# Ordered-reservoir early-race consistency results

## Result

Eight blocks improved broad rank correlation, but did not make the highest-ranked candidates consistent across independent schedules.

The benchmark used one fixed Kingdom 009 lottery. It evaluated ordered reservoir ranks 51–5,000 three times. Each candidate received eight blocks per trial with no elimination. One block was four total balanced games against one opponent sampled from the weighted lottery.

The fixed lottery had one material support strategy. All candidate blocks therefore used that opponent. Differences between trials came from game seeds, not from sampling different support strategies.

## Consistency

| Evidence | Cutoff | Pair overlaps | Pair Jaccards | Triple overlap | Triple Jaccard |
|---|---:|---|---|---:|---:|
| 1 block | 16 | 1, 1, 0 | 3.2%, 3.2%, 0% | 0 | 0% |
| 1 block | 50 | 1, 1, 0 | 1.0%, 1.0%, 0% | 0 | 0% |
| 1 block | 100 | 6, 2, 0 | 3.1%, 1.0%, 0% | 0 | 0% |
| 8 blocks | 16 | 0, 0, 0 | 0%, 0%, 0% | 0 | 0% |
| 8 blocks | 50 | 0, 0, 0 | 0%, 0%, 0% | 0 | 0% |
| 8 blocks | 100 | 0, 0, 23 | 0%, 0%, 13.0% | 0 | 0% |

Tie-adjusted Spearman correlations over all 4,950 candidates were 0.558, 0.311, and 0.221 after one block. They were 0.570, 0.491, and 0.687 after eight blocks. The mean increased from 0.363 to 0.583.

Score ties were large at each cutoff. After one block, the top-16 boundary score tied 80, 43, and 815 candidates in the three trials. After eight blocks, it tied 32, 32, and 34 candidates. Eight blocks reduced top-16 ties, but independent schedules still selected disjoint top-16 and top-50 sets.

Within each trial, the top-16 overlap between the one-block and eight-block rankings was 8, 0, and 0. Top-50 overlap was 23, 0, and 2. Top-100 overlap was 36, 6, and 5.

## Interpretation

Eight blocks provide a more consistent broad ordering than one block. They do not provide a reproducible top-100 shortlist in this benchmark. A one-block early cut cannot be treated as a stable estimate of the candidates that lead after eight blocks.

This benchmark does not test admissions, matrix rebuilding, or PSRO closure. It does not compare different lotteries.

## Runtime and artifacts

The fixed top-50 matrix used 25 blocks for each of 1,225 strategy pairs: 122,500 matrix games. Candidate evaluation used 475,200 games. The command completed in 67.9 seconds of wall time. Recorded simulation work was 56.2 seconds: 11.5 seconds for the matrix and 44.7 seconds for candidate evaluation.

Validated ignored artifacts:

- `.experiments/ordered-reservoir-race-benchmark/ordered-reservoir-race-benchmark-v1/matrix.json`
- `.experiments/ordered-reservoir-race-benchmark/ordered-reservoir-race-benchmark-v1/trials/`
- `.experiments/ordered-reservoir-race-benchmark/ordered-reservoir-race-benchmark-v1/report.json`
- `.experiments/ordered-reservoir-race-benchmark/ordered-reservoir-race-benchmark-v1/report.md`
