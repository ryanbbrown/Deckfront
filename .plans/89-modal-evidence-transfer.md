# Modal evidence transfer: kingdom Goldfish containers and parallel downloads

Status: reviewed implementation plan (`.reviews/plans/modal-evidence-transfer/`, round v1; synthesis applied).

## Goal

Two runtime changes. No scientific file changes. Every evidence ID stays the same.

1. Goldfish-only route v2. Each kingdom runs as two container tasks. The stage-one rows for all 12,972,960 candidates stay on the container's local disk. Only `top-500000.hgf` and `reservoir.hgf` reach the Volume.
2. Modal client transfers. PSRO downloads, Goldfish final downloads, and PSRO status use bounded parallel Volume reads. Client timeouts scale with the kingdom count.

## Measured problem

Sources: `.data/starfire-12-balance-88/modal-psro/d6b0497a…/report.json`, `.data/strategy-search-goldfish/3be529ac…/report.json` (16 kingdoms), `.data/strategy-search-goldfish/db5cddb9…/report.json` (14 kingdoms).

- PSRO: 254 s of compute for 30 kingdoms, then a 525 s download of 1,690 files and 1.43 GB, one file at a time. A regression over the 60 Goldfish artifact downloads gives 264–402 ms per file plus about 18 ms per MiB. 1,690 × 0.30 s is 500 s: the download is latency bound. The local `download` command timeout is 600 s; the `status` command timeout is 120 s, and `status` reads three Volume files for every attempt, including complete ones. At 130 kingdoms both commands exceed their timeouts.
- Goldfish: controller wall 919 s and 1,177 s; CPU utilization 26% and 21%. A 16-core score task does 14–17 s of work, waits 2.3 s in the Modal queue, then waits 17–33 s (p50 32 s in the second run) between worker finish and controller finish. The controller loop is single-threaded: poll, `publish-batch` (one serialized publisher that reloads the Volume, hashes every temporary file, renames, and commits twice), `prepare-launch-batch` (commit), spawn, `execution-save` (commit). Slots stay allocated until publication. Average score-one concurrency was 9.1 of 31 possible containers. Reduce-one waited a mean of 75 s and 112 s (max 229 s) after its last score task.
- Bytes per kingdom: written 830 MB (stage one) + 32 MB (stage two) + 32 MB (top) + 2.5 MB (reservoir); read 830 + 128 + 32 MB. Each stage-one temporary is read three times (worker hash, Rust `verify`, publisher hash) before the reducer reads it. The 12,472,960 loser rows (798 MB, 96%) are transport only. `evidence/<id>/tasks/` is never deleted: about 0.86 GB per kingdom stays on the Volume.
- Mathematics: `compare_metrics` (`rust/goldfish/src/reservoir.rs:370`) is a strict total order that ends in lower strategy number, so the top-500,000 set and its best-first order are unique for every partition layout. `reduce-one` validates kind, seeds, fingerprint, exact contiguous coverage, row order, and CRC while it streams (`reservoir.rs:1057`). Plan 77 tests prove byte identity across three layouts.
- Local reference (2026-08-30, release binary `6fd370ba…`, the Starfire binary): one-range `score-one` plus `reduce-one` for `balance-tuning-005` on 8 local threads produced both finals byte-identical to the Modal 31-partition evidence. Wall 229 s: scoring 211.6 s (about 7,660 candidates per core-second locally; the 16-core Modal containers measured about 2,240), `reduce-one` 3.2 s from local disk against 18–20 s through the Volume mount.

## Decisions

- D1. Route `goldfish-only-v2` replaces v1. The v1 partition, score-window, and reducer-materialization code leaves the Goldfish-only route. The full campaign route keeps its own `goldfish-one` and `goldfish-two` stages and is out of scope.
- D2. Two tasks per kingdom keep the stage names `goldfish-one-reduce` and `goldfish-two-reduce`. Publisher validation kinds, `goldfish-evidence-finalize`, `goldfish-evidence-complete`, and the 30 existing kingdoms' `goldfishCompletion` receipts on the Volume are keyed by those names. The job modes are `kingdom-one` (`score-one` over `[0, 12972960)` then `reduce-one`, artifact `top-500000.hgf`) and `kingdom-two` (`score-two` over `[0, 500000)` then `reduce-two`, artifact `reservoir.hgf`). Task IDs use `taskIdentity(evidenceId, stage, null)`; the Python `_strategy_search_goldfish_task_id` produces the same string for `range = None`.
- D3. Container shape: `workerCores` from 16 to 64, memory 8,192 MiB, 3 attempts. The `kingdom-one` task timeout is `300 + ceil(13000 / workerCores)` seconds, computed with integer arithmetic `300 + (13000 + workerCores - 1) div workerCores` in both languages: 1,113 s at 16 cores, 707 s at 32, 504 s at 64. The 13,000 core-seconds are twice the stage-one scoring cost at 2,000 candidates per core-second; the 300 s cover reduce, copy, validation, and commit. The `kingdom-two` timeout is 300 s.
- D4. Local scratch is `/tmp/hexdeck-goldfish/<launchId>/`. The job removes it in `finally`. It fails fast before any Rust command when free space is below 2 GiB and records the free bytes in its result.
- D5. The container does not run `verify --kind stage-one` on the 830 MB file; `reduce-one` validates it while streaming. Publisher validation of the finals is unchanged: `verify --kind top` and `verify --kind reservoir --top`.
- D6. Downloads use a thread pool of 16 over the blocking `Volume.read_file`. Each file makes one attempt plus up to three retries with delays of 1, 2, and 4 s on any error except `FileNotFoundError`. The byte count must equal the expected size: `FileEntry.size` from `listdir` for PSRO files, and the production sizes 32,000,064 (`64 + 500000 × 64`) and 2,480,064 (`64 + 20000 × 124`) bytes for the two Goldfish finals. Modal SDK 1.5.4 `read_file` is one `VolumeGetFile2` RPC plus 8 MiB block GETs; Modal's own `modal volume get` runs 128 concurrent file downloads and 64 concurrent RPCs (`modal/cli/_download.py`), so 16 is conservative. The SDK version is not pinned (`uv tool run --from modal`); `package.json` is on both allowlists and must not change.
- D7. PSRO `download` lists every kingdom, downloads all files through one pool into per-kingdom temporary directories beside the destinations, then replaces each destination: `shutil.rmtree(destination)` when it exists, then `os.replace(temporary, destination)`. Replacement is atomic per kingdom, not per batch. A download failure removes every temporary directory and raises before any replacement. A failure inside the replacement loop leaves already replaced kingdoms complete and later kingdoms unchanged, removes the remaining temporary directories, and raises. Every `download` re-downloads every complete kingdom; there is no unchanged-kingdom skip.
- D8. PSRO `status` reads the Volume only for attempts that are not complete in local state: `lease.json` only when `callId` is null, `progress.json` for pending attempts, `job-report.json` when the poll reports complete. A complete attempt reports its stored `result` as `jobReport`; a complete attempt without a stored `result` reads `job-report.json` from the Volume. One pool worker handles one attempt and returns a row; the main thread applies every update and writes the state file once at the end.
- D9. Client timeouts in `scripts/strategy_search_psro_modal.ts`: status `120 s + 1 s × attempts`; download `600 s + 10 s × kingdoms`. Exported pure functions with tests; the adapter uses them.
- D10. New module `modal/volume_download.py` holds the shared fetch helpers. It defines no Modal app and is on no allowlist. `modal/strategy_search_psro_runtime.py` has no container function and imports it at module level. `modal/strategy_search_runtime.py` runs `read_startup` in a `control_image` container that has no sibling modules, so it imports the helper inside `_download_final_artifacts` only.
- D11. Worst-case cost for v2 in TypeScript and Python, equal to six decimals: `N × 3 × [cost(workerCores, 8192, timeoutOne + 30) + cost(workerCores, 8192, 330)] + cost(1, 2048, maxWallSeconds + 60) + cost(1, 8192, maxWallSeconds) + cost(1, 2048, 180) + cost(1, 4096, 120) + cost(0.25, 512, maxWallSeconds + 90)` with `cost(cpu, mib, s) = s × (cpu × 0.0000131 + mib / 1024 × 0.00000222)`. For one kingdom and 3,600 s this is about $1.20 at 16 cores, $1.60 at 32 cores, and $2.42 at 64 cores. The route hard cap stays $100, so one request holds about 70 kingdoms at 32 cores or 45 at 64 cores.
- D12. Publication lease. `prepare-launch-batch` grants `leaseMs = (max task timeoutSeconds in the batch + 600) × 1000`, and the task config carries the same value, because no worker heartbeats and `publish-batch` rejects an expired lease. After a controller restart with a new owner, a live lease of a dead task blocks its re-launch until the lease expires.
- D13. The bundle sets `maxReducerMemoryMiB = maxKingdomContainers × 8192`, so the controller's reducer admission check never blocks a kingdom task. No controller scheduling change.
- D14. Controller report: `scientificStageWallMs` and `report_stages` use the two v2 stage names; scored candidates for v2 jobs come from `result["rustReports"]["score"]["rowCount"]` (12,972,960 for `kingdom-one`, 500,000 for `kingdom-two`), added to the ranged counts that the full route still uses.
- D15. The readiness canary keeps mode `score-one` over `[0, 1)`; the single-command job path stays for `score-one`, `score-two`, `reduce-one`, and `reduce-two`.

## Changes

### `src/sim/strategySearchGoldfishModal.ts`

- Remove `candidatesPerScoreTask`, `partitionsFor`, `initialJob`, `scoreArtifactPath`, the score and reducer constants, and the partition imports. Keep `taskIdentity` and the `RuntimeJob` type.
- Add `GOLDFISH_MODAL_ROUTE = 'goldfish-only-v2'`, `GOLDFISH_MODAL_MIN_WORKER_CORES = 16`, `GOLDFISH_MODAL_KINGDOM_MEMORY_MIB = 8192`, `GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS = 300`, and `goldfishKingdomOneTimeoutSeconds(workerCores)` per D3.
- Request schema: `workerCores` 16..64; `maxActiveCpus >= workerCores`.
- `resourceShape`: `{ workerCoresPerContainer, maxActiveCpus, maxKingdomContainers, maxScheduledCpus, unusedCpuCapacity, kingdomMemoryMiB }`.
- Task counts `{ kingdomOne: N, kingdomTwo: N, total: 2N }`; cost per D11.
- Execution plan hash input: `{ route, request, deploymentDigest, orderedEvidenceIds, resourceShape, costGuard }`.
- Bundle: `partitions: {}`; per kingdom, task A (`goldfish-one-reduce`, `range: null`, `cpu: workerCores`, `memoryMiB: 8192`, `timeoutSeconds: timeoutOne`, `dependencyTaskIds: []`, artifact `evidence/<id>/goldfish/top-500000.hgf`, job `cpus: workerCores`, status `ready`) and task B (`goldfish-two-reduce`, same shape, `timeoutSeconds: 300`, `dependencyTaskIds: [A]`, artifact `evidence/<id>/goldfish/reservoir.hgf`, status `blocked`).
- Controller fields: `route`, `maxActiveCpus`, `timeoutSeconds`, `maxWallSeconds`, `pollIntervalSeconds: 1`, `volumeName`, `readyWindowWaves: 2`, `maxReducerMemoryMiB`, `goldfishWorkerCores`, `goldfishKingdomMemoryMiB`, `goldfishKingdomOneTimeoutSeconds`, `goldfishKingdomTwoTimeoutSeconds`, `executionPlanHash`, `costGuard`.
- Plan summary: `taskCounts`, `resourceShape`, `timeouts: { maximumScientificWallSeconds, kingdomOneTaskSeconds, kingdomTwoTaskSeconds }`.

### `scripts/strategy_search_goldfish_modal.ts`

- `createGoldfishOperatorReport` sets `route: GOLDFISH_MODAL_ROUTE` and maps only the two v2 stage keys in `scientificStageWallMs`.

### `modal/native_strategy_search.py`

- Constants per D3 and D4 and a `_strategy_search_goldfish_kingdom_one_timeout(worker_cores)` function; remove the v1 score and reducer constants that become unused. `_strategy_search_materialize_goldfish` keeps its literal defaults for the full route.
- `_strategy_search_validate_goldfish_only_bundle`: route `goldfish-only-v2`; exact request fields; `workerCores` 16..64; `maxActiveCpus >= workerCores`; wall and cost bounds; controller fields equal to the constants and functions, and `maxReducerMemoryMiB == (maxActiveCpus div workerCores) × 8192`; `partitions == {}`; exactly two jobs and two tasks per kingdom in request order with the expected stages, task IDs equal to `_strategy_search_goldfish_task_id(evidence_id, stage, None)`, `range None`, `job["cpus"]` and `task["cpu"]` equal to `workerCores`, memory, timeouts, dependencies, artifact paths, job statuses `ready` and `blocked`, and a kingdom-to-evidence mapping that matches the ordered evidence IDs; counts `{kingdomOne, kingdomTwo, total}`; cost guard fields and value equal to `_strategy_search_goldfish_worst_case_cost`.
- `_strategy_search_goldfish_worst_case_cost(request, task_counts)`: D11 with `round(…, 6)`.
- `_strategy_search_task_config`: when `bundle["controller"]["route"] == GOLDFISH_MODAL_ROUTE`, `goldfish-one-reduce` gets `mode: kingdom-one` and `goldfish-two-reduce` gets `mode: kingdom-two` plus `topPath: evidence/<id>/goldfish/top-500000.hgf`. The existing manifest branch stays for the full route. `leaseMs` per D12.
- Controller `prepare-launch-batch` call: `leaseMs` per D12.
- `strategy_search_goldfish_job`: dispatch on `config["mode"]`. New `_strategy_search_goldfish_kingdom_stage(config)`:
  1. `volume.reload()`, record `workerStartedEpochMs` and a monotonic start, create scratch, check free space (D4).
  2. Run the score command (`--start`, `--end`, `--threads config["cpu"]`, `--out <scratch>/stage.hgs`, `--report <scratch>/score.json`), then the reduce command (`--inputs <scratch>/inputs.json` listing the local stage file, `--out <scratch>/<final>`, `--report <scratch>/reduce.json`). `kingdom-two` passes `--top <Volume top path>` to both. Each command runs through `_strategy_search_run_subprocess(command, {**config, "timeoutSeconds": remaining})` where `remaining = max(1, timeoutSeconds - elapsed)`.
  3. Copy the final to `_strategy_search_path(config["temporaryPath"])`, then `validated_sha256 = _strategy_search_sha256(output)`, `_strategy_search_validate_publication(config, output)`, `volume.commit()`.
  4. Timing: `modalWorkerElapsedMs` is the monotonic wall of the whole job body from step 1 through the commit; `queueMs = max(0, workerStartedEpochMs - enqueuedEpochMs)`; `elapsedMs = modalWorkerElapsedMs + queueMs`. Phases: `scoringMs = score.scoringMs`; `intermediateSerializationAndReadMs = score.readMs + score.writeMs + reduce.readMs`; `reductionComputeMs = reduce.reduceMs`; `finalTop500000WriteMs` (`kingdom-one`) or `finalTop20000WriteMs` (`kingdom-two`) `= reduce.writeMs`; `temporaryVolumeWriteCommitMs` = copy plus commit; `orchestrationQueueMs = elapsedMs - (sum of the other phases)`, which must not be negative; `phases["elapsedMs"] = elapsedMs`. The controller's phase-sum check stays.
  5. Return `elapsedMs`, `workerFinishedEpochMs`, `checkpointCount: 0`, `modalWorkerElapsedMs`, `sha256`, `validatedSha256`, `phases`, `workerStartedEpochMs`, `temporaryPath`, `rustReports: {score, reduce}`, and `scratchFreeBytes`.
  6. Remove scratch in `finally`.
- Controller report per D14. Nothing else changes; with empty partitions `_strategy_search_materialize_goldfish` is a no-op and the `first_goldfish` reorder finds no score job.

### `modal/volume_download.py` (new)

- `fetch_file(volume, remote, local, expected_size, sleep=time.sleep) -> {bytes, wallMs, attempts}`: streams `volume.read_file(remote)` into `local`, retries per D6, raises on a size mismatch.
- `fetch_files(volume, items, concurrency=16) -> list[dict]`: `ThreadPoolExecutor(max_workers=concurrency)`; results keep item order; the first exception propagates after the pool drains.

### `modal/strategy_search_psro_runtime.py`

- `download(config)`: D7 through `fetch_files`. Result: `artifacts` (per file: `kingdomId`, `path`, `relative`, `bytes`, `wallMs`), `kingdoms` (per kingdom: `kingdomId`, `files`, `bytes`, `wallMs`), `bytes`, `wallMs`, `concurrency`.
- `status(state_file)`: D8.

### `modal/strategy_search_runtime.py`

- `_download_final_artifacts` uses `fetch_files` with concurrency 16 and the two expected sizes, and keeps the per-artifact `{evidenceId, path, bytes, wallMs}` entries and totals. The import is inside the function (D10).
- `_final_artifact_relatives` recognizes `goldfish-only-v2`.

### `scripts/strategy_search_psro_modal.ts`

- Exported pure functions `psroStatusTimeoutMs(attemptCount)` and `psroDownloadTimeoutMs(kingdomCount)` per D9, used by the adapter.

### Tests

- `test/sim/strategySearchGoldfishModal.test.ts`: the fixture request becomes 32 cores at 512 CPUs (a fixture update, not a weakened assertion); request bounds (15 and 65 cores rejected, 16 and 64 accepted); shapes at 512 CPUs give 32, 16, and 8 containers for 16, 32, and 64 cores; two tasks per kingdom with the stage names, `range: null`, dependencies, artifact paths, memory, `cpus`, `cpu`, statuses, and timeouts 1,113 / 707 / 504 s; `partitions` empty; `maxReducerMemoryMiB = containers × 8192`; exact worst-case cost for one kingdom at 16, 32, and 64 cores and rejection below the bound; evidence IDs equal across shapes and equal to `deriveStrategySearch`; execution IDs differ across shapes; authorization binds cores; the bundle contains no Matrix or PSRO text; `createGoldfishOperatorReport` returns route v2 and the two stage keys.
- `test/sim/strategySearchPsroModal.test.ts`: the two timeout functions.
- `modal/test_native_strategy_search.py`: v2 validation accepts a bundle in the TypeScript shape and rejects non-empty partitions, a score stage, a third task per kingdom, a wrong task ID, a wrong job status, a kingdom-to-evidence mismatch, wrong `cpus`, `cpu`, memory, timeouts, dependencies, or artifact paths, a cost mismatch, and 15 cores; worst-case cost equals the TypeScript value for the same request at 16, 32, and 64 cores (fixture values); `_strategy_search_materialize_goldfish` changes nothing for empty partitions; task config yields `kingdom-one` and `kingdom-two` with `topPath` and the D12 lease; the `prepare-launch-batch` lease for a v2 batch is at least `(timeoutOne + 600) × 1000`; the kingdom job with a fake subprocess runs score then reduce with an inputs manifest that names the local stage file, passes `--threads` equal to cpu, passes `--top` to both `kingdom-two` commands, gives each command the remaining timeout, copies the final to the temporary path, validates the temporary, commits once after validation, sums phases to `elapsedMs`, records scratch free bytes, removes scratch on success and on failure, and fails fast on low disk; the controller report for a fake executed v2 kingdom counts 13,472,960 candidates and non-zero throughput.
- `modal/test_volume_download.py` (new): with 40 fake files and a fake delay, in-flight count stays at or below 16 and reaches at least 2; a transient error on the first attempt is retried and succeeds; a permanent error raises after four attempts with delays 1, 2, and 4 through a fake sleep; `FileNotFoundError` raises without retry; a size mismatch raises.
- `modal/test_strategy_search_psro_runtime.py`: the `Entry` fixture gains `size`; download excludes operational files, replaces an existing non-empty destination, replaces every destination only after all kingdoms complete, removes temporary directories and replaces nothing on a download failure; status reads no Volume file for a complete attempt with a stored `result`, reads `job-report.json` for a complete attempt without one, reads `lease.json` only for an attempt without `callId`, `progress.json` for a pending attempt, and `job-report.json` for a newly complete attempt, and writes the state file once.
- `modal/test_strategy_search_runtime.py`: final download keeps per-artifact metrics and totals, a truncated stream raises, route v2 selects the two Goldfish files, and the module has no module-level `volume_download` attribute.

### Documents

- `docs/strategy-search-goldfish-modal.md`: v2 request (`workerCores` 16–64), the two tasks per kingdom, plan table for one kingdom at 16, 32, and 64 cores with timeouts and exact worst-case costs, scratch and disk facts, request sizing under the $100 cap, output, and one line that `intermediateSerializationAndReadMs`, `intermediateIoRatio`, and `goldfishIntermediateIoTargetMet` measure container-local disk I/O.
- `README.md`: both Goldfish-only paragraphs (the command list and the comparison-shape sentence).
- `docs/strategy-search-process.md`: replace the sentence about deleting range files with the v2 fact: intermediate range files stay on the container's local disk and are removed with it; only the two finals reach the Volume.
- `docs/strategy-search-psro-modal.md`: download concurrency, retries, per-kingdom replacement, and status reads.

## Identity consequences

No file on `strategy-search-scientific-files.json` changes. `modal/native_strategy_search.py` is on the image allowlist, so the deployment digest, the compute app name, the Goldfish execution IDs, and both plan tokens change. Evidence IDs do not change. The 30 completed kingdoms keep their Goldfish finals and receipts under the same evidence IDs, and a v2 controller reuses them by ID. Do not edit `src/sim/strategySearchScheduler.ts` (image allowlist, shared with the full route) or `package.json` (both allowlists).

## Out of scope

The full campaign route, any Rust change, the 130-kingdom run, the 160-kingdom report manifest binding, Volume cleanup code, and a Modal SDK version pin.

## Acceptance

- `npm run verify:native`, `npm run modal:test`, `npm run typecheck`, `npm run lint`, and `git diff --check` pass.
- `npm test` has no failure outside the 46 pre-existing card-balance fixture failures in 10 files (`test/sim/balanceSuite.test.ts`, `test/combo-card-batch.test.ts`, `test/cards.test.ts`, `test/sim/positionValue.test.ts`, `test/sim/identity.test.ts`, `test/sim/search.test.ts`, `test/sim/responseOracleReferenceExtension.test.ts`, `test/sim/deepBeamSuite.test.ts`, `test/sim/balanceSuiteDeterminism.test.ts`, `test/distance-duel.test.ts`). The same 46 tests fail at the base SHA `4874524`; those fixtures stay unchanged under the routine-tuning rule and are out of scope.
- No existing test assertion is weakened.
- The v2 bundle and the Python validation agree on every field, and the two worst-case cost calculations agree to six decimals for 16, 32, and 64 cores.
- The plan output for one kingdom at 32 cores and 512 CPUs shows 2 tasks, 16 containers, and a 707 s `kingdom-one` timeout.
- The writer runs no Modal command and no paid operation.

## Operational validation (main agent, after the implementation review)

1. Local reference run of `balance-tuning-005`: done, both finals byte-identical to the Modal v1 evidence (see Measured problem).
2. Unpaid Volume read: `download --compare-with .data/starfire-12-balance-88` for execution `d6b0497a…` into a scratch root; every scientific file identical; wall at most 90 s.
3. Paid smoke under the $100 cap: kingdoms `balance-tuning-001`, `002`, `003`, `004`, `006`, `008`, `012`, `016`. Goldfish v2 at 32 cores, `maxActiveCpus` 256, `maxWallSeconds` 1800; a local reference run of `balance-tuning-001` must equal the downloaded bytes. Then local Matrix, PSRO at 16 cores and 128 CPUs, parallel download, structural validation. Targets, not promises: 2.5–4 min per kingdom, at most 6 min controller wall for the 8 kingdoms, PSRO download for 30 kingdoms at most 90 s.
4. Authorized destructive cleanup: `modal volume rm -r hexdeck-native-strategy-results evidence/<id>/tasks` for the 30 existing evidence IDs.

## Implementation order

1. `modal/volume_download.py` and its tests.
2. PSRO runtime download and status, TypeScript timeouts, tests, PSRO document.
3. Goldfish runtime final download and route check, tests.
4. TypeScript Goldfish v2 request, bundle, cost, plan summary, tests, documents.
5. Python v2 validation, cost, lease, task config, kingdom job, phases, report accounting, tests.
6. Validation commands, then the handoff with the exact plan output for one kingdom at 16, 32, and 64 cores.

## Stop conditions

Stop and report if the change needs an edit to a scientific-allowlist file, a publisher protocol change beyond the lease value, a weakened existing assertion, or if the TypeScript and Python cost or timeout calculations cannot be made equal.
