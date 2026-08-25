# Native strategy-search performance results

## Protocol

- Pre-implementation SHA: `e9dd8e8090751c24557b141c2145f70cf31c104a`
- Machine: Apple M4 Pro, 10 performance plus 4 efficiency cores, Node 22.23.1
- Frozen sample: 100,000 of 12,972,960 Kingdom 009 candidates, seed 4,100,000, stationary/chaser/kiter, 30 turns, 200 actions
- Candidate checksum: `93a38dcc12eabd6`
- Ordered score-key digest: `cf175ac2165dbd2`
- Native protocol: `native-goldfish-v1`, Rust 1.98.0

## Local benchmark

| Scorer | Workers/threads | Generation | Scoring | Strategies/s | Peak RSS |
|---|---:|---:|---:|---:|---:|
| Starting TypeScript, no score digest | 10 | 327ms | 27,030ms | 3,700 | not recorded |
| Original TypeScript plus ordered digest | 10 | 583ms | 11,874ms | 8,422 | 1.15 GiB |
| Lean TypeScript compact mode | 10 | 574ms | 11,500ms | 8,696 | 1.25 GiB |
| Rust release before turn-loop allocation removal | 10 | 466ms | 4,071ms | 24,562 | 150 MiB |
| Rust release final, median of three | 10 | 469ms | 2,673ms | 37,384 | 187 MiB |

All three final paths returned the same candidate and score digest. Final Rust was 4.44× faster than the digest-enabled original path. Its three final scoring runs were 2,673ms, 2,675ms, and 2,570ms. The lean TypeScript path was 3.3% faster than original in the full sample. The earlier no-digest table remains historical evidence in plan 56.

## Optimization loops

1. The measured action-loop cost was eager pilot-view purchase projection and output allocation. Discard projections now exist only during a pending discard; Cull ownership scans now exist only with Cull in hand; lean trials omit per-turn, position, and per-card output. Kernel parity and lean full-field conformance stayed exact.
2. Hoisting tactical mechanic sets was tested twice on 5,000 candidates. Results were 1,469ms and 1,672ms versus 1,425ms before the change. The change was rejected.
3. A compiled esbuild worker was tested on 5,000 candidates. Runs were 1,309ms and 1,456ms. The benefit was mainly lower startup overhead and less loader work, so the compiled worker was retained. The remaining TypeScript cost is the tactical decision loop; Rust made further TypeScript restructuring poor expected value.

The standalone Rust scorer uses integer card IDs, fixed mechanic/value records, per-thread state, Rayon batches, and no string lookup, hash lookup, or heap allocation in the turn loop. Zones reserve their maximum trial capacity before the loop. Shuffle, purchase projection, spell damage, movement choices, family targets, discard choices, Cull targets, and action cleanup reuse vectors or fixed stack arrays. Exact conformance covers 1,000 frozen candidates, compact and full output, all current card mechanics, all movement profiles, shuffle output, UTF-16 order, victory/turn/action boundaries, money, damage area, and ranking fields.

Final 100,000-candidate Rust thread scaling used the same digest:

| Threads | Scoring | Strategies/s |
|---:|---:|---:|
| 1 | 10,399ms | 9,616 |
| 2 | 5,981ms | 16,720 |
| 4 | 3,752ms | 26,654 |
| 8 | 2,773ms | 36,058 |
| 10 | 2,581ms | 38,747 |
| 14 | 2,566ms | 38,974 |

Ten threads are the practical local default. Fourteen added only 0.6% throughput.

## Modal

Rates used before launch were $0.0473/core-hour and $0.008/GiB-hour. No GPU or Sandbox was used.

| Run | Range | Allocation | Worst-case reservation | Metered cost | Result |
|---|---:|---|---:|---:|---|
| Smoke `native-b8e4d9fefcdd-f2517b502539f2bc84ae` | 1,000 | 2 × 4 CPU, 4 GiB | $0.0668 | $0.01095 | 2/2 shards, exact local shard digests |
| Full `native-b8e4d9fefcdd-da77b7a513d41a6d483e` | 12,972,960 | max 48 × 4 CPU, 4 GiB | $1.4562 | $0.37159 | 87/87 shards, 48 containers, complete merge |

The full run used 150,000-candidate shards. Container elapsed time was 22.0–56.5 seconds, with a 41.8-second median. The merge was observed within 102 seconds of launch, at least 127,000 strategies/s including scheduling. All apps were stopped after result collection. Cumulative native-run reservation was $1.5231; measured native-run cost was $0.3825. The month summary showed $0.3846 total ephemeral-app metered cost, $0.00 billed after credits. One of three permitted full-space runs was used.

Durable results are in Modal Volume `hexdeck-native-strategy-results` under the two run IDs. The full merge records 12,972,960 complete candidates, build `b8e4d9fefcdd`, rule fingerprint `b5115138db0`, scorer `native-goldfish-v1`, and 87 contiguous shard ranges.

## Bounded staged product path

`npm run staged-goldfish:native-pool` runs the stateful product generator as one accepted-order coordinator and sends bounded chunks to one persistent Rust scorer. Stage one retains independent shard top sets for the 50,000 prefilter and 20,000 seeded tail, then merges them in traversal order. Stage two builds disjoint independent shard top sets from the combined four-seed scores and merges the 18,000 leaders. The final 2,000 entries are the first stage-one tail entries not used as leaders. Tail entries outside the bounded prefilter record a `null` stage-one score rank instead of the previous false generated-count rank.

A three-shard-per-stage, 20,000-candidate product validation completed in 2.4 seconds: stage one 1.000 seconds, stage two 1.086 seconds, generated-ID digest `a15c52fe445bf`, canonical provenance digest `1d332df83ca967`. A real stateful-generator test scores real candidates and proves one-process equality for generated provenance, prefilter order, four-seed leader order, and final tail order across uneven shards. The earlier 52,000-candidate bounded validation remains valid evidence for capacity and artifact size.

## Competitive PSRO

Score-only race and confirmation keep matrix telemetry on the full path. Each candidate's complete opponent schedule is now one compact worker unit, so its strategy is interned once and its schedule cannot split across worker messages. On 30 candidates × 4 blocks, four workers took 360ms full and 352ms score-only with identical complete digests. The new batching is 21% faster than the earlier 458ms full measurement. Score-only scaling was 576ms at one worker, 383ms at two, 364ms at four, 517ms at eight, 558ms at ten, and 721ms at fourteen. Four remains the measured local default. Scan-level tests prove full and score-only survivor, finalist, mean, match-count, and bootstrap-interval equality.

## Decision

Use Rust for ordered and Modal goldfish scoring. Keep original TypeScript for reproducibility and lean TypeScript for conformance and environments without the native binary. Keep PSRO two-player matches in TypeScript and use score-only mode only for races and confirmation.

Three post-required Rust experiments completed. Removing per-profile temporary metric vectors had no repeatable wall-time gain (2,838/2,612/2,571ms), a Rayon minimum batch length of 64 regressed to 3,170/3,115/3,059ms, and stack-backed compact profile aggregation was neutral at 2,721/2,561/2,564ms. All three experiments were rejected. The remaining measured cost is simulation logic, and useful local scaling is exhausted at 10 to 14 threads.
