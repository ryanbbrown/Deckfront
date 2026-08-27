# Global Matrix and PSRO runtime

Status: implementation plan after custom review-panel v1.

This plan implements the Matrix and PSRO parts of `.html/strategy-search-process-optimization.html` after resolving the blockers in `.reviews/custom/strategy-search-process-optimization/strategy-search-process-optimization-synthesis-v1.md`. It supersedes `.plans/72-psro-performance-architecture.md`. It extends the runtime in `.plans/74-scalable-strategy-search-runtime.md`; it does not replace the exact Goldfish format, reducer, publication, or identity rules from that plan.

## Goal

Make Matrix and PSRO use the campaign's global Modal worker pool instead of one four-core Matrix container and one eight-core PSRO container per kingdom.

One controller schedules all ready Goldfish, Matrix, PSRO, and reduction work. A kingdom advances when its own dependency completes. The controller does not wait for other kingdoms.

## Fixed scientific rules

The runtime can change task layout. It cannot change these results:

- Goldfish keeps full-range stage-one streams and the exact 500,000 then 20,000 reducers.
- The initial Matrix has 50 strategies, 1,275 upper-triangle cells, 125 seed ordinals, and both orientations per seed.
- The initial equilibrium uses ordinals 1 through 75. Matrix evidence keeps all 125 ordinals and gameplay telemetry in canonical cell and seed order.
- PSRO starts only after the full 125-seed Matrix artifact validates. This implementation does not add an early P75 artifact.
- Screening uses cumulative depths 8, 16, 32, 64, 128, 256, and 512 with an anytime confidence sequence at alpha 0.05.
- Confirmation uses fresh cumulative depths 400, 800, 1,600, 3,200, and 6,400. Its per-candidate alpha is `0.05 / familySize`, where `familySize` is the fixed number of provisional candidates from the completed screen.
- Confirmation requires the lower confidence bound to be strictly greater than 0.51. Rejection uses an upper bound at or below 0.51.
- Queue retests use fresh queue-retest seeds and the same fixed-family Bonferroni rule.
- Each candidate's score bytes stay in schedule order. Confidence calculations see the same ordered prefixes as the serial implementation.
- One confirmed response is admitted at a time. Each admission adds a 75-seed row and column, solves the deterministic maximum-support equilibrium, and retests the remaining queue.
- Any unresolved screen, confirmation, or queue retest makes the kingdom `terminal-incomplete`. It does not increment the clean-search count.
- Two consecutive complete searches with no confirmed response finish the kingdom. An admission resets the clean-search count.

## Capacity model

`maxActiveCpus` limits running scientific worker and reducer cores. The controller and serialized publisher use separate control cores. Reports show worker cores, submitted cores, controller cores, and publisher cores separately.

One controller owns all worker-capacity tokens. No Matrix or PSRO coordinator can spawn work outside this admission path. The sum of running Goldfish, Matrix score, Matrix reduction, PSRO score, admission-row score, and PSRO reduction cores must not exceed `maxActiveCpus`.

Use four-core score workers. Existing measurements show that one larger threaded Matrix or PSRO process has little gain above four to eight workers. Fan-out comes from independent score tasks, not a larger process.

Create tasks from semantic work until the estimated task time is between 15 and 60 seconds. Use measured games per CPU-second, candidate count, and new schedule blocks. Group many tiny Matrix cell ranges or admission-row ranges into one task. Do not create one task for each pair or seed range.

Keep a bounded ready window. Store the complete deterministic partition descriptor, but materialize only enough unlaunched jobs to keep two worker-pool waves ready. Refill the window after task transitions. This bound applies to 1, 30, and 160 kingdoms.

Priority order is:

1. a small reduction or decision task that releases a blocked stage;
2. ready PSRO and Matrix score work, round-robin by kingdom;
3. Goldfish reduction;
4. Goldfish score work.

If downstream work is ready, reserve capacity for at least one Goldfish score task when that task fits. Round-robin ordering prevents one kingdom or stage from starving another.

## Matrix module

Deepen `src/sim/strategySearchMatrix.ts` so its interface covers deterministic partitioning, score-task input, chunk validation, and final reduction.

1. Build and publish the validated Matrix manifest after the reservoir validates.
2. Enumerate the canonical 1,275 cells and 125 seed ordinals.
3. Partition contiguous canonical Matrix jobs into four-core task groups sized for 15 to 60 seconds. Runtime groups do not enter scientific identity.
4. Each score worker reads the manifest and evaluates its assigned nonoverlapping jobs. It returns seed records with exact ordinals and complete acquisition telemetry.
5. Each worker writes one validated immutable runtime chunk to a launch-scoped temporary path. The publisher moves it to the deterministic task path and records a receipt.
6. The Matrix reducer starts after all score-task receipts validate. It rejects missing, duplicate, overlapping, stale, or corrupt cell and ordinal evidence.
7. The reducer sorts by row index, column index, and seed ordinal, builds schema-4 evidence, solves the deterministic equilibrium, validates the final artifact, and publishes it once.
8. Retry or resume runs only missing score tasks. Matrix reduction can rerun from published score chunks.

Do not start PSRO from a partial Matrix. The full artifact remains the source bound by Matrix SHA-256, manifest hash, and evidence hash.

## PSRO module

Move the adaptive scientific transition logic behind one small interface in a new `src/sim/strategySearchParallelPsro.ts` module. The interface accepts a validated semantic checkpoint plus validated score chunks and returns one of:

- score-task descriptors for the next screen, confirmation, or queue-retest look;
- admission-row Matrix task descriptors;
- a complete checkpoint;
- a `terminal-incomplete` checkpoint.

The module, not the Modal controller, owns candidate order, schedules, confidence decisions, family size, admission order, equilibrium changes, clean-search state, and terminal status. The existing local serial command must use the same transition module or compare against it through a parity adapter. Do not duplicate the scientific rules in Python.

For each look:

1. Freeze the equilibrium, candidate list, full schedule, suffix schedule, family size, alpha, threshold, and look identity in a validated descriptor.
2. Partition only contiguous candidate ranges. Size ranges from candidate count times new schedule blocks so the expected four-core task takes 15 to 60 seconds. Materialize a bounded two-wave ready window.
3. Each score worker evaluates its candidate range in candidate-major and schedule-block order. It publishes quarter-point score bytes, played counts, schedule ordinals, and telemetry as one `RawPsroScoreChunk`.
4. A reduction task validates complete, nonoverlapping candidate coverage and assembles chunks in candidate order. It appends suffix scores to prior ordered scores before it calls the existing confidence implementation.
5. Publish the sealed look and semantic checkpoint atomically before the next look becomes ready.
6. Screening must finish for the whole kingdom before confirmation starts because confirmation alpha needs the final provisional family size.
7. At the evidence cap, any unresolved candidate produces `terminal-incomplete`.
8. Admission-row score work uses the same global worker queue and deterministic publication rules. After row reduction and the equilibrium solve, queue retest work returns to the same look path.
9. The final schema-3 PSRO artifact contains semantic looks and checkpoint state only. Runtime ranges, task IDs, call IDs, retries, timings, and chunk paths stay outside final identity.

A task retry loads and validates an existing deterministic chunk first. A valid receipt completes without simulation. A missing or invalid chunk reruns only that task. Controller takeover uses the existing fence and rejects stale completions.

## Runtime and Modal changes

- Extend the runtime job model with Matrix manifest, Matrix score, Matrix reduce, PSRO decision, PSRO score, admission-row score, and admission-row reduce stages. Keep final Matrix and PSRO task identities stable at the evidence level.
- Replace the current monolithic `strategy_search_downstream_job` Matrix and PSRO paths with four-core score workers and small reducer or decision workers.
- Let the controller add bounded dynamic jobs after validated stage transitions. Persist the transition and new task identities in one fenced state write before launch.
- Keep launch-scoped temporary files, worker-side validation, serialized publication, three retryable attempts, terminal startup errors, and stale-fence rejection.
- Store durable Matrix and PSRO chunks until the whole kingdom has a final validated completion receipt. Clean temporary inputs only after that receipt.
- Add reducer admission limits for memory and Volume I/O. A reducer that does not fit waits with an explicit utilization reason instead of starting and competing with another heavy reducer.
- Record queue delay, worker runtime, publication wait, reduction time, decision time, barrier latency, running and submitted worker CPUs, retry cost, bytes, and Modal cost by stage and kingdom.
- Keep the image and scientific allowlists exact. Runtime-only scheduler and Modal changes alter deployment identity. Scientific transition or evidence-format changes alter scientific identity.

## Failure and resume checks

Tests must cover:

- a lost Matrix score worker;
- a lost PSRO score worker after earlier chunks completed;
- controller loss before and after a transition state write;
- reducer failure and restart from published chunks;
- corrupt, overlapping, missing, duplicate, and stale chunks;
- stale completion after a new fence;
- interruption between temporary validation, rename, Volume commit, and receipt write;
- terminal startup error versus retryable worker error;
- unresolved candidates producing `terminal-incomplete` and never a clean search;
- resume launching only missing work and producing byte-identical final evidence.

## Local acceptance checks

1. Scheduler tests prove the global worker cap, bounded ready window, round-robin fairness, Goldfish progress, reducer admission, dynamic task insertion, and exact unused-CPU reasons.
2. Matrix integration tests use at least two materially different group sizes, shuffled completion order, and injected retries. Final schema-4 bytes must be identical to the serial reference.
3. PSRO integration fixtures compare every screen, confirmation, admission, queue-retest, clean-search, and terminal transition with the serial path. Final schema-3 bytes must be identical across candidate chunk sizes and completion orders.
4. Tests prove that confidence receives the same candidate-major ordered score prefixes, that confirmation waits for the completed screen family, and that all strict 0.51 boundaries match.
5. Modal tests run real controller state transitions with fake external calls. They prove global capacity accounting and resume behavior through the production seam, not only private helpers.
6. Repository verification passes: focused tests, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:native`, `npm run modal:test`, and `git diff --check`.

## Paid smoke checks

Use only kingdom IDs from `src/sim/balance-smoke-suite-manifest.json`.

### One kingdom

Run `balance-tuning-005` with `maxActiveCpus: 400` through Goldfish, Matrix, PSRO, download, and all deep validators.

Pass conditions:

- final status is complete, not `terminal-incomplete`;
- every downloaded artifact validates;
- timed campaign work completes in less than 20 minutes;
- Matrix and PSRO each launch more than one score worker and exceed the old one-kingdom ceilings of 4 Matrix cores and 8 PSRO cores when enough ready work exists;
- running worker CPUs never exceed 400;
- every unused worker CPU-second has one recorded reason;
- the report includes stage barrier latency and retry cost.

### Three kingdoms in parallel

Run one campaign containing `balance-tuning-007`, `balance-tuning-009`, and `balance-tuning-010` with `maxActiveCpus: 400`. These IDs differ from the one-kingdom smoke so the campaign cannot pass by reusing that result.

Pass conditions:

- all three kingdoms complete Goldfish, Matrix, PSRO, download, and deep validation;
- work from at least two kingdoms overlaps after Goldfish begins, and Matrix or PSRO score work from different kingdoms overlaps when dependencies permit;
- the global running-worker peak exceeds 120 CPUs during a declared bulk window unless the report proves fewer than 120 useful cores were ready under the 15-second minimum task rule;
- running worker CPUs never exceed 400;
- no kingdom waits for a cross-kingdom stage barrier;
- retries rerun only missing work;
- final reports include per-kingdom completion time, campaign makespan, stage throughput, barrier latency, utilization reasons, bytes, retries, and actual Modal cost.

Do not run the 30- or 160-kingdom campaign. The three-kingdom smoke proves the parallel campaign path without authorizing those larger paid runs.

## Implementation order

1. Add failing scheduler, Matrix parity, PSRO transition parity, and failure-resume tests at production interfaces.
2. Add dynamic stage and bounded-ready-window state to the scheduler and launch bundle.
3. Implement distributed Matrix score tasks and reduction. Prove byte parity locally.
4. Extract the PSRO transition module and keep the serial path green.
5. Implement distributed PSRO score, reduction, admission-row, and queue-retest tasks. Prove transition and byte parity locally.
6. Replace the monolithic Modal downstream path, update allowlists, operator status, reports, `README.md`, `docs/strategy-search-process.md`, and `docs/strategy-search-campaign-operator.md`.
7. Run the full local verification set and commit a clean smoke candidate.
8. Run and validate the one-kingdom paid smoke.
9. Run and validate the three-kingdom paid smoke.
10. Run exactly one implementation review-panel cycle against the recorded pre-implementation SHA. Resolve required findings with the same writer and rerun affected validation. Do not run a second review cycle.

## Stop conditions

Stop and report the exact blocker if:

- distributed evidence differs from the serial reference;
- an unresolved result can become a clean search;
- a stale or corrupt chunk can enter final evidence;
- running worker CPUs can exceed `maxActiveCpus`;
- a retry repeats completed scientific work without a documented corrupt artifact;
- the one-kingdom smoke takes 20 minutes or more;
- either smoke ends incomplete or fails deep validation;
- Modal capacity prevents the required worker fan-out.
