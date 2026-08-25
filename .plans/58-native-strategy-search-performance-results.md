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
| Rust release | 10 | 466ms | 4,071ms | 24,562 | 150 MiB |

All three final paths returned the same candidate and score digest. Rust was 2.92× faster than the digest-enabled original path and used about one eighth of its peak RSS. The lean TypeScript path was 3.3% faster than original in the full sample. The earlier no-digest table remains historical evidence in plan 56.

## Optimization loops

1. The measured action-loop cost was eager pilot-view purchase projection and output allocation. Discard projections now exist only during a pending discard; Cull ownership scans now exist only with Cull in hand; lean trials omit per-turn, position, and per-card output. Kernel parity and lean full-field conformance stayed exact.
2. Hoisting tactical mechanic sets was tested twice on 5,000 candidates. Results were 1,469ms and 1,672ms versus 1,425ms before the change. The change was rejected.
3. A compiled esbuild worker was tested on 5,000 candidates. Runs were 1,309ms and 1,456ms. The benefit was mainly lower startup overhead and less loader work, so the compiled worker was retained. The remaining TypeScript cost is the tactical decision loop; Rust made further TypeScript restructuring poor expected value.

The standalone Rust scorer uses integer card IDs, fixed mechanic/value records, per-thread state, Rayon batches, and no string or hash lookup in the turn loop. Exact conformance covers 1,000 frozen candidates, compact and full output, all current card mechanics, all movement profiles, shuffle output, UTF-16 order, victory/turn/action boundaries, money, damage area, and ranking fields.

## Modal

Rates used before launch were $0.0473/core-hour and $0.008/GiB-hour. No GPU or Sandbox was used.

| Run | Range | Allocation | Worst-case reservation | Metered cost | Result |
|---|---:|---|---:|---:|---|
| Smoke `native-b8e4d9fefcdd-f2517b502539f2bc84ae` | 1,000 | 2 × 4 CPU, 4 GiB | $0.0668 | $0.01095 | 2/2 shards, exact local shard digests |
| Full `native-b8e4d9fefcdd-da77b7a513d41a6d483e` | 12,972,960 | max 48 × 4 CPU, 4 GiB | $1.4562 | $0.37159 | 87/87 shards, 48 containers, complete merge |

The full run used 150,000-candidate shards. Container elapsed time was 22.0–56.5 seconds, with a 41.8-second median. The merge was observed within 102 seconds of launch, at least 127,000 strategies/s including scheduling. All apps were stopped after result collection. Cumulative native-run reservation was $1.5231; measured native-run cost was $0.3825. The month summary showed $0.3846 total ephemeral-app metered cost, $0.00 billed after credits. One of three permitted full-space runs was used.

Durable results are in Modal Volume `hexdeck-native-strategy-results` under the two run IDs. The full merge records 12,972,960 complete candidates, build `b8e4d9fefcdd`, rule fingerprint `b5115138db0`, scorer `native-goldfish-v1`, and 87 contiguous shard ranges.

## Competitive PSRO

Score-only race and confirmation keep matrix telemetry on the full path. On the fixed short workload, full and score-only digests were identical. Four workers took 458ms full and 434ms score-only, a 5.7% wall-time reduction. Score-only worker scaling on 12 candidates × 2 blocks was 257ms at 4 workers, 426ms at 10, and 631ms at 16. Four remains the measured local default. The worker guard now allows an explicit maximum of 192 for measured Modal allocations.

## Decision

Use Rust for ordered and Modal goldfish scoring. Keep original TypeScript for reproducibility and lean TypeScript for conformance and environments without the native binary. Keep PSRO two-player matches in TypeScript and use score-only mode only for races and confirmation.
