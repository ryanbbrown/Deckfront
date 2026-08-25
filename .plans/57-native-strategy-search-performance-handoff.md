# Native strategy-search performance handoff

## Goal

Make strategy generation, movement-aware goldfish scoring, and fixed-reservoir competitive evaluation as fast as practical without changing game behavior. Use repeated profile-and-improve loops. Continue after the known optimizations are complete: profile the remaining runtime, test further speedups, and keep changes that improve measured wall time.

The final path must run efficiently on Google Compute Engine. Ryan will handle interactive cloud setup, credentials, project configuration, and initial connectivity in another session. This work owns the code, Linux build, deterministic sharding, worker use, bounded memory, and commands needed to run efficiently after connection is available.

## Repository state

Start from these commits:

- `48fe48e` — staged goldfish scoring and PSRO evaluation-seed variance
- `24b8366` — ordered goldfish benchmark and baseline results

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

Keep the frozen current-path benchmark available so native and optimized paths can be compared with the original implementation.

### 2. Port the scoring kernel to Rust

Put native code in a clear top-level Rust workspace:

```text
rust/
  Cargo.toml
  goldfish/
    Cargo.toml
    src/
```

Port only the hot deterministic kernel and batch scorer unless profiling justifies a wider port. Keep strategy generation, PSRO control, artifact validation, and reporting in TypeScript.

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

Require exact discrete outcomes and exact integer aggregates. Compare floating values from the same integer totals. Investigate every mismatch; do not hide simulator differences behind broad tolerances.

### 4. Add deterministic parallel and cloud execution

The complete candidate space must be indexable and divisible into independent shards. Each shard must record:

- Candidate range or deterministic traversal positions
- Candidate checksum
- Rule and scorer version
- Shuffle seeds and movement profiles
- Build version
- Timing and machine details
- Local retained candidates and scores

Merging shard results must reproduce one-machine global selection. Keep disk and network output bounded; do not transfer full trial telemetry or every rejected candidate when selection needs only shard leaders.

Provide a Linux x86-64 release build and a simple command that runs one shard on Google Compute Engine. Keep cloud-provider logic thin. Infrastructure provisioning, credentials, SSH, and interactive project setup are outside this handoff.

### 5. Speed up fixed-reservoir PSRO

After the goldfish path is stable, profile and implement the technical PSRO improvements that do not change intended evidence:

- Benchmark worker counts on the actual competitive workload.
- Add score-only race and confirmation execution. Matrix games still retain report telemetry.
- Batch each candidate's opponent schedule into compact worker work instead of repeatedly serializing the candidate and options.
- Rank race survivors with cumulative evidence from completed stages.

Keep the initial 50-strategy matrix unchanged until a separate search-quality experiment approves a change. Treat stronger 4/8/16/32 racing, wider finalist confirmation, and independent closure attacks as search-protocol work that needs its own evidence and decision record.

## Optimization loop

Repeat this loop until the remaining cost is understood and further work has poor expected value:

1. Profile one representative local or cloud run.
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
- Local and cloud thread counts and shard sizes are configurable.
- Independent shards merge deterministically into the same retained set as one process.
- A documented Linux release command runs one Google Compute Engine shard after Ryan supplies access.
- Benchmark records show the speedup for TypeScript optimizations, Rust, local parallelism, and cloud parallelism separately.
- The relevant tests, full test suite, typecheck, lint, `cargo test`, `cargo fmt --check`, `cargo clippy`, and `git diff --check` pass.
- `README.md` contains only the minimum commands needed to build, verify, benchmark, and run a shard.
- Plans and result records describe the current implementation and measured conclusions.
