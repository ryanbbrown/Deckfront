# Native strategy-search performance handoff

## Goal

Make strategy generation, movement-aware goldfish scoring, and fixed-reservoir competitive evaluation as fast as practical without changing game behavior. Use repeated profile-and-improve loops. Continue after the known optimizations are complete: profile the remaining runtime, test further speedups, and keep changes that improve measured wall time.

The final path must run efficiently on Modal. The local Modal CLI is installed, authenticated as profile `ryanburnettebrown`, and ready for unattended use. This work owns the Modal image, Linux build, deterministic sharding, detached execution, retries, worker use, bounded memory, result collection, and cost/concurrency caps. Use Modal functions for CPU fan-out; do not add Google Cloud infrastructure.

## Repository state

Implementation starts from the commit that records this reviewed plan. Its parent state is `29280cc`, which includes:

- `48fe48e` — staged goldfish scoring and PSRO evaluation-seed variance
- `24b8366` — ordered goldfish benchmark and baseline results
- `08f8f80` — the first performance handoff
- `b9c23f7` — the Modal execution revision
- `29280cc` — the authenticated Modal smoke-test record

Do not reset to an older commit. Capture the plan-revision commit as the pre-implementation review base.

Preserve the unrelated uncommitted user edit in `.plans/34-strategy-search-results.md`. Do not stage, overwrite, revert, clean, or commit it.

Read first:

- `AGENTS.md`
- `.plans/55-ordered-goldfish-benchmark.md`
- `.plans/56-ordered-goldfish-benchmark-results.md`
- `.plans/51-staged-goldfish-multi-seed-results.md`
- `.plans/54-fixed-reservoir-psro-seed-variance-results.md`
- `src/sim/simulationKernel.ts`
- `src/sim/goldfish.ts`
- `src/server/goldfishWorker.ts`
- `src/sim/orderedGoldfishBenchmark.ts`
- `scripts/ordered_goldfish_benchmark.ts`
- `src/sim/fixedReservoirPsro.ts`
- `src/sim/pairingRunner.ts`

## Frozen TypeScript benchmark

Run:

```bash
npm run goldfish:ordered-benchmark -- --limit 100000 --workers 10 --shuffles 1
```

The provisional benchmark space is intentionally separate from the final product generator:

- Kingdom: `deep-beam-tuning-009`
- Empty starting build
- Five ordered, unique, finite purchase rungs
- No infinite fallback
- First three quantities range from 1 through 4
- Last two quantities are fixed at 3
- Total planned quantity is at most 15
- 240,240 ordered skeletons
- 54 quantity vectors
- 12,972,960 complete candidates
- Fixed representative traversal checksum for 100,000 candidates: `93a38dcc12eabd6`

Baseline on the Apple M4 Pro:

| Workers | Scoring time | Strategies per second | Trials per second |
|---:|---:|---:|---:|
| 4 | 37.592s | 2,660 | 7,980 |
| 10 | 21.817s | 4,584 | 13,751 |
| 14 | 22.201s | 4,504 | 13,513 |

Use the same candidates, shuffle seed, three movement profiles, 30-turn limit, and 200-action cap for every comparable benchmark. Record machine details, build mode, worker count, generation time, scoring time, throughput, memory, and checksums. Repeat short benchmarks when noise could change a decision.

A Modal smoke test completed successfully with no interactive approval. Two concurrent containers each requested 4 CPUs and 4 GiB, ran the current 5,000-candidate TypeScript benchmark, exited zero, and returned checksum `6c8cf0ecf228f`. Container totals were 5.51s and 6.60s; successful Modal wall time including setup was 48.53s. The image must include Modal's Python runtime as well as Node 22. Production sharding remains untested.

## Required work

### 1. Tighten the TypeScript baseline

Profile before and after each optimization. Cover all known opportunities:

- Add a lean goldfish scoring path. Compute only ranking inputs during the trial. Avoid `positionsByTurn`, per-card purchase maps, per-card damage maps, full damage-by-turn arrays, and other trial output that movement-aware ranking does not use.
- Generate and score candidates in chunks. Keep memory bounded for the full candidate space.
- Retain only the score keys and candidates needed for selection. Avoid returning millions of full nested score objects to the main thread.
- Make worker count and chunk size configurable.
- Benchmark the actual goldfish workload across useful local worker counts. Do not apply pairing-worker scaling conclusions to goldfish without measurement.
- Reduce worker serialization. Send compact candidate data once per batch and return compact score data.
- Use compiled workers when startup or TypeScript loader overhead is measurable. Do not optimize startup when simulation dominates.

Keep the frozen current-path benchmark available behind `--scorer original|lean|rust`. First add a deterministic digest over every ranking key for the fixed 100,000 candidates; the candidate checksum alone cannot detect a wrong scorer. Re-measure the original path with digest work enabled and use that result as the optimization baseline while retaining the earlier no-digest table as historical evidence.

The lean scorer has two outputs. Conformance mode returns every original `MovementAwareGoldfishScore` field. Production mode returns the strategy reference and the compact ranking key: `worstCompletions`, `totalCompletions`, `worstPenalizedTurnsTo50`, `totalPenalizedTurnsTo50`, `worstDamageArea`, `totalDamageArea`, `totalMoneySpent`, strategy ID, and the collision tie key. Prove full-field lean equality with the original scorer first. Then prove compact-mode ranking, leaders, and seeded tail equal full-field lean. Include victory, turn-limit, and action-cap damage-area padding.

Profile the turn loop as well as its output. In particular, measure eager `pilotView` construction, repeated purchase projections, hand scans, temporary sets and arrays, and tactical-agent allocation. Use pull-based small chunks so workers dynamically claim more work instead of waiting for one expensive static partition. Fold candidate and score digests in traversal order after reordering worker replies, never in completion order. Hoist the coprime traversal configuration and advance the index arithmetic progression directly instead of recomputing the GCD and BigInt formula for every candidate.

### 2. Port the scoring kernel to Rust

Put native code in a clear top-level Rust workspace:

```text
rust/
  Cargo.toml
  goldfish/
    Cargo.toml
    src/
```

Port only the hot deterministic kernel and batch scorer unless profiling justifies a wider port. The port includes the behavior used by `simulationKernel.ts`, `tacticalPilot.ts`, `positionValue.ts`, and purchase-plan helpers. Keep strategy generation, PSRO control, artifact validation, and reporting in TypeScript.

Use a standalone Rust shard executable as the first integration boundary. Give it a versioned compact input containing the rule fingerprint, scorer version, kingdom card data, strategies, seeds, movement profiles, and limits. Return compact score keys and structured errors. Start with a clear line-delimited format for conformance and replace it with a binary format only when profiling shows serialization matters. Rust is in scope only for goldfish trials and batch scoring. Two-player matches and PSRO remain TypeScript paths.

TypeScript or Modal owns shard scheduling; Rust owns threads inside one shard. Run one Rust process per Modal function input, set `max_inputs=1`, and set Rust threads to the integer CPU request. Reject a thread count above that request. Do not wrap Rust with Node workers. Build the executable inside the Linux image with pinned Rust `1.98.0` for `x86_64-unknown-linux-gnu`; never copy the macOS ARM binary. Keep Python and Node 22 in the image for Modal control and TypeScript conformance, although production shard scoring invokes only Rust.

Build the Rust hot loop around compact data:

- Integer card identifiers
- Fixed-size arrays and enums
- Reused buffers
- No string lookup, hash map, JSON parsing, or heap allocation inside the turn loop
- Deterministic seeded shuffle and game behavior
- Thread-local simulation state
- Parallel batches with configurable threads

A literal Rust translation is only a checkpoint. Continue toward a data-oriented implementation while conformance remains green.

### 3. Prove TypeScript and Rust conformance

Create deterministic cross-language fixtures that cover:

- Every relevant card mechanic and movement profile
- Fixed strategies and shuffle seeds
- Completion, turns, damage area, final damage, spending, and ranking fields
- Edge cases near the turn and action limits
- Candidate ordering and tie-breaking
- Exact seeded shuffle output before full-game comparison

Require exact discrete outcomes and exact integer aggregates. Compare floating values from the same integer totals. Investigate every mismatch; do not hide simulator differences behind broad tolerances. Keep the original full-trial function; add the lean scorer beside it until equivalence is proved.

Use one explicit UTF-16 code-unit comparator in TypeScript and Rust for card IDs, strategy IDs, and canonical strategy text. Rust compares `encode_utf16()` units. Replace `localeCompare` in shared selection and ported hot paths before Rust parity. Prove that the new comparator has the same sign as the current `localeCompare` for every current card-ID pair and every fixed fixture tie, and rerun the frozen original scorer digest and kernel/pilot tests. Current identifiers are ASCII; if a future identifier breaks this guard, UTF-16 order remains canonical and the protocol version must change.

A strategy ID remains the existing compact display ID. Canonical strategy text is the collision key and the final comparator key after strategy ID. Distinct canonical strategies with one display ID are ranked deterministically, then the lower-ranked duplicate display ID is dropped. Apply this policy in fixed and staged selection and both validators. A shard record carries display ID, canonical strategy, and traversal position. Merge shard records in ascending traversal position before ranking; never concatenate in completion order.

### 4. Add deterministic Modal execution

First make the provisional ordered benchmark indexable and divisible into independent contiguous traversal-position shards. This path measures throughput and scorer parity; it does not define the product reservoir. Each shard must record:

- Candidate range or deterministic traversal positions
- Candidate and score-key digests folded in traversal order
- Rule fingerprint and scorer version
- Shuffle seeds and movement profiles
- Build version
- Timing, requested CPU, actual concurrency, and container identity
- Structured success or failure

Build a small Python Modal launcher around the standalone shard command. Use an explicit image, configurable CPU and shard sizes, bounded `max_containers`, per-shard timeouts, and at most two retries per shard. Detached launch starts one remote controller that owns fan-out and merge, so a local disconnect cannot stop the job. Persist shard results under deterministic IDs with temporary-file plus atomic-rename writes. Skip a result only after validating its schema, shard range, complete count, candidate and score digests, rule fingerprint, scorer version, and build version. Corrupt, partial, stale, or mismatched results run again.

Enforce cost before launch. Use the current Modal CPU and memory rates and calculate worst-case cost as all shard attempts, including retries, running for the full timeout. The launcher rejects aggregate allocation above 192 physical CPU cores, a run above its explicit `--max-cost-usd`, cumulative reserved ledger spend above $25, or more than three full-candidate-space runs. A full run defaults to a $5 maximum. Reserve projected cost atomically in a durable local ledger before launch; resume uses the existing run entry and cannot reserve or launch a second copy of a valid shard.

The product generator remains one ordered coordinator stream. It uses the existing stateful `SeededRandom`, canonical-strategy duplicate filter, and accepted-candidate order, then sends bounded chunks for scoring. Independent workers never generate product candidates. The streaming output must match the sequential generator's accepted count, collision decisions, generated-ID digest, and canonical provenance digest for each tested seed and chunk size.

The staged product merge has two global stages. Stage one scores 500,000 generated candidates on one seed and retains the best 50,000 by movement-aware score plus the best 20,000 by deterministic tail rank. Stage two scores the 50,000 prefilter survivors on the remaining three seeds, combines disjoint-seed evidence, retains 18,000 leaders, then takes the first 2,000 stage-one tail entries not used as leaders. Per-shard retention uses those global bounds, so merging shard top sets is sufficient. Merge in traversal order, then apply the explicit score and tail comparators and collision policy. Prove equality with one-process selection for the generated digest, prefilter order, leader order, and tail order.

Replace unbounded `generatedIds` artifacts with a bounded version that stores generated count, streaming generated-ID digest, canonical provenance digest, duplicate and display-ID-collision counts, retained candidates, scoring protocol, and shard provenance. Update both fixed and staged validators to validate this contract without reconstructing every generated ID. Old artifacts are not a compatibility requirement. Test uneven and empty final shards, duplicate canonical strategies, display-ID collisions, score ties, seeded-rank collisions, corrupted checkpoints, retry de-duplication, and atomic writes.

Provide one unattended Modal command that builds the Linux image, launches or resumes the job, and reports durable result locations. Modal credentials and billing are already configured; the code must not require browser approval during a run.

### 5. Speed up fixed-reservoir PSRO

After the goldfish path is stable, profile and implement the technical PSRO improvements that do not change intended evidence:

- Benchmark worker counts on the actual competitive workload. Deliberately revisit the current 16-worker guard before using larger Modal CPU allocations.
- Add score-only race and confirmation execution. Matrix games still retain report telemetry. On fixed seeds, prove identical block order, scores, aborts, match counts, survivors, finalist order, means, and intervals against the full path.
- Batch each candidate's opponent schedule into compact worker work instead of repeatedly serializing the candidate and options.

Keep the initial 50-strategy matrix unchanged until a separate search-quality experiment approves a change. Cumulative race evidence, stronger 4/8/16/32 racing, wider finalist confirmation, and independent closure attacks are search-protocol work. Give them a separate protocol version, plan, experiment, and decision record rather than mixing them into performance work.

## Optimization loop

Repeat this loop until the remaining cost is understood and further work has poor expected value:

1. Profile one representative local or Modal run.
2. Name the largest measured cost.
3. Make one focused change.
4. Run conformance and verification.
5. Repeat the benchmark enough to distinguish improvement from noise.
6. Keep the change only when it improves the target workload or enables better scaling.
7. Record the result and choose the next bottleneck.

Explore additional speedups after the required items. Useful branches include data layout, allocator pressure, buffer reuse, work scheduling, thread pinning, shard size, release compiler settings, profile-guided optimization, and cheaper deterministic serialization. Let measurements choose the branch.

## Completion criteria

The work is complete when all of these are true:

- The original TypeScript benchmark remains reproducible.
- The optimized TypeScript and Rust scorers pass cross-language conformance.
- Full candidate generation and scoring use bounded memory.
- Local and Modal thread counts, CPU requests, container caps, and shard sizes are configurable.
- Independent shards merge deterministically into the same 50,000 prefilter, 18,000 leaders, and 2,000 seeded tail as one process.
- The sequential product generator and every streaming chunk size have the same accepted-candidate order, collision decisions, and provenance digests.
- Bounded fixed and staged artifact validators do not store every generated ID.
- One documented unattended Modal command builds the Linux image and launches or resumes a durable run without browser approval and enforces retries, aggregate CPU, run cost, cumulative spend, and full-run limits.
- Benchmark records show the speedup for TypeScript optimizations, Rust, local parallelism, and Modal parallelism separately.
- The relevant tests, full test suite, typecheck, lint, `cargo test`, `cargo fmt --check`, `cargo clippy`, and `git diff --check` pass.
- `.gitignore` excludes `/rust/target/`, Python `__pycache__/`, and local virtual environments before the first native or Modal build.
- `README.md` gains the minimum commands needed to build, verify, benchmark, and run a shard while retaining the context needed to understand the project.
- Plans and result records describe the current implementation and measured conclusions.
