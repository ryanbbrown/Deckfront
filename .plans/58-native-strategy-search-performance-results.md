# Native strategy-search performance results

## Protocol

- Pre-implementation SHA: `e9dd8e8090751c24557b141c2145f70cf31c104a`
- Machine: Apple M4 Pro, 10 performance plus 4 efficiency cores, Node 22.23.1
- Frozen sample: 100,000 of 12,972,960 Kingdom 009 candidates, seed 4,100,000, stationary/chaser/kiter, 30 turns, 200 actions
- Candidate checksum: `93a38dcc12eabd6`
- Ordered score-key digest: `cf175ac2165dbd2`
- Native protocol: `native-goldfish-v1`, Rust 1.98.0
- Final contingency implementation SHA: `08034a48babd866bcc0ad37e1a166090740e5474`

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

The standalone Rust scorer uses integer card IDs, fixed mechanic/value records, per-thread state, Rayon batches, and no string lookup, hash lookup, or heap allocation in the turn loop. The request carries the TypeScript infinite-buy sentinel and first-player health penalty. Rust validates both named constants and starts the candidate at the same first-player health as TypeScript. Zones reserve their maximum trial capacity before the loop. Shuffle, purchase projection, spell damage, movement choices, family targets, discard choices, Cull targets, and action cleanup reuse vectors or fixed stack arrays. Exact conformance covers 1,000 frozen candidates, compact and full output, all current card mechanics, all movement profiles, shuffle output, UTF-16 order, victory/turn/action boundaries, money, damage area, and ranking fields.

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
| Product production `native-0dc22ea4655a-26821587f16d9cfcdabd` | 500,000 | 10 CPU, 8 GiB | $0.281925 | $0.01849660 | 50,000 prefilter, 18,000 leaders, 2,000 tail |
| Final product `native-bcfe75987b75-51f045aad92c5ba9f233` | 500,000 | 10 CPU, 8 GiB | $0.281925 | $0.01035507 | Current validator accepts 50,000 prefilter, 18,000 leaders, 2,000 tail |

The ordered full run used 150,000-candidate shards. Container elapsed time was 22.0–56.5 seconds, with a 41.8-second median. Its merge was observed within 102 seconds of launch, at least 127,000 strategies/s including scheduling. Final launch validation counts the one-core ordered controller: 191 shard cores plus the controller is allowed, while 192 shard cores plus the controller is rejected. Product mode counts only its direct product function.

The production product function completed in 96.237 seconds and used 1,507,672 KiB peak RSS. Its TypeScript coordinator generated the stateful product stream once and sent bounded chunks to one persistent Rust scorer with ten internal threads. Two 250,000-candidate logical shards retained and merged stage-one evidence; stage two used one 50,000-candidate shard. The durable artifact has generated-ID digest `3bb77e906acfbf`, canonical provenance digest `e316ba625ffe4b7`, prefilter digest `b0594ed6a6857d`, leader digest `d972c5ac37f58d`, and tail digest `1a327f9362421`. Every digest equals the local production command.

Durable results are in Modal Volume `hexdeck-native-strategy-results`. Cumulative native-run reservation is $2.20303416 and measured native-run cost is $0.41892662. All three permitted full production runs are used: one ordered-space run and two 500,000-candidate product runs. The final run was required because stronger integrity validation correctly rejected the earlier product artifact. The billing summary is $0.42 metered, -$0.42 credits, and $0 billed. CPU is $0.04730/core-hour, memory is $0.00800/GiB-hour, and volume storage is $0.09000/GiB-month. Every listed native-search app is stopped with zero tasks; older stopped apps have aged out of `modal app list`.

## Bounded staged product path

`npm run staged-goldfish:native-pool` runs the stateful product generator as one accepted-order coordinator and sends bounded chunks to one persistent Rust scorer. Stage one retains independent shard top sets for the 50,000 prefilter and 20,000 seeded tail, then merges them in traversal order. Stage two builds disjoint independent shard top sets from the combined four-seed scores and merges the 18,000 leaders. The final 2,000 entries are the first stage-one tail entries not used as leaders. Tail entries outside the bounded prefilter record a `null` stage-one score rank instead of the previous false generated-count rank. Collision retention is capped at 1,024 global display IDs. The production empty-collision-set path retains `K + 1,024` per shard: at most 1,024 policy drops can precede a global score or seeded-tail survivor, so that shard superset contains the one-process `K`. A forced cross-shard test covers a collision at the prefilter boundary and in the tail and returns the exact one-process policy result.

The command consumes the stateful generator exactly once and includes generation in stage-one and total timing. A 20,000-candidate three-shard run with chunk size 333 completed in 2.800 seconds and a one-shard run with chunk size 1,000 completed in 2.757 seconds. Both returned generated digest `a15c52fe445bf`, canonical digest `1d332df83ca967`, prefilter digest `3cd4e51b3a8d58`, leader digest `9690d53936b4f8`, and tail digest `f5d5de305f46e`.

After seeded-rank precomputation and the zero-tail fast path, the final local 500,000-candidate production run completed in 30.005 seconds: stage one including generation was 25.107 seconds and stage two was 4.185 seconds. Peak RSS was 1,576,730,624 bytes, or 1.468 GiB. Its two stage-one shards and one stage-two shard returned the five established digests. The final Modal run from current HEAD completed in 84.479 seconds with 1,580,184 KiB peak RSS and returned the same five digests. The current validator accepts the downloaded durable artifact. The artifact stores bounded 50,000-entry prefilter identity evidence, bounded 20,000-entry tail evidence, shard digests, and the final reservoir. Fixed and staged reservoir integrity hashes cover source, score summary, every retained rank, and canonical strategy. Mutation tests reject changed score and rank metadata. The validator recomputes evidence digests, verifies unique membership and deterministic tail order with one precomputed seeded rank per entry, derives the exact first 2,000 non-leader tail members, and cross-checks canonical provenance for a single stage-one shard.

## Competitive PSRO

Score-only race and confirmation keep matrix telemetry on the full path. Each candidate's complete opponent schedule is one compact worker unit, so its strategy is interned once and its schedule cannot split across worker messages. Production uses separate defaults: ten goldfish threads and four competitive pairing workers.

The real 1,000-candidate × 1-block race shape measured 3,590ms, 1,963ms, 1,309ms, 1,347ms, 1,440ms, and 1,599ms at 1, 2, 4, 8, 10, and 14 workers. Two repeats gave 4 workers 1,277/1,276ms and 8 workers 1,320/1,258ms; the three-run medians are 1,277ms and 1,320ms. The 1,000-candidate × 8-block shape measured 23,465ms, 11,791ms, 6,139ms, 4,745ms, 4,493ms, and 4,324ms. A 10/14 repeat was effectively tied at 4,711/4,719ms. The first one-block round has the full candidate field and selects the production default, so four pairing workers remain the measured choice. Scan-level tests prove full and score-only survivor, finalist, mean, match-count, and bootstrap-interval equality.

## Verification

The ordered Modal path invokes `scripts/native_ordered_shard_input.ts` inside the image for each contiguous range. The helper uses one hoisted coprime traversal through `representativeCandidateIndices`, the production TypeScript candidate space, canonical serializer, and native request builder. A 150,000-candidate helper run completed in 1.24 seconds and produced candidate digest `9fe884ad1c6025b`, equal to a direct run of the previous `candidateIndexAt` formula. Python only schedules the helper and Rust process. The generation and scoring subprocess budgets sum below the Modal shard timeout, so timeouts can return structured shard failures. Ordered resume validation compares shuffle seeds, movement profiles, requested CPU, and threads with the shard specification. The product function commits `pool.json` to the Volume as soon as its subprocess returns, before it builds the summary. `npm run modal:test` uses the Modal uv environment and covers launch CPU/cost/thread/mode limits, the cumulative $25 and three-full-run caps, cost retries, atomic reservation, duplicate controller claims, mutated scoring settings, interrupted atomic rename, and the actual TypeScript helper fixture.

Plain `npm test` passed 53 files and 579 tests. `npm run verify:native`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run build:sim`, `npm run modal:test` (10 tests), Kingdom 009 write/freshness, and `git diff --check` passed. Multi-seed Rust conformance is exact. The frozen original, lean, and Rust commands all returned candidate checksum `93a38dcc12eabd6` and score digest `cf175ac2165dbd2`. No game or client source file changed.

## Decision

Use Rust for ordered and Modal goldfish scoring. Keep original TypeScript for reproducibility and lean TypeScript for conformance and environments without the native binary. Keep PSRO two-player matches in TypeScript and use score-only mode only for races and confirmation.

Three post-required Rust experiments completed. Removing per-profile temporary metric vectors had no repeatable wall-time gain (2,838/2,612/2,571ms), a Rayon minimum batch length of 64 regressed to 3,170/3,115/3,059ms, and stack-backed compact profile aggregation was neutral at 2,721/2,561/2,564ms. All three experiments were rejected. The remaining measured cost is simulation logic, and useful local scaling is exhausted at 10 to 14 threads.
