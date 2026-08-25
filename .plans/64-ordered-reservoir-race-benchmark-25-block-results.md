# Ordered-reservoir 25-block race benchmark results

## Result

Twenty-five blocks made the broad ranking and top 100 much more consistent across the three schedules. The top 16 remained sensitive to ties.

The benchmark used ordered ranks 1–1,000. Ranks 1–50 formed the fixed matrix. Ranks 51–1,000 were the 950 candidates. Every candidate received 25 blocks, or 100 balanced games, in each of three independent schedules. No candidate was eliminated or admitted.

The v2 matrix uses the v1 matrix seeds. Its matrix snapshot and equilibrium are byte-for-byte equal to the completed v1 benchmark values. The matrix SHA-256 is `2ffe1cd426aa2c8738ac38fe03f11f298af81ca4429fd598c4b6e4c2370a08b9`.

## Consistency

| Evidence | Cutoff | Pair overlaps | Triple overlap | Triple Jaccard |
|---:|---:|---|---:|---:|
| 1 block | 16 | 5, 2, 0 | 0 | 0% |
| 1 block | 50 | 26, 3, 0 | 0 | 0% |
| 1 block | 100 | 54, 5, 0 | 0 | 0% |
| 8 blocks | 16 | 3, 2, 0 | 0 | 0% |
| 8 blocks | 50 | 16, 7, 5 | 0 | 0% |
| 8 blocks | 100 | 55, 43, 63 | 43 | 23.6% |
| 25 blocks | 16 | 4, 4, 7 | 4 | 10.8% |
| 25 blocks | 50 | 27, 36, 41 | 27 | 37.0% |
| 25 blocks | 100 | 93, 88, 84 | 84 | 70.6% |

Tie-adjusted Spearman correlations over all 950 candidates were:

- 1 block: 0.769, -0.713, and -0.643; mean -0.196
- 8 blocks: 0.905, 0.938, and 0.896; mean 0.913
- 25 blocks: 0.967, 0.917, and 0.889; mean 0.924

After 25 blocks, the top-16 boundary score tied 80, 36, and 36 candidates. The deterministic cutoff selected 16, 7, and 16 candidates from those ties. At top 50, the boundary ties were 50/80, 5/48, and 14/48 selected/tied. At top 100, they were 13/72, 6/37, and 16/39.

The 25-block top-100 sets were consistent despite their boundary ties. The top-16 sets were not: only four candidates appeared in all three, and 37 distinct candidates appeared in at least one top 16.

## Runtime and artifacts

The first complete command took exactly 53.30 seconds of wall time. Recorded work was 39,475.464834 ms: 12,007.980625 ms for the matrix and 27,467.484209 ms for candidate evaluation.

The run played 285,000 candidate games and 122,500 matrix games. The report and resumable block-score evidence are under `.experiments/ordered-reservoir-race-benchmark/ordered-reservoir-race-benchmark-v2/`.

A checksum comparison before and after the run confirmed that every completed v1 artifact stayed unchanged. The checksum-manifest SHA-256 remained `fa4be02a3897f5ae91d3b9ad10fae0c3091bf0522136a9ba698f9dec8c21ac4c`.

This benchmark measures one fixed lottery. It does not test matrix rebuilding, admissions, PSRO continuation, or different game rules.
