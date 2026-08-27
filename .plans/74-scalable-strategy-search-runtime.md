# Scalable strategy-search runtime

Status: approved after plan review v1.

This plan supersedes `.plans/73-thirty-kingdom-strategy-search-campaign.md`. It is a clean runtime and artifact redesign. It does not import, resume, repair, or preserve compatibility with paused-campaign state or campaign schema v1.

## Goal

Build one general command that accepts this strict request:

```json
{
  "kingdomIds": ["one-or-more-registered-kingdom-ids"],
  "maxActiveCpus": 800
}
```

The command derives every evidence constant and all other runtime policy. It runs each kingdom through Goldfish, Matrix, and PSRO. Capacity controls only scheduling. It never changes per-kingdom evidence identity or final evidence bytes.

The authorized paid acceptance run uses `deep-beam-tuning-007` as request input, not as a code default, with `maxActiveCpus` from 400 through 800. It must complete Goldfish, Matrix, PSRO, download, and deep validation in less than 20 minutes. Implementation review starts only after this smoke passes.

## Scope boundaries

In scope:

- arbitrary nonempty lists of registered kingdom IDs;
- one required runtime capacity setting, `maxActiveCpus`;
- globally pooled Goldfish work with per-kingdom Matrix and PSRO dependencies;
- atomic retries, fenced exactly-once publication, deterministic reduction, performance telemetry, and deep final validation;
- campaign request schema 2, Goldfish artifact schema 4, Matrix artifact schema 4, and PSRO artifact schema 3;
- one authorized paid K007 acceptance run.

Out of scope:

- importing or reusing paused-campaign files, checkpoints, hashes, call IDs, or state;
- source-repair and compatibility adapters for the paused campaign;
- a paid multi-kingdom or 30-kingdom run;
- balance reports and analytics;
- removing unrelated standalone legacy artifact validators and their tests.

## Interface, launch authorization, and defaults

Replace the current manifest-plus-selection interface with one Zod-strict request containing only `kingdomIds` and `maxActiveCpus`. Reject empty, duplicate, or unknown IDs, unsafe integers, capacities below the smallest derived whole-stage shape, and unknown fields.

The CLI supports `plan`, `run`, and `status` against the request. Remove campaign `resume-plan`, `resume`, source-repair, and operator assertion recovery commands. `plan` is read-only and prints an authorization token. `run` requires that token before its first paid call. The token binds the exact ordered kingdom evidence IDs, request list, source identity, and `maxActiveCpus`; it prevents an accidental multi-kingdom launch. `status` cannot enqueue work.

The new path does not use `GROSS_BUDGET_USD`, `MAX_FULL_RUNS`, the cumulative reservation ledger, or any historical campaign allowance. It reports a cost estimate and actual Modal cost but does not claim to verify an external workspace budget. This user authorization covers one K007 request from 400 through 800 CPUs only.

Derived defaults:

- execution is Modal for `run`; fixture adapters remain test-only;
- Volume is `hexdeck-native-strategy-results`;
- local downloads use `.data/strategy-search/<campaign-execution-id>`;
- campaign execution ID is the hash of the ordered per-kingdom evidence IDs;
- controller timeout and shutdown margin derive from the stage budgets below;
- container concurrency derives from admitted Modal calls and the CPU policy; there is no user-supplied container limit.

Changing `maxActiveCpus` for the same request reconfigures concurrency in the existing execution. It does not create new kingdom evidence or alter an established runtime partition.

## Semantic identity

Use two identity levels:

1. A per-kingdom evidence ID contains only scientific inputs and final artifact-format inputs. It does not contain the campaign list, capacity, worker resources, task ranges, worker count, task count, timings, Modal call IDs, retry history, Matrix chunks, or PSRO runtime chunks.
2. A campaign execution ID contains the ordered requested kingdom evidence IDs. It references per-kingdom artifacts but does not own their identity.

Store final artifacts under the per-kingdom evidence ID. A second campaign list that contains the same evidence ID validates and reuses the complete kingdom directly, without importing campaign state.

Use the same four versioned Goldfish seeds for every kingdom. Do not derive different seeds per kingdom. Derive Matrix and PSRO namespaces from fixed versioned protocol constants. Derive the candidate space from registered kingdom data and fail at plan time unless every requested kingdom produces exactly 12,972,960 candidates.

The source identity hashes the exact executable image context, not every tracked file. Refactor the Modal image definition to copy and hash an explicit allowlist: package and lock files, TypeScript/build configuration needed at runtime, imported `src/sim` sources, invoked strategy-search scripts, Rust manifests and sources, and `modal/native_strategy_search.py`. Plans, docs, tests, UI files, reviews, data, build output, and secrets are excluded. Image construction and identity use the same file list and fail closed on a missing, dirty, extra, or changed executable file.

## Goldfish execution model

### Runtime policy and partitions

Replace canonical evidence shards with runtime jobs. A job is one contiguous candidate-position range for one Goldfish stage. Range, CPU allocation, call ID, timing, and output path are execution data, not evidence data.

A pure execution-policy module derives job CPU shape, range size, whole-stage resources, and concurrency from:

- `maxActiveCpus`;
- candidate count and remaining work;
- a versioned bootstrap performance profile from `.plans/58-native-strategy-search-performance-results.md`;
- measured candidate throughput from completed jobs in this execution;
- Modal admission successes and explicit workspace-limit rejections.

The bootstrap profile is general scorer calibration, not campaign evidence. It starts with the measured four-CPU, 150,000-candidate shape, then derives a smaller range only when needed to expose useful parallel work while keeping expected job duration between 15 and 60 seconds. The policy never contains a kingdom ID, kingdom count, fragment count, campaign CPU total, or paused-work value. A low capacity that cannot fit Matrix or PSRO fails at plan time with the exact required capacity.

A stage partition is created once and pinned in execution state before launches. Capacity changes alter only admission concurrency. Completed and active ranges remain unchanged. The scheduler may repartition only a contiguous suffix for which no launch intent or artifact has ever existed, and records that runtime-only decision. Different fresh executions and test layouts may use different partitions and must produce identical final bytes.

Stage one can use hundreds of jobs for one kingdom when useful. The scheduler globally pools all ready jobs from all kingdoms. Ready Matrix and PSRO work starts as soon as that kingdom's prior final artifact validates; there is no cross-kingdom barrier. Bounded Goldfish admission remains guaranteed while downstream work stays continuously ready.

### Compact full-range job output

Each stage-one runtime job:

1. generates every candidate in its range once;
2. scores each candidate once for the first seed and three movement profiles;
3. emits every candidate in the range once to one immutable sorted compact score file;
4. seals a small deterministic header and commits only a launch-scoped temporary artifact.

There is no local top-K pruning. Full-range emission is required for layout-independent global retention when jobs are smaller than 500,000. The compact binary record is fixed width and versioned. It contains traversal position, all primitive profile metrics needed to reconstruct score evidence, and the fixed normalized display-ID bytes needed for UTF-16 comparison. It does not contain full strategy JSON or operational fields. Canonical strategies are reconstructed only for display-ID collision groups and globally retained positions.

Before Modal work, benchmark the format with 12,972,960 synthetic records. Record exact bytes per record, total stage-one intermediate bytes, encode/decode throughput, and reducer read volume. If the measured design cannot satisfy the I/O gate, redesign it before paid work.

After all stage-one jobs validate, one reducer performs a k-way merge over sorted compact streams. It verifies exact nonoverlapping coverage and file checksums. It applies the existing canonical order: score evidence, UTF-16 display ID, canonical strategy for display-ID collisions, then traversal position. It rejects duplicate canonical strategies and duplicate display IDs before retention.

The reducer keeps exactly 500,000 unique stage-one records. Jobs retain the existing bounded 1,024 collision overflow in compact form only when needed; exhausting that allowance fails closed instead of silently changing membership. A cutoff collision spanning jobs and a tie group spanning jobs must match the reference reducer.

The reducer streams the final schema-4 top-500,000 artifact once in canonical stage-one rank order. Fixed binary records contain only traversal position and primitive profile metrics. Record order supplies rank. Strategy JSON, canonical strategy, display ID, and ranking keys are reconstructed from traversal position. The artifact does not contain combined four-seed ranks 20,001 through 500,000.

Stage two splits the selected top 500,000 into 15-to-60-second candidate-seed jobs and reads each fixed-width range directly. Each job scores its selected candidates once for the remaining three seeds and emits immutable sorted compact results. Its reducer combines all four seeds, applies the same uniqueness and comparator rules, and streams the final schema-4 top-20,000 reservoir once. Matrix identity binds the semantic reservoir identity and content, not runtime part hashes.

A retained candidate is written a bounded number of times: once in a compact score stream for each required scoring stage, once in the final top-500,000 artifact, and once in the top-20,000 artifact when retained there. The pipeline never rereads and rewrites a growing 500,000-record set.

### Independent correctness oracle

Add a small trusted reference path separate from the compact encoder and k-way reducer. It uses the existing direct candidate generator and scorer fixture, stores ordinary in-memory records, applies `compareStageOneRecords`, `compareRankedRecords`, the duplicate policy, and one-process retention. Frozen expected score evidence and membership come from the existing direct semantic fixture, not from the new compact pipeline.

For bounded fixtures, compare compact stage-one membership, combined ranks, reservoir membership, and exact final bytes with this reference. Also run the compact pipeline with materially different job sizes, reduction fan-in, completion orders, and worker counts. This proves both semantic parity and layout independence.

## Publication, retries, and fencing

Use launch-scoped temporary Volume paths. Workers may commit these untrusted temporary bytes, but they cannot publish a deterministic task artifact.

A serialized artifact publisher owns the complete critical section:

1. validate the global per-evidence task lease, controller fence, launch intent, temporary hash, and deterministic task identity;
2. validate compact or stage bytes;
3. atomically rename temporary files to the deterministic task path;
4. commit the Volume;
5. persist the completion receipt before releasing publication ownership.

Batch ready publications when possible so one serialized call and Volume commit can publish several completed jobs. The per-evidence lease is shared across campaign executions. Concurrent campaigns requesting the same kingdom either join the current owner or validate the same completed receipt; they cannot publish competing bytes.

Scientific task bytes are a pure function of kingdom evidence ID, stage, and semantic candidate positions. Timings, call IDs, container identity, ranges-as-scheduler-state, and retry history live in sibling operational records. An identical retry produces identical task bytes. A valid artifact plus receipt completes without work; a receipt without matching bytes or conflicting bytes fails closed.

A worker claims its task lease before scoring. The fixed lease exceeds every bounded worker timeout, so workers do not heartbeat or commit control state. An unbound launch intent is safe to retry only after its task lease expires. A stale orphan may finish computation, but the publisher rejects it; no duplicate evidence can commit. Failures rerun the whole small job. Goldfish has no continuous checkpoint and no aggregate rewrite.

Preserve refencing on controller takeover and repair of newly completed schema-2 execution tasks. Remove old source-repair/import operations. Replace explicit ambiguous-launch recovery with lease-expiry retry plus exactly-once publisher tests.

## Matrix and PSRO

Keep current scientific protocols and per-kingdom dependency behavior. Whole-stage resources derive from the same capacity policy and measured useful worker ranges instead of fixed Modal decorators. Initial budgets are:

- Goldfish, including reduction but excluding final writes: 6 minutes;
- Matrix: 5 minutes;
- PSRO: 7 minutes;
- final writes, download, and deep validation: 2 minutes.

These are acceptance budgets, not evidence. Exceeding the total 20 minutes fails the smoke even if evidence is correct.

Remove runtime topology from scientific identities and final bytes:

- Matrix chunk size, worker count, batch size, timing, and checkpoint paths are runtime-only. The final schema-4 Matrix artifact serializes canonical cells, seed ordinals, telemetry, and equilibrium sources in fixed semantic order.
- Matrix seeds depend on the semantic reservoir identity and canonical content.
- PSRO final look identity contains semantic candidate order, schedule ordinals, seeds, scores, and decisions. Runtime candidate chunks and chunk hashes stay in operational checkpoint records.
- Deterministic reducers place Matrix and PSRO data in semantic order before final serialization.

Matrix and PSRO retain atomic partial work for a new execution. They do not import old results. `terminal-incomplete` PSRO is not accepted by the paid smoke.

## Performance accounting

Every Goldfish job and reducer records nonoverlapping monotonic phases:

- candidate generation;
- scoring;
- local intermediate serialization and reads;
- temporary Volume write and commit;
- publisher wait and publication commit;
- reduction compute;
- final top-500,000 writing;
- final top-20,000 writing;
- orchestration and queue delay.

The accounting invariant is: phase milliseconds sum to measured task elapsed milliseconds within 1%, with no phase overlap. The intermediate-I/O gate is:

```text
sum(local intermediate read/write + temporary Volume write/commit + publication commit
    + reducer intermediate reads)
/
sum(generation + scoring + intermediate I/O + reduction compute)
< 0.05
```

Both sums use aggregate task wall milliseconds across Goldfish jobs and reducers. They exclude queue delay, orchestration, downstream stages, and mandatory final artifact writing. Report final-writing time separately. Also report campaign critical-path wall time so concurrency cannot hide slow publication.

For each scheduler interval, `allocatedCpus + unusedCpus = maxActiveCpus`. Assign every unused CPU to exactly one reason using this precedence: Modal/workspace rejection, active failure or retry backoff, reserved ready downstream work, minimum useful job size, insufficient ready work, final tail. Report interval duration and CPU-seconds per reason. A one-kingdom request may correctly report insufficient ready work after useful Goldfish parallelism ends.

`status` and the final operational report show stage wall time, peak and average active CPUs, CPU utilization, candidate throughput, bytes read and written, I/O ratio, final-write time, admission failures, retries, task count, and actual Modal cost.

## Acceptance checks

1. Strict request tests reject empty, duplicate, unknown, implicit, and extra fields; every registered kingdom passes identity and candidate-count contracts.
2. Pure scheduler tests prove arbitrary kingdom counts, global CPU accounting, capacity-floor errors, bounded Goldfish progress, per-kingdom downstream release, changed-capacity behavior, and exact under-utilization accounting.
3. Goldfish integration fixtures prove every candidate position is generated and scored once per required stage on success, failed jobs rerun only themselves, and scientific job bytes contain no operational data.
4. The independent reference fixture proves scoring, tie order, duplicate handling, stage-one membership, combined rank, and reservoir membership.
5. Reducer fixtures force display-ID and canonical collisions at the retention cutoff and across jobs. Different layouts and randomized completion order produce byte-identical final files.
6. The 12,972,960-record synthetic benchmark measures compact bytes, I/O, single-read reduction, no growing-set rewrite, and bounded retained-record writes.
7. Fencing tests cover takeover during publication, unbound intent expiry, artifact-without-receipt, receipt-without-artifact, identical republish, conflicting bytes, and two concurrent campaigns requesting the same evidence ID.
8. A campaign superset recognizes and skips a complete matching kingdom by per-kingdom evidence ID.
9. Matrix fixtures at different runtime chunk sizes and PSRO fixtures at different candidate chunks produce byte-identical final scientific evidence.
10. Repository verification passes: focused tests, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:native`, `npm run modal:test`, and `git diff --check`.
11. A clean committed K007 request runs through Goldfish, Matrix, PSRO, download, and deep validation in less than 20 minutes with `maxActiveCpus` from 400 through 800. Intermediate Goldfish I/O is below 5%. The report records actual peak CPUs, utilization reasons, bytes, stage times, final-write time, tasks, and cost.

Implementation review starts only after check 11 passes. One successful implementation-review cycle completes the task.

## Implementation order

1. Replace the request, authorization, executable-source identity, semantic identity, artifact path, and runtime-policy model. Add contract tests.
2. Add compact full-range score encoding and validation. Run the synthetic format benchmark before Modal work.
3. Add the trusted reference path, deterministic reducers, uniqueness policy, and streaming schema-4 Goldfish artifacts. Prove parity and layout-independent bytes.
4. Replace static Goldfish task creation with pinned dynamic partitions, the global queue, changed-capacity handling, and utilization accounting.
5. Add task leases, launch-scoped temporary artifacts, the serialized batched publisher, refencing, idempotent receipts, and concurrency tests.
6. Remove runtime topology from Matrix schema 4 and PSRO schema 3 identities and final bytes. Derive their runtime resources and add parity tests.
7. Replace the CLI/operator surface and remove paused-campaign source-repair/import code and tests. Keep unrelated standalone legacy validators green.
8. Update `README.md`, `docs/strategy-search-process.md`, and `docs/strategy-search-campaign-operator.md`.
9. Move plan 73 to `.plans/archive/73-thirty-kingdom-strategy-search-campaign.md` and add a banner that names this plan as its replacement. Leave plans 71 and 72 active as protocol/performance evidence.
10. Run all local verification and commit a clean smoke candidate.
11. Launch the authorized K007 request directly through `bb terminal-job run`. Do not launch a multi-kingdom campaign.
12. After the smoke passes in less than 20 minutes, run the one requested implementation review against the recorded pre-implementation SHA. Resolve required findings and rerun affected validation without starting another review cycle.

## Stop conditions

Stop before implementation review and report a blocker if:

- the K007 smoke takes 20 minutes or more or ends terminal-incomplete;
- intermediate Goldfish I/O is 5% or more;
- final bytes differ across tested layouts;
- actual capacity is materially unused without one exclusive recorded reason;
- publication fencing or idempotence fails;
- the full local verification set fails.
