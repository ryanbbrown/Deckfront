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
| Product smoke `native-0dc22ea4655a-69cc3f90c23b63a4cabe` | 20,000 | 4 CPU, 4 GiB | $0.11613 | $0.00754043 | valid staged artifact, exact local digests |
| Product production `native-0dc22ea4655a-26821587f16d9cfcdabd` | 500,000 | 10 CPU, 8 GiB | $0.281925 | $0.01491667 | 50,000 prefilter, 18,000 leaders, 2,000 tail |

The ordered full run used 150,000-candidate shards. Container elapsed time was 22.0–56.5 seconds, with a 41.8-second median. Its merge was observed within 102 seconds of launch, at least 127,000 strategies/s including scheduling.

The production product function completed in 96.237 seconds and used 1,507,672 KiB peak RSS. Its TypeScript coordinator generated the stateful product stream once and sent bounded chunks to one persistent Rust scorer with ten internal threads. Two 250,000-candidate logical shards retained and merged stage-one evidence; stage two used one 50,000-candidate shard. The durable artifact has generated-ID digest `3bb77e906acfbf`, canonical provenance digest `e316ba625ffe4b7`, prefilter digest `b0594ed6a6857d`, leader digest `d972c5ac37f58d`, and tail digest `1a327f9362421`. Every digest equals the local production command.

Durable results are in Modal Volume `hexdeck-native-strategy-results`. Cumulative native-run reservation is $1.92110916 and measured native-run cost is $0.40499162. Two of three full production runs are used: one ordered-space run and one 500,000-candidate product run. The billing summary is $0.41000000 metered, -$0.41000000 credits, and $0 billed. CPU is $0.04730/core-hour, memory is $0.00800/GiB-hour, and volume storage is $0.09000/GiB-month. All four retained native-search apps are stopped with zero tasks.

## Bounded staged product path

`npm run staged-goldfish:native-pool` runs the stateful product generator as one accepted-order coordinator and sends bounded chunks to one persistent Rust scorer. Stage one retains independent shard top sets for the 50,000 prefilter and 20,000 seeded tail, then merges them in traversal order. Stage two builds disjoint independent shard top sets from the combined four-seed scores and merges the 18,000 leaders. The final 2,000 entries are the first stage-one tail entries not used as leaders. Tail entries outside the bounded prefilter record a `null` stage-one score rank instead of the previous false generated-count rank.

The command consumes the stateful generator exactly once and includes generation in stage-one and total timing. A 20,000-candidate three-shard run with chunk size 333 completed in 2.800 seconds and a one-shard run with chunk size 1,000 completed in 2.757 seconds. Both returned generated digest `a15c52fe445bf`, canonical digest `1d332df83ca967`, prefilter digest `3cd4e51b3a8d58`, leader digest `9690d53936b4f8`, and tail digest `f5d5de305f46e`.

The local 500,000-candidate production run completed in 35.918 seconds: stage one including generation was 30.713 seconds and stage two was 4.092 seconds. Peak RSS was 1,678,082,048 bytes, or 1.563 GiB. Its two stage-one shards and one stage-two shard returned the same five digests as Modal. The artifact stores bounded 50,000-entry prefilter identity evidence, bounded 20,000-entry tail evidence, shard digests, and the final reservoir. The validator recomputes evidence digests, verifies unique membership and deterministic tail order, derives the exact first 2,000 non-leader tail members, and cross-checks canonical provenance for a single stage-one shard.

## Competitive PSRO

Score-only race and confirmation keep matrix telemetry on the full path. Each candidate's complete opponent schedule is one compact worker unit, so its strategy is interned once and its schedule cannot split across worker messages. Production uses separate defaults: ten goldfish workers and four competitive pairing workers. The post-default 30-candidate × 4-block rerun took 403.694ms full and 469.268ms score-only; both returned the same complete 480-match digest. The paired result is noisy but confirms equality and does not change the earlier scaling decision: score-only was 576ms at one worker, 383ms at two, 364ms at four, 517ms at eight, 558ms at ten, and 721ms at fourteen. Scan-level tests prove full and score-only survivor, finalist, mean, match-count, and bootstrap-interval equality.

## Verification

The ordered Modal path invokes `scripts/native_ordered_shard_input.ts` inside the image for each contiguous range. The helper uses the production TypeScript candidate space, canonical serializer, traversal, and native request builder. Python only schedules the helper and Rust process. `npm run modal:test` uses the Modal uv environment and covers cost retries, atomic reservation, duplicate controller claims, corrupt and stale results, interrupted atomic rename, and the actual TypeScript helper fixture.

Plain `npm test` passed 52 files and 575 tests. `npm run goldfish:native-verify`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:sim`, `npm run modal:test`, Kingdom 009 freshness, and `git diff --check` passed. Multi-seed Rust conformance is exact. The frozen original, lean, and Rust commands all returned candidate checksum `93a38dcc12eabd6` and score digest `cf175ac2165dbd2`. No game or client source file changed.

## Decision

Use Rust for ordered and Modal goldfish scoring. Keep original TypeScript for reproducibility and lean TypeScript for conformance and environments without the native binary. Keep PSRO two-player matches in TypeScript and use score-only mode only for races and confirmation.

Three post-required Rust experiments completed. Removing per-profile temporary metric vectors had no repeatable wall-time gain (2,838/2,612/2,571ms), a Rayon minimum batch length of 64 regressed to 3,170/3,115/3,059ms, and stack-backed compact profile aggregation was neutral at 2,721/2,561/2,564ms. All three experiments were rejected. The remaining measured cost is simulation logic, and useful local scaling is exhausted at 10 to 14 threads.
