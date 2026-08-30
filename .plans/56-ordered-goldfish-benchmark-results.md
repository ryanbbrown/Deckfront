# Ordered unique-card goldfish benchmark results

## Baseline

- Kingdom: `deep-beam-tuning-009`
- Structure: empty starting build, five ordered unique finite purchase rungs, no fallback
- Quantities: first three rungs range from 1 through 4, last two are fixed at 3, total at most 15
- Space: 240,240 ordered skeletons, 54 quantity vectors, 12,972,960 candidates
- Sample: 100,000 candidates selected by the fixed coprime-stride traversal
- Candidate checksum: `93a38dcc12eabd6`
- Goldfish evidence: one shared shuffle across stationary, chaser, and kiter profiles
- Machine: Apple M4 Pro, 10 performance cores plus 4 efficiency cores, Node 22.23.1

## Result

| Workers | Scoring time | Strategies per second | Individual trials per second |
|---:|---:|---:|---:|
| 4 | 37.592s | 2,660 | 7,980 |
| 10 | 21.817s | 4,584 | 13,751 |
| 14 | 22.201s | 4,504 | 13,513 |

Ten workers were fastest in this short benchmark. Goldfish scaling differs from the earlier pairing-worker benchmark that peaked at four workers.

At the measured ten-worker rate, one shuffle over the complete 12,972,960-candidate provisional space would take about 47 minutes before selection and rescore work. A four-million-candidate space would take about 14.5 minutes.

Generation and checksum work for the 100,000-candidate sample took 0.328 seconds. The current CLI materializes only the requested sample. A production multi-million run still needs chunked generation and bounded score retention.

Ignored evidence:

- `.experiments/ordered-goldfish-benchmark/typescript-current-100k.json`
- `.experiments/ordered-goldfish-benchmark/typescript-current-100k-w4.json`
- `.experiments/ordered-goldfish-benchmark/typescript-current-100k-w14.json`
