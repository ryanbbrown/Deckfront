# Modal evidence transfer: kingdom Goldfish containers and parallel downloads

Status: implementation plan (direct mode; one plan review, one implementation review).

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

## Decisions

- D1. Route `goldfish-only-v2` replaces v1. The v1 partition, score-window, and reducer-materialization code leaves the Goldfish-only route. The full campaign route keeps its own `goldfish-one` and `goldfish-two` stages and is out of scope.
- D2. Two tasks per kingdom keep the stage names `goldfish-one-reduce` and `goldfish-two-reduce`. Publisher validation kinds, `goldfish-evidence-finalize`, `goldfish-evidence-complete`, and the 30 existing kingdoms' `goldfishCompletion` receipts on the Volume are keyed by those names. The job modes are `kingdom-one` (`score-one` over `[0, 12972960)` then `reduce-one`, artifact `top-500000.hgf`) and `kingdom-two` (`score-two` over `[0, 500000)` then `reduce-two`, artifact `reservoir.hgf`). Task IDs use `taskIdentity(evidenceId, stage, null)`; the Python `_strategy_search_goldfish_task_id` produces the same string for `range = None`.
- D3. Container shape: `workerCores` from 16 to 64, memory 8,192 MiB, task timeouts 900 s (`kingdom-one`) and 300 s (`kingdom-two`), 3 attempts. Timeouts are fixed constants, not derived from cores. At 16 cores the measured rate (about 2,240 candidates per core-second) gives about 380 s for stage one.
- D4. Local scratch is `/tmp/hexdeck-goldfish/<launchId>/`. The job removes it in `finally`. It fails fast before any Rust command when free space is below 2 GiB and records the free bytes in its result.
- D5. The container does not run `verify --kind stage-one` on the 830 MB file; `reduce-one` validates it while streaming. Publisher validation of the finals is unchanged: `verify --kind top` and `verify --kind reservoir --top`.
- D6. Downloads use a thread pool of 16 over the blocking `Volume.read_file`. Each file retries 3 attempts with 1, 2, and 4 s delays on any error except `FileNotFoundError`. The byte count must equal `FileEntry.size` from `listdir`. Modal SDK 1.5.4 `read_file` is one `VolumeGetFile2` RPC plus 8 MiB block GETs; Modal's own `modal volume get` runs 128 concurrent file downloads and 64 concurrent RPCs (`modal/cli/_download.py`), so 16 is conservative.
- D7. PSRO `download` lists every kingdom, downloads all files through one pool into per-kingdom temporary directories beside the destinations, then replaces every destination with `os.replace`. Any failure removes all temporary directories and raises. A kingdom whose local `psro/run-report.json` SHA-256 equals the remote `run-report.json` SHA-256 is skipped and reported as `unchanged`.
- D8. PSRO `status` reads the Volume only for attempts that are not complete in local state: `lease.json` only when `callId` is null, `progress.json` for pending attempts, `job-report.json` when the poll reports complete. Polls and reads run in a pool of 16. A complete attempt reports its stored `result` as `jobReport`.
- D9. Client timeouts in `scripts/strategy_search_psro_modal.ts`: status `120 s + 1 s × attempts`; download `600 s + 10 s × kingdoms`. Pure functions with tests.
- D10. New module `modal/volume_download.py` holds the shared fetch helpers. It defines no Modal app. Both local runtimes import it. It is on no allowlist.
- D11. Worst-case cost for v2 in TypeScript and Python, equal to six decimals: `N × 3 × [cost(workerCores, 8192, 930) + cost(workerCores, 8192, 330)] + cost(1, 2048, maxWallSeconds + 60) + cost(1, 8192, maxWallSeconds) + cost(1, 2048, 180) + cost(1, 4096, 120) + cost(0.25, 512, maxWallSeconds + 90)` with `cost(cpu, mib, s) = s × (cpu × 0.0000131 + mib / 1024 × 0.00000222)`. For one kingdom and 3,600 s this is about $1.06 at 16 cores, $1.85 at 32 cores, and $3.43 at 64 cores. The route hard cap stays $100, so one request holds at most about 60 kingdoms at 32 cores or 30 at 64 cores.
- D12. The bundle sets `maxReducerMemoryMiB = maxKingdomContainers × 8192`, so the controller's reducer admission check never blocks a kingdom task. No controller scheduling change.
- D13. The operator report `scientificStageWallMs` has the two v2 stage keys.
- D14. The readiness canary keeps mode `score-one` over `[0, 1)`; the single-command job path stays for `score-one`, `score-two`, `reduce-one`, and `reduce-two`.

## Changes

### `src/sim/strategySearchGoldfishModal.ts`

- Remove `candidatesPerScoreTask`, `partitionsFor`, `initialJob`, `scoreArtifactPath`, the score and reducer constants, and the partition imports. Keep `taskIdentity` and the `RuntimeJob` type.
- Add `GOLDFISH_MODAL_ROUTE = 'goldfish-only-v2'`, `GOLDFISH_MODAL_MIN_WORKER_CORES = 16`, `GOLDFISH_MODAL_KINGDOM_MEMORY_MIB = 8192`, `GOLDFISH_MODAL_KINGDOM_ONE_TIMEOUT_SECONDS = 900`, `GOLDFISH_MODAL_KINGDOM_TWO_TIMEOUT_SECONDS = 300`.
- Request schema: `workerCores` 16..64; `maxActiveCpus >= workerCores`.
- `resourceShape`: `{ workerCoresPerContainer, maxActiveCpus, maxKingdomContainers, maxScheduledCpus, unusedCpuCapacity, kingdomMemoryMiB }`.
- Task counts `{ kingdomOne: N, kingdomTwo: N, total: 2N }`; cost per D11.
- Execution plan hash input: `{ route, request, deploymentDigest, orderedEvidenceIds, resourceShape, costGuard }`.
- Bundle: `partitions: {}`; per kingdom, task A (`goldfish-one-reduce`, `range: null`, `cpu: workerCores`, `memoryMiB: 8192`, `timeoutSeconds: 900`, `dependencyTaskIds: []`, artifact `evidence/<id>/goldfish/top-500000.hgf`, job status `ready`) and task B (`goldfish-two-reduce`, same shape, `timeoutSeconds: 300`, `dependencyTaskIds: [A]`, artifact `evidence/<id>/goldfish/reservoir.hgf`, job status `blocked`).
- Controller fields: `route`, `maxActiveCpus`, `timeoutSeconds`, `maxWallSeconds`, `pollIntervalSeconds: 1`, `volumeName`, `readyWindowWaves: 2`, `maxReducerMemoryMiB`, `goldfishWorkerCores`, `goldfishKingdomMemoryMiB`, `goldfishKingdomOneTimeoutSeconds`, `goldfishKingdomTwoTimeoutSeconds`, `executionPlanHash`, `costGuard`.
- Plan summary: `taskCounts`, `resourceShape`, `timeouts: { maximumScientificWallSeconds, kingdomOneTaskSeconds, kingdomTwoTaskSeconds }`.

### `scripts/strategy_search_goldfish_modal.ts`

- `createGoldfishOperatorReport` maps the two v2 stage keys.

### `modal/native_strategy_search.py`

- Constants per D3 and D4; remove the v1 score and reducer constants that become unused. `_strategy_search_materialize_goldfish` keeps its literal defaults for the full route.
- `_strategy_search_validate_goldfish_only_bundle`: route `goldfish-only-v2`; exact request fields; `workerCores` 16..64; `maxActiveCpus >= workerCores`; wall and cost bounds; controller fields equal to the constants and `maxReducerMemoryMiB == floor(maxActiveCpus / workerCores) × 8192`; `partitions == {}`; exactly two jobs and two tasks per kingdom with the expected stages, `range None`, cpu, memory, timeouts, dependencies, artifact paths, and statuses; counts `{kingdomOne, kingdomTwo, total}`; cost guard fields and value equal to `_strategy_search_goldfish_worst_case_cost`.
- `_strategy_search_goldfish_worst_case_cost(request, task_counts)`: D11 with `round(…, 6)`.
- `_strategy_search_task_config`: when `bundle["controller"]["route"] == GOLDFISH_MODAL_ROUTE`, `goldfish-one-reduce` gets `mode: kingdom-one` and `goldfish-two-reduce` gets `mode: kingdom-two` plus `topPath: evidence/<id>/goldfish/top-500000.hgf`. The existing manifest branch stays for the full route.
- `strategy_search_goldfish_job`: dispatch on `config["mode"]`. New `_strategy_search_goldfish_kingdom_stage(config)`:
  1. `volume.reload()`, record `workerStartedEpochMs`, create scratch, check free space (D4).
  2. Run the score command (`--start`, `--end`, `--threads config["cpu"]`, `--out <scratch>/stage.hgs`, `--report <scratch>/score.json`), then the reduce command (`--inputs <scratch>/inputs.json` listing the local stage file, `--out <scratch>/<final>`, `--report <scratch>/reduce.json`). `kingdom-two` passes `--top <Volume top path>` to both. Each command runs through `_strategy_search_run_subprocess(command, {**config, "timeoutSeconds": remaining})` where `remaining = max(1, timeoutSeconds - elapsed)`.
  3. Copy the final to `_strategy_search_path(config["temporaryPath"])`, build the phase report, `validated_sha256 = _strategy_search_sha256(output)`, `_strategy_search_validate_publication(config, output)`, `volume.commit()`, measure commit and queue time as the v1 job does.
  4. Return the v1 result shape (`elapsedMs`, `workerFinishedEpochMs`, `checkpointCount`, `modalWorkerElapsedMs`, `sha256`, `validatedSha256`, `phases`, `workerStartedEpochMs`, `temporaryPath`) plus `rustReports: {score, reduce}` and `scratchFreeBytes`.
  5. Remove scratch in `finally`.
- `_strategy_search_goldfish_kingdom_phases(score_report, reduce_report, mode)`: `scoringMs = score.scoringMs`; `intermediateSerializationAndReadMs = score.readMs + score.writeMs + reduce.readMs`; `reductionComputeMs = reduce.reduceMs`; `finalTop500000WriteMs` (`kingdom-one`) or `finalTop20000WriteMs` (`kingdom-two`) `= reduce.writeMs`; `elapsedMs = score.elapsedMs + reduce.elapsedMs`; `orchestrationQueueMs` is the remainder and must not be negative. The job then adds `temporaryVolumeWriteCommitMs` (copy plus commit) and queue delay to `orchestrationQueueMs`, and extends `elapsedMs`, as the v1 job does. The controller's phase-sum check stays.
- Controller: `report_stages` for the Goldfish-only route lists the two stages. Nothing else changes; with empty partitions `_strategy_search_materialize_goldfish` is a no-op and the `first_goldfish` reorder finds no score job.

### `modal/volume_download.py` (new)

- `fetch_file(volume, remote, local, expected_size=None, sleep=time.sleep) -> {bytes, wallMs, attempts}`: streams `volume.read_file(remote)` into `local`, retries per D6, raises on a size mismatch.
- `fetch_files(volume, items, concurrency=16) -> list[dict]`: `ThreadPoolExecutor(max_workers=concurrency)`; results keep item order; the first exception propagates after the pool drains.

### `modal/strategy_search_psro_runtime.py`

- `download(config)`: D7 through `fetch_files`. Result: `artifacts` (per file: `kingdomId`, `path`, `relative`, `bytes`, `wallMs`), `kingdoms` (per kingdom: `kingdomId`, `status` `downloaded` or `unchanged`, `files`, `bytes`, `wallMs`), `bytes`, `wallMs`, `concurrency`.
- `status(state_file)`: D8.

### `modal/strategy_search_runtime.py`

- `_download_final_artifacts` uses `fetch_files` with concurrency 16 and keeps the per-artifact `{evidenceId, path, bytes, wallMs}` entries and totals.
- `_final_artifact_relatives` recognizes `goldfish-only-v2`.

### `scripts/strategy_search_psro_modal.ts`

- Exported pure functions `psroStatusTimeoutMs(attemptCount)` and `psroDownloadTimeoutMs(kingdomCount)` per D9, used by the adapter.

### Tests

- `test/sim/strategySearchGoldfishModal.test.ts`: request bounds (15 and 65 cores rejected, 16 and 64 accepted); shapes at 512 CPUs give 32, 16, and 8 containers for 16, 32, and 64 cores; two tasks per kingdom with the stage names, `range: null`, dependencies, artifact paths, memory, and timeouts; `partitions` empty; `maxReducerMemoryMiB = containers × 8192`; exact worst-case cost for one kingdom at 16, 32, and 64 cores and rejection below the bound; evidence IDs equal across shapes and equal to `deriveStrategySearch`; execution IDs differ across shapes; authorization binds cores; the bundle contains no Matrix or PSRO text; operator report keys.
- `test/sim/strategySearchPsroModal.test.ts`: the two timeout functions.
- `modal/test_native_strategy_search.py`: v2 validation accepts a bundle in the TypeScript shape and rejects non-empty partitions, a score stage, a third task per kingdom, wrong cpu, memory, timeouts, dependencies, or artifact paths, a cost mismatch, and 15 cores; worst-case cost equals the TypeScript value for the same request (fixture values); `_strategy_search_materialize_goldfish` changes nothing for empty partitions; task config yields `kingdom-one` and `kingdom-two` with `topPath`; the kingdom job with a fake subprocess runs score then reduce with an inputs manifest that names the local stage file, passes `--threads` equal to cpu, passes `--top` to both `kingdom-two` commands, gives each command the remaining timeout, copies the final to the temporary path, validates the temporary, commits once after validation, sums phases to `elapsedMs`, records scratch free bytes, removes scratch on success and on failure, and fails fast on low disk.
- `modal/test_volume_download.py` (new): with 40 fake files and a fake delay, in-flight count stays at or below 16 and reaches at least 2; a transient error on the first attempt is retried and succeeds; a permanent error raises after 3 attempts with delays 1, 2, and 4 through a fake sleep; `FileNotFoundError` raises without retry; a size mismatch raises.
- `modal/test_strategy_search_psro_runtime.py`: download excludes operational files, replaces every destination only after all kingdoms complete, removes temporary directories and raises on a failure, reports an unchanged kingdom and does not re-download it; status reads no Volume file for a complete attempt, reads `lease.json` only for an attempt without `callId`, `progress.json` for a pending attempt, and `job-report.json` for a newly complete attempt.
- `modal/test_strategy_search_runtime.py`: final download keeps per-artifact metrics and totals; route v2 selects the two Goldfish files.

### Documents

- `docs/strategy-search-goldfish-modal.md`: v2 request (`workerCores` 16–64), the two tasks per kingdom, plan table for one kingdom at 16, 32, and 64 cores with exact worst-case costs, scratch and disk facts, request sizing under the $100 cap, and output.
- `README.md`: the Goldfish-only route paragraph.
- `docs/strategy-search-process.md`: replace the sentence about deleting range files with the v2 fact: intermediate range files stay on the container's local disk and are removed with it; only the two finals reach the Volume.
- `docs/strategy-search-psro-modal.md`: download concurrency, retries, the unchanged-kingdom skip, and status reads.

## Identity consequences

No file on `strategy-search-scientific-files.json` changes. `modal/native_strategy_search.py` is on the image allowlist, so the deployment digest, the compute app name, the Goldfish execution IDs, and both plan tokens change. Evidence IDs do not change. The 30 completed kingdoms keep their Goldfish finals and receipts under the same evidence IDs, and a v2 controller reuses them by ID. Do not edit `src/sim/strategySearchScheduler.ts` (image allowlist, shared with the full route).

## Out of scope

The full campaign route, any Rust change, the 130-kingdom run, the 160-kingdom report manifest binding, and Volume cleanup code.

## Acceptance

- `npm run verify:native`, `npm run modal:test`, `npm test`, `npm run typecheck`, `npm run lint`, and `git diff --check` pass.
- No existing test assertion is weakened.
- The v2 bundle and the Python validation agree on every field, and the two worst-case cost calculations agree to six decimals for 16, 32, and 64 cores.
- The plan output for one kingdom at 32 cores and 512 CPUs shows 2 tasks and 16 containers.
- The writer runs no Modal command and no paid operation.

## Operational validation (main agent, after the implementation review)

1. Local reference run of `balance-tuning-005` with 8 threads: both finals byte-identical to `.data/starfire-12-balance-88/balance-tuning-005/goldfish/` (the Modal v1 31-partition result).
2. Unpaid Volume read: `download --compare-with .data/starfire-12-balance-88` for execution `d6b0497a…` into a scratch root; every scientific file identical; wall at most 90 s.
3. Paid smoke under the $100 cap: kingdoms `balance-tuning-001`, `002`, `003`, `004`, `006`, `008`, `012`, `016`. Goldfish v2 at 32 cores, `maxActiveCpus` 256, `maxWallSeconds` 1800; a local reference run of `balance-tuning-001` must equal the downloaded bytes. Then local Matrix, PSRO at 16 cores and 128 CPUs, parallel download, structural validation. Targets, not promises: 2.5–4 min per kingdom, at most 6 min controller wall for the 8 kingdoms, PSRO download for 30 kingdoms at most 90 s.
4. Authorized destructive cleanup: `modal volume rm -r hexdeck-native-strategy-results evidence/<id>/tasks` for the 30 existing evidence IDs.

## Implementation order

1. `modal/volume_download.py` and its tests.
2. PSRO runtime download and status, TypeScript timeouts, tests, PSRO document.
3. Goldfish runtime final download and route check, tests.
4. TypeScript Goldfish v2 request, bundle, cost, plan summary, tests, documents.
5. Python v2 validation, cost, task config, kingdom job, phases, report stages, tests.
6. Validation commands, then the handoff with the exact plan output for one kingdom at 16, 32, and 64 cores.

## Stop conditions

Stop and report if the change needs an edit to a scientific-allowlist file, a publisher protocol change, a weakened existing assertion, or if the TypeScript and Python cost calculations cannot be made equal.
