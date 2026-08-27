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
- A candidate that remains unresolved at a fixed look cap stays unresolved. It is not confirmed, does not block confirmation of provisional responses, and does not make the search incomplete.
- Two consecutive completed searches with no confirmed response finish the kingdom, even when capped candidates remain unresolved. An admission resets the clean-search count.
- Missing, corrupt, interrupted, or failed evidence remains incomplete. Scientific uncertainty is not an operational failure.

## Capacity model

`maxActiveCpus` limits running scientific worker and reducer cores. The controller and serialized publisher use separate control cores. Reports show worker cores, submitted cores, controller cores, and publisher cores separately.

One controller owns all worker-capacity tokens. No Matrix or PSRO coordinator can spawn work outside this admission path. The sum of running Goldfish, Matrix score, Matrix reduction, PSRO score, admission-row score, and PSRO reduction cores must not exceed `maxActiveCpus`.

Use four-core score workers. Existing measurements show that one larger threaded Matrix or PSRO process has little gain above four to eight workers. Fan-out comes from many independent score tasks, not a larger process.

Wall time is the primary objective. Choose Matrix and PSRO task counts from measured scoring throughput and coordination cost, bounded by `maxActiveCpus`. Use 200 requested worker CPUs as the first production experiment and upper target, not a required minimum. Do not impose a minimum task duration that limits useful fan-out. Keep containers warm across adjacent looks so smaller tasks do not pay a cold start each time. Use smoke evidence to lower or raise the target when that reduces total wall time.

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
3. Partition canonical Matrix work into four-core task groups with an adaptive concurrency target. The first production target is up to 200 requested worker CPUs. Runtime groups do not enter scientific identity. Reassemble records by canonical cell and seed ordinal, independent of completion order.
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
- a complete checkpoint.

Missing, corrupt, failed, or interrupted work stops before a scientific transition is complete and remains an operational failure.

The module, not the Modal controller, owns candidate order, schedules, confidence decisions, family size, admission order, equilibrium changes, clean-search state, and terminal status. The existing local serial command must use the same transition module or compare against it through a parity adapter. Do not duplicate the scientific rules in Python.

For each look:

1. Freeze the equilibrium, candidate list, full schedule, suffix schedule, family size, alpha, threshold, and look identity in a validated descriptor.
2. Partition candidate and contiguous schedule-block ranges into four-core tasks using measured scoring and coordination costs. The first production target is up to 200 requested worker CPUs. Materialize a bounded two-wave ready window. A smaller surviving candidate set can split its new schedule suffix into contiguous block ranges to preserve useful fan-out.
3. Each score worker evaluates its assigned candidate and schedule-block range in candidate-major and schedule-block order. The reducer reassembles each candidate's bytes in schedule order. Each worker publishes quarter-point score bytes, played counts, schedule ordinals, and telemetry as one validated runtime chunk.
4. A reduction task validates complete, nonoverlapping candidate coverage and assembles chunks in candidate order. It appends suffix scores to prior ordered scores before it calls the existing confidence implementation.
5. Publish the sealed look and semantic checkpoint atomically before the next look becomes ready.
6. Screening must finish for the whole kingdom before confirmation starts because confirmation alpha needs the final provisional family size.
7. At an evidence cap, preserve unresolved decisions and continue the protocol. After screening, confirm provisional responses. After confirmation or queue retest, admit only confirmed responses. Unresolved candidates do not block a clean search.
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
- unresolved candidates staying recorded without blocking confirmation or a clean search;
- resume launching only missing work and producing byte-identical final evidence.

## Local acceptance checks

1. Scheduler tests prove the global worker cap, high-concurrency Matrix and PSRO partitions for abundant work, bounded ready windows, round-robin fairness, Goldfish progress, reducer admission, dynamic task insertion, and exact unused-CPU reasons. Tests must not make 200 CPUs a hard minimum.
2. Matrix integration tests use at least two materially different group sizes, shuffled completion order, and injected retries. Final schema-4 bytes must be identical to the serial reference.
3. PSRO integration fixtures compare every screen, confirmation, admission, queue-retest, clean-search, and terminal transition with the serial path. Final schema-3 bytes must be identical across candidate chunk sizes and completion orders.
4. Tests prove that confidence receives the same candidate-major ordered score prefixes, that confirmation waits for the completed screen family, that unresolved candidates remain nonterminal, and that all strict 0.51 boundaries match.
5. Modal tests run real controller state transitions with fake external calls. They prove global capacity accounting and resume behavior through the production seam, not only private helpers.
6. Repository verification passes: focused tests, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run verify:native`, `npm run modal:test`, and `git diff --check`.

## Paid smoke checks

Use only kingdom IDs from `src/sim/balance-smoke-suite-manifest.json`.

### One kingdom

Run `balance-tuning-005` with `maxActiveCpus: 400` through Goldfish, Matrix, PSRO, download, and all deep validators.

Pass conditions:

- final status is complete; unresolved scientific decisions are preserved in the final evidence;
- every downloaded artifact validates;
- the report records timed campaign work without turning elapsed time alone into an incomplete scientific result;
- Matrix and production-size PSRO looks use substantial measured parallelism and do not collapse to the old 36-CPU ceiling when abundant work exists;
- the report records per-look task count, requested and running CPUs, worker duration distribution, queue or admission delay, coordination and reduction time, and total wall time;
- running worker CPUs never exceed 400;
- every unused worker CPU-second has one recorded reason;
- the report includes stage barrier latency and retry cost.

### Three kingdoms in parallel

Run one campaign containing `balance-tuning-007`, `balance-tuning-009`, and `balance-tuning-010` with `maxActiveCpus: 400`. These IDs differ from the one-kingdom smoke so the campaign cannot pass by reusing that result.

Pass conditions:

- all three kingdoms complete Goldfish, Matrix, PSRO, download, and deep validation;
- work from at least two kingdoms overlaps after Goldfish begins, and Matrix or PSRO score work from different kingdoms overlaps when dependencies permit;
- Matrix and PSRO bulk windows use the concurrency target supported by the one-kingdom timing evidence, without exceeding the global cap;
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
- an unresolved result is dropped, relabelled as confirmed, or omitted from final evidence;
- a stale or corrupt chunk can enter final evidence;
- running worker CPUs can exceed `maxActiveCpus`;
- a retry repeats completed scientific work without a documented corrupt artifact;
- either smoke ends incomplete because required work or evidence failed, rather than because a valid candidate decision stayed unresolved or an arbitrary elapsed-time gate fired;
- either smoke fails deep validation;
- Modal capacity prevents the required worker fan-out.
