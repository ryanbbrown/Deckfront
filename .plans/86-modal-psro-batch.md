# Modal PSRO batch runtime

Status: reviewed implementation plan (`.reviews/plans/modal-psro-batch-runtime/`, round v1; findings applied once).

## Goal

Run the authoritative Rust PSRO loop on Modal with one complete kingdom per machine and cross-kingdom parallelism. Each kingdom runs the unchanged `hexdeck-goldfish psro` command with all requested cores. Modal runs kingdoms concurrently, queues the rest, and starts the next kingdom when a slot frees. The route downloads the finished evidence into the same local layout that the balance reports read.

The route supports three sizes with one implementation:

1. one paid benchmark kingdom on one machine;
2. eight kingdoms on eight machines at once;
3. a larger set with a bounded number of active machines and a dynamic queue.

Complete Goldfish -> Matrix -> PSRO stays mandatory. PSRO stays the proven loop from `.plans/79-rust-psro-loop.md` with the confirmed queue cap of 100 from `.plans/84-card-balance-smoke.md`, deferred candidates returning through fresh full-reservoir screens, and the two-clean-full-search stop. No screening depth, confirmation depth, alpha, threshold, queue rule, or admission rule changes. No Rust source changes.

## Current state

- `hexdeck-goldfish psro` owns all dependencies between looks and uses one Rayon pool sized by `--threads`. It writes a checkpoint after each look or admission. With `HEXDECK_PSRO_HANDSHAKE` set, it prints `checkpoint <ordinal> <crc>` after each checkpoint and waits for `committed <ordinal>` before the next look. It prints nothing else about the transition.
- `modal/psro_step.py::run_psro_step` starts that command, commits the Modal Volume on each handshake, and collects the output files and `run-report.json`.
- `modal/native_strategy_search.py::strategy_search_psro_job` is a deployed 16-core, 16 GiB, 24-hour Modal Function with `retries=0` and `@modal.concurrent(max_inputs=1)`. It calls `run_psro_step` with 16 threads. Nothing calls it.
- The Goldfish-only route (`.plans/80-goldfish-only-modal-route.md`) deploys the compute app named from the source digest, checks readiness, and publishes `evidence/<evidence-id>/goldfish/top-500000.hgf` and `reservoir.hgf` on Volume `hexdeck-native-strategy-results`.
- Campaign `84e22f519a74f1476e9522f5367073a0125c645d4c5f2e4f757f99cc9c269db6` holds the fresh Goldfish outputs for `balance-tuning-005`, `009`, `021`, `056`, `064`, `090`, `097`, and `126`. The current source derives the same eight evidence IDs, so the Volume Goldfish files match the local download.
- Matrix and PSRO have not run for this retune. The local routine path runs `hexdeck-goldfish matrix` and then `scripts/psro_search.sh` per kingdom.
- The persistent-mana 30-kingdom run in `.data/persistent-mana-balance-85` contains local PSRO run reports for all eight kingdoms above. Under those rules `balance-tuning-090` was the largest of the eight: 53.1M games, 76 transitions, 5 admissions.
- The older distributed-within-a-look `parallel-psro` campaign path is not used by this plan and is not revived.
- Installed Modal is 1.5.4. `Function.with_options` accepts `cpu`, `memory`, `timeout`, `retries`, `max_containers`, and `scaledown_window`. `modal.current_function_call_id()`, `modal.FunctionCall.from_id`, `Volume.batch_upload`, `Volume.listdir`, and `Volume.read_file` exist. `Volume.batch_upload` refuses an existing remote file unless `force=True`.

## Decisions

### Matrix runs locally before any paid launch

An initial Matrix is 306,250 games per kingdom. The eight local PSRO runs under the persistent-mana rules played 7.9M to 53.1M games per kingdom, 173.3M in total. Matrix is therefore about 1.4% of the batch. All eight Matrix steps finish in a few minutes on the 14-core host. Pipelining PSRO behind Matrix has no useful gain, so the route runs Matrix for every requested kingdom locally first, then uploads the four Matrix files to the Volume. The operator can inspect the initial equilibrium before paying.

### The client bounds concurrency and Modal enforces it too

The client keeps at most `slots` non-terminal calls: it spawns up to `slots` kingdoms in request order and spawns the next kingdom when a call becomes terminal. The Function handle also carries `max_containers=slots`, so Modal enforces the same limit if the client and Modal disagree. For eight kingdoms and eight slots, all eight start at once. No project controller, remote lease service, or task graph exists for PSRO.

`with_options` on a `Function.from_name` handle is not used anywhere in the repository today. A fake-Modal test pins the exact call. If Modal ignores `max_containers` on that handle, the client limit still holds and the batch report shows the peak concurrency; the route needs no other change.

### Volume outputs are execution scoped

Each kingdom writes to `psro-executions/<psro-execution-id>/<evidence-id>/`. A second run with the same execution ID resumes from the committed checkpoint. A different core count has a different execution ID and therefore a fresh directory, which makes the 16-versus-32-core benchmark a byte comparison of two complete runs. The route does not publish PSRO files to `evidence/<evidence-id>/psro/`; the local download is the deliverable.

### Volume commits are measured, not assumed

The job commits the Volume once per Rust checkpoint and waits for the commit before the next look, so commit time is pure overhead on the critical path. The job reports commit count, total commit time, and the share of job wall time spent in commits. The one-kingdom benchmark measures one committer; the eight-kingdom batch measures eight containers committing to the same Volume, so the batch report carries the same three values per kingdom and the threshold is checked again after the batch. This plan does not change the commit cadence. If the commit share exceeds 15% at the chosen core count in either run, a later plan adds a commit-every-N-checkpoints option; restart granularity would then be N looks.

### Core count is chosen by measurement

Rust evidence bytes do not depend on thread count. Plan 79 tests prove byte-identical output at 1, 4, and 10 threads. The benchmark runs the same kingdom at 16 and 32 cores, byte-compares the scientific files, and reports speedup, games per core-second, and cost. Choose 32 cores for the batch when the measured speedup is at least 1.75; otherwise choose 16. If Modal cannot admit a 32-core container, the benchmark records the admission error and the batch uses 16.

### One request for all eight kingdoms

After the core-count choice, the eight-kingdom batch runs all eight kingdoms, including the benchmark kingdom, in one request. That costs one more kingdom run but gives one execution, one report, and no merge step. The benchmark directories stay as timing evidence.

## Request and safety contract

The route accepts one strict JSON request. Every field is required. There are no paid defaults.

```json
{
  "kingdomIds": ["balance-tuning-090"],
  "workerCores": 16,
  "maxActiveCpus": 16,
  "maxWallSecondsPerKingdom": 7200,
  "maxCostUsd": 5
}
```

- `kingdomIds`: nonempty ordered list of unique registered IDs.
- `workerCores`: 1 to 64. It is the Modal CPU request, the Rust `--threads` value, and part of the execution ID. The job refuses a `threads` value that differs from its CPU request.
- `maxActiveCpus`: at least `workerCores`. Slots are `floor(maxActiveCpus / workerCores)`. The plan prints the slots and any CPUs that cannot fit another machine.
- `maxWallSecondsPerKingdom`: 300 to 21,600. The Function timeout is this value plus 60 seconds. A timeout kills the container; the committed checkpoint stays on the Volume and a relaunch resumes.
- `maxCostUsd`: at most the route hard cap of $100. It is one limit for the whole execution across every `run` invocation that uses the same token, not a limit per invocation.

Memory is a route constant of 8,192 MiB. The PSRO process holds one 20,000-row reservoir, score prefixes, and the expanded matrix, which is far below that. The job reports the child's maximum resident set size from Linux `resource.getrusage(RUSAGE_CHILDREN).ru_maxrss`, which is KiB, recorded as MiB, so a later run can change the constant with evidence.

Deep verification never runs inside the paid container. The job always calls `run_psro_step` with `deep_verify=False`. `psro-verify` is a local, opt-in `download --verify` step.

### Cost guard

The guard uses the current Modal Function rates from the Goldfish route: $0.0000131 per physical core-second and $0.00000222 per GiB-second. The bound for one attempt of one kingdom is:

```text
(workerCores × 0.0000131 + 8 × 0.00000222) × (maxWallSecondsPerKingdom + 120)
```

The 120-second margin covers the 60-second Function timeout margin, the 10-second scale-down tail, and container startup. At 16 cores and 7,200 seconds one attempt is $1.6643; at 32 cores it is $3.1985. Each `run` invocation also reserves the readiness and canary constants from the Goldfish route. `retries=0` means one attempt per spawn.

The local execution state keeps a ledger. An attempt is measured when its `job-report.json` exists; every other attempt, including a failed, timed-out, cancelled, or unknown attempt, keeps its full bound. The ledger total is the sum of measured attempts, the bounds of every unmeasured attempt, and the readiness reservation of every `run` invocation. `run` refuses a spawn that would push the total above `maxCostUsd`. The route has no shared ledger with the older `~/.hexdeck-modal-cost-ledger.json`; two executions can each spend up to their own `maxCostUsd`, and the hard cap bounds each of them.

### Identity

- Kingdom evidence identity and evidence IDs are unchanged and come from `deriveStrategySearch`.
- Input identity is the SHA-256 of the six input files per kingdom: local `goldfish/top-500000.hgf`, `goldfish/reservoir.hgf`, `matrix/pairs.hgm`, `matrix/purchases.hgm`, `matrix/matrix.hgm`, and `matrix/self-play-v1.hst`.
- The PSRO execution ID is the SHA-256 of the canonical JSON of the route name `psro-batch-v1`, the scientific source digest, the ordered evidence IDs, the input hashes by evidence ID, and `workerCores`. Cap changes and slot changes keep the same execution. A scientific source change, other inputs, or another core count start a fresh execution.
- The authorization token binds the complete request, the deployment digest, the ordered evidence IDs, the input hashes, the execution ID, and the cost guard. `run` rejects a missing or different token before its first Modal command. Any input or request change needs a new `plan`.
- The state file records the deployment digest of every launch. A resume under a different deployment digest is allowed only when no call is pending; it is a new launch with the new digest and needs a new token. Calls from two different images never run at the same time inside one execution.
- The job checks the deployed source identity with `verify_strategy_search_source`, hashes the six Volume input files, and rejects any hash that differs from the launch configuration before Rust starts. Rust then performs its own reservoir, matrix, and checkpoint source checks.

## Volume layout

```text
evidence/<evidence-id>/goldfish/top-500000.hgf          existing Goldfish route output
evidence/<evidence-id>/goldfish/reservoir.hgf           existing Goldfish route output
evidence/<evidence-id>/matrix/pairs.hgm                 uploaded by the client
evidence/<evidence-id>/matrix/purchases.hgm             uploaded by the client
evidence/<evidence-id>/matrix/matrix.hgm                uploaded by the client
evidence/<evidence-id>/matrix/self-play-v1.hst          uploaded by the client
psro-executions/<psro-execution-id>/launch-intent.json  client launch record
psro-executions/<psro-execution-id>/<evidence-id>/      Rust --out directory
  search-NNNN/*.hpl, retest-NNNN/*.hpl, checkpoint.hpc, decisions.hpd,
  self-play-v1.hst, run-report.json
  admission-NNNN.hpa, pairs.hgm, purchases.hgm, matrix.hgm   only after an admission
  lease.json                                            job launch record
  progress.json                                         last committed checkpoint
  job-report.json                                       job timing and cost
```

Scientific files are only the Rust outputs. `launch-intent.json`, `lease.json`, `progress.json`, `job-report.json`, and `run-report.json` are operational and are never used for a scientific decision. A kingdom with zero admissions has no `admission-NNNN.hpa`, `pairs.hgm`, `purchases.hgm`, or `matrix.hgm` in its PSRO directory; the evidence loader then reads self-play from the Matrix directory.

## Launch safety

The real duplicate-launch guard is the client. The Volume records are visibility and defense in depth, because a Volume commit is last-writer-wins, not compare-and-set.

1. `run` takes an exclusive file lock on `~/.hexdeck-modal-psro/<psro-execution-id>.lock` for the whole operation. The path does not depend on `--root`, so two clients on the same host for the same execution cannot both run. The route assumes one operator host per execution.
2. Every state-file write is atomic: temporary file, sync, rename.
3. Before any spawn, the client writes a launch record with a fresh `launchId`, the deployment digest, the kingdoms to launch, and their bounds into the state file and into `psro-executions/<psro-execution-id>/launch-intent.json` on the Volume.
4. The client spawns one kingdom at a time and persists `call.object_id` for that kingdom immediately after each spawn. Only then does it spawn the next kingdom.
5. On resume, a kingdom whose launch record has no call ID is `unknown`: a crash happened between spawn and persistence. `run` does not relaunch an `unknown` kingdom. `status` reads that kingdom's `lease.json`; if the lease names the same `launchId`, the client adopts its call ID and continues. If no lease appears, the operator relaunches with `--abandon-launch <launchId>` after checking the Modal dashboard. The abandoned attempt keeps its full cost bound.
6. Pending-call classification reuses `_strategy_search_poll_function_call`, which already treats the built-in `TimeoutError` from `get(timeout=0)` as pending and Modal errors as failure.
7. The job writes `lease.json` with its `launchId`, `modal.current_function_call_id()`, and start time, then commits. If a lease from another call already exists and that call is still pending, the job fails with `duplicate PSRO launch` before Rust starts. This catches an abandoned attempt that starts late.

## Job changes

`modal/psro_step.py::run_psro_step` gains:

- timing of every `volume.commit()` and a return value with `commitCount` and `volumeCommitMs` for the handshake commits;
- an optional `on_checkpoint(ordinal, crc, commit_count, commit_ms)` callback invoked before each commit so the job can write `progress.json` into the same commit. The commit count and time describe earlier commits, so progress is one checkpoint behind for those two values.

`modal/native_strategy_search.py::strategy_search_psro_job` changes to:

1. call `verify_strategy_search_source(config["sourceImage"])` and refuse `config["threads"] != config["cpu"]`;
2. `volume.reload()`, then compare the SHA-256 of the six input files with `config["inputSha256"]` and fail before Rust on any difference;
3. apply the lease rule above;
4. run `run_psro_step` with `threads=config["threads"]`, the handshake Volume, the progress callback, and `deep_verify=False`;
5. write `job-report.json` with worker start and finish epoch milliseconds, Rust elapsed time, total games, games per second, transition timings, handshake commit count and time, commit share of job wall time, maximum resident set size in MiB, requested cores and memory, and the measured cost at the guard rates, then run the final `volume.commit()`, which is outside `commitCount`;
6. return the same report.

The Function decorator keeps `cpu=16, memory=16384, timeout=86400`; the client overrides all three with `with_options`. The Rust command, arguments, and output layout do not change.

## Client operations

`scripts/strategy_search_psro_modal.ts` owns the operator commands. `src/sim/strategySearchPsroModal.ts` owns request parsing, identity, cost, ledger, state transitions, and download selection so tests can cover them without Modal. `modal/strategy_search_psro_runtime.py` is a lightweight local Modal module, like `strategy_search_runtime.py`, with `preflight_entry`, `launch_entry`, `status_entry`, and `download_entry`. No operation defaults to a paid action.

### `matrix --request R --root DIR --goldfish-campaign ID`

Unpaid. For each kingdom in order:

1. If `DIR/<kingdom>/goldfish/` is missing, copy `top-500000.hgf` and `reservoir.hgf` from `.data/strategy-search-goldfish/<campaign>/evidence/<evidence-id>/goldfish/`. Copies, not symbolic links, because the evidence loader rejects symbolic links.
2. If `DIR/<kingdom>/matrix/matrix.hgm` is missing, run `hexdeck-goldfish matrix --kingdom <id> --reservoir ... --out DIR/<kingdom>/matrix --threads <host cores> --report DIR/logs/<kingdom>-matrix-report.json`.
3. Run `loadRustInitialMatrixEvidence`, the existing `readMatrixSet` and `readSelfPlay` logic exported from `src/sim/rustStrategySearchEvidence.ts`: HGM headers, CRCs, reservoir source link, pair order, percentages, stored equilibrium witness, and HST header, source, and order.
4. Rebuild `DIR/matrix-batch-report.json` from every `DIR/*/matrix` present, with protocol `routine-matrix-batch-report-v1`, `allValid`, and `kingdoms[]` rows of `kingdomId`, `reportPath`, `reportSha256`, `strategyCount`, and `gameCount`.

Deep `matrix-verify` runs only with `--verify`.

### `plan --request R --root DIR`

Unpaid and makes no Modal call. It parses the request, derives evidence IDs, requires the six local input files per kingdom, hashes them, computes slots, timeouts, the attempt bound, the launch bound, the execution ID, and the token, and prints them. It fails when the launch bound plus the readiness reservation exceeds `maxCostUsd` or the hard cap.

### `run --request R --root DIR --authorize TOKEN`

Paid. In order:

1. Validate the token against a fresh `plan` derivation.
2. Take the execution lock and load or create the state file.
3. If the state file has pending calls, require the same deployment digest and skip deployment and readiness; the app already serves that digest. Otherwise deploy the compute app with `modal deploy --name hexdeck-strategy-<digest24> modal/native_strategy_search.py` and run readiness through `strategy_search_compute_ready`, exactly as the Goldfish route does, with the same timeouts and failure recording.
4. `launch_entry`: check that both Goldfish files exist on the Volume for every kingdom. For each Matrix file of each kingdom to launch: if the Volume file is missing, upload it; if it exists and its hash matches the local file, skip it; if it exists and differs, fail before any spawn. Then apply the launch-safety steps and spawn within the slot and ledger limits. Poll every 15 seconds until every call is terminal, spawning the next queued kingdom when a slot frees. A local interruption does not stop the Modal calls.
5. `download_entry` and structural validation as in `download`.
6. Write the reports.

A second `run` with the same token after a failure or interruption resumes: it reattaches to pending calls, skips complete kingdoms, and relaunches only failed kingdoms within the ledger. A relaunched kingdom resumes from its committed checkpoint on the Volume; no completed look is replayed.

### `status --request R --root DIR`

Unpaid apart from Volume reads. It reads the state file, polls each recorded call, reads each kingdom's `lease.json` and `progress.json`, and prints per kingdom: queued, running, complete, failed, or unknown; the last committed checkpoint ordinal and time; commit count and commit time through the previous checkpoint; and the ledger entry. It prints the batch makespan so far, active machines, and the ledger total against `maxCostUsd`.

### `download --request R --root DIR`

Downloads every file that exists under `psro-executions/<execution-id>/<evidence-id>/` except `lease.json`, `progress.json`, and `job-report.json` into `DIR/<kingdom>/psro/` for each complete kingdom. It enumerates the Volume directory and never creates a placeholder file. It writes to a temporary directory and renames only after every listed file is present. It then runs `loadRustStrategySearchKingdomEvidence` for the kingdom, which checks HGM, HPS, and HST headers, CRCs, source links, checkpoint completion, final Matrix order, and self-play bounds.

It then runs `report --root DIR`.

Deep `psro-verify` runs only with `--verify`.

`--compare-with DIR2` byte-compares the scientific files of a downloaded kingdom with another local PSRO directory and reports `identical` per file. The benchmark uses it.

### `report --root DIR`

Unpaid. Rebuilds `DIR/psro-batch-report.json` from every `DIR/*/psro/run-report.json` present under the root, not only the current request: protocol `routine-psro-batch-report-v1`, `confirmedQueueCap: 100`, `stoppingRule`, `allValid`, and `kingdoms[]` rows of `kingdomId`, `reportPath`, `reportSha256`, `searches`, `admissions`, `finalMatrixSize`, and `cleanFinalSearches`. `validateConsolidatedManifest` in `scripts/generate_rust_strategy_search_balance_report.ts` reads `kingdoms[].kingdomId`, `allValid`, and `missingKingdomIds` from this file and requires the kingdom list to equal its own manifest.

Neither existing report generator accepts this eight-kingdom set as its manifest: the Rust balance report is bound to the 30-kingdom `balance-smoke-v1` list, and `generate_card_balance_smoke_report.ts` hard-codes a different eight. The report changes for this retune belong to the report thread, not this plan. This plan delivers the root layout and batch reports those generators read.

## Reports

`DIR/modal-psro/<execution-id>/report.json` records:

- image build and deploy wall time, readiness and canary wall time, upload wall time and bytes, launch wall time, download wall time and bytes, structural validation wall time;
- per kingdom and attempt: evidence ID, launch ID, call ID, deployment digest, spawn, start, and finish epoch milliseconds, queue delay, job wall time, Rust elapsed time, total games, games per second, games per core-second, transition count, non-transition share of Rust elapsed time, handshake commit count, commit time, commit share, maximum resident set size, measured or reserved cost;
- batch: makespan from first spawn to last finish, peak concurrent machines, the ledger total, and `maxCostUsd`.

The benchmark comparison report adds speedup, cost ratio, commit share at each core count, and the byte-comparison result.

## Local dynamic queue

Plan 85 ran local PSRO in fixed waves of seven two-thread processes. Under a dynamic seven-worker queue the earlier eight would have taken an estimated 51.4 minutes instead of 91.5, and the newly chosen eight 40.2 minutes instead of 57.9. Add `scripts/psro_batch_local.sh <root> <workers> <threads> <kingdom>...`. It pipes the kingdom list through `xargs -P <workers> -n 1` into itself with a `--one <root> <threads> <kingdom>` form that builds the six `scripts/psro_search.sh` arguments from the root layout and writes `<root>/logs/<kingdom>-psro-console.log`. It has no scheduler state and does not touch the Modal path. It is the last implementation step and can be dropped without affecting the route.

## Files

Add:

- `src/sim/strategySearchPsroModal.ts`;
- `scripts/strategy_search_psro_modal.ts`;
- `modal/strategy_search_psro_runtime.py`;
- `modal/test_strategy_search_psro_runtime.py`;
- `test/sim/strategySearchPsroModal.test.ts`;
- `scripts/psro_batch_local.sh`;
- `docs/strategy-search-psro-modal.md`.

Update:

- `modal/psro_step.py` and `modal/test_psro_step.py`;
- `modal/native_strategy_search.py` and `modal/test_native_strategy_search.py`;
- `src/sim/rustStrategySearchEvidence.ts` and `test/sim/rustStrategySearchEvidence.test.ts` for the Matrix-only loader;
- `package.json` with `strategy-search:psro-modal` and `psro:batch-local`;
- `README.md`.

Do not edit Rust sources, `strategy-search-scientific-files.json`, or the Rust kingdom table. `strategy-search-image-files.json` already contains `modal/psro_step.py` and `modal/native_strategy_search.py`; the new runtime module runs locally and is not added.

## Tests

TypeScript tests prove:

- strict request parsing rejects missing fields, extra fields, unknown kingdoms, duplicate kingdoms, `maxActiveCpus` below `workerCores`, wall seconds outside 300 to 21,600, and cost above the hard cap;
- slots, timeouts, and the attempt bound match the rates and formula, including $1.6643 at 16 cores and $3.1985 at 32 cores for 7,200 seconds;
- the execution ID changes with the scientific digest, evidence order, any input hash, and `workerCores`, and does not change with caps, slots, or the deployment digest;
- the token changes with every request field, the deployment digest, and every input hash, and `run` refuses without it;
- `plan` makes no adapter or Modal call;
- the ledger keeps the full bound for a failed, timed-out, or unknown attempt across relaunches, adds the readiness reservation per `run`, and refuses a spawn above `maxCostUsd`;
- state transitions: a pending call is never respawned, a complete kingdom is never launched, a failed kingdom is relaunched within the ledger, an unknown kingdom is not relaunched without `--abandon-launch`, an adopted lease call ID continues, a resume with a different deployment digest is refused while a call is pending, and the client never holds more than `slots` non-terminal calls;
- download selection excludes `lease.json`, `progress.json`, and `job-report.json`, includes every present scientific file and `run-report.json`, and passes a zero-admission kingdom through `loadRustStrategySearchKingdomEvidence` without expanded HGM files;
- `report` rebuilds `psro-batch-report.json` from the root and the result passes `validateConsolidatedManifest` for the kingdoms it covers;
- `loadRustInitialMatrixEvidence` rejects a mutated Matrix CRC and a mutated HST header;
- the byte comparison reports identical and differing files.

Python tests prove:

- `run_psro_step` times and counts handshake commits and calls `on_checkpoint` before each commit with the previous count and time;
- the job passes `config["threads"]` to Rust, refuses `threads != cpu`, rejects a differing input hash before Rust starts, rejects a live lease from another call, accepts a lease whose call is terminal, always passes `deep_verify=False`, writes `job-report.json` with RSS in MiB, and reports cost at the guard rates;
- the runtime entrypoints call `Function.from_name(...).with_options(cpu=, memory=8192, timeout=, max_containers=, retries=0, scaledown_window=10)` with exactly those keyword arguments, spawn one kingdom at a time and persist each call ID before the next spawn, skip a matching Matrix upload, upload a missing file, fail on a differing file before any spawn, reattach from a state file, and download only the selected files. Modal Functions, calls, and the Volume are fakes.

Run:

```sh
npm run modal:test
npx vitest run test/sim/strategySearchPsroModal.test.ts test/sim/rustStrategySearchEvidence.test.ts
npm run typecheck
npm run lint
```

No Modal deployment and no paid run are part of implementation or validation.

## Implementation order

1. `modal/psro_step.py`: commit timing and progress callback, with tests.
2. `strategy_search_psro_job`: source check, thread check, input hashes, lease, progress, job report, with tests.
3. `modal/strategy_search_psro_runtime.py`: preflight, launch, status, and download entrypoints, with fake-Modal tests.
4. `src/sim/strategySearchPsroModal.ts`: request, identity, cost guard, ledger, token, state machine, download selection, batch reports, with tests.
5. `src/sim/rustStrategySearchEvidence.ts`: export the Matrix-only structural loader, with tests.
6. `scripts/strategy_search_psro_modal.ts`: `matrix`, `plan`, `run`, `status`, `download`, `report`, `--verify`, `--compare-with`, `--abandon-launch`.
7. `scripts/psro_batch_local.sh` and the npm commands.
8. `docs/strategy-search-psro-modal.md` and `README.md`.
9. Repository validation above.
10. One implementation review cycle against the recorded pre-implementation SHA.

## Operation after implementation

Each paid step needs explicit user authorization with the exact `plan` output in front of the user. The token is the authorization record.

1. Unpaid: `matrix` for the eight kingdoms with `--goldfish-campaign 84e22f519a74f1476e9522f5367073a0125c645d4c5f2e4f757f99cc9c269db6`. Then `plan` for `balance-tuning-090` at 16 cores and at 32 cores. Present slots, timeouts, bounds, execution IDs, and tokens.
2. Paid, on authorization: run `balance-tuning-090` at 16 cores with `maxWallSecondsPerKingdom` 7,200 and `maxCostUsd` 5. The attempt bound is $1.67. It is the largest of the eight under the previous rules, so it gives the clearest scaling and commit-overhead signal.
3. Paid, on separate authorization: run the same kingdom at 32 cores with `maxCostUsd` 5. The attempt bound is $3.20. Download with `--compare-with` against the 16-core directory. Any differing scientific byte is a blocker. Record speedup, cost ratio, and commit share, and apply the core-count rule.
4. Unpaid: `plan` for all eight kingdoms at the chosen core count with `maxActiveCpus` equal to eight machines. Paid, on authorization: run it. The launch bound is $13.31 at 16 cores or $25.59 at 32 cores, so `maxCostUsd` is 15 or 30. All eight start at once. Check the commit share per kingdom again. The report thread then has all eight kingdoms under one root with both batch reports.
5. Larger sets later use the same request with `maxActiveCpus` set to the approved machine limit. The queue path is first exercised there; its acceptance evidence is the peak-concurrency value in the batch report.

Expected scale, to be replaced by measurement: local two-thread processes reached 14,000 to 31,000 games per second, so a 16-core Modal machine at half the per-core rate would play 56,000 to 120,000 games per second. `balance-tuning-090` would then take 8 to 16 minutes of game time plus the measured non-transition share of about 21% and the commit time. The whole eight-kingdom batch would cost under $1 at measured rates against a $13 to $26 bound.

## Stop conditions

Stop and report the blocker if:

- the eight local evidence IDs stop matching the Goldfish campaign directories;
- the Modal Goldfish files or the Volume Matrix files hash differently from the local copies;
- Rust rejects the resumed checkpoint or any input on the Volume;
- 16-core and 32-core scientific files differ by any byte;
- a relaunch replays a committed look, which shows in the transition timings;
- the batch report shows more concurrent machines than `slots`;
- a bound cannot be computed before a spawn, or a spawn would exceed `maxCostUsd`;
- the commit share exceeds 50% at the chosen core count, which means the shape is not useful without a cadence change.

## Unresolved decisions

- Commit cadence: this plan commits every checkpoint. A follow-up plan is needed only if the benchmark or the batch shows a commit share above 15%.
- Benchmark kingdom: `balance-tuning-090` is recommended. Another kingdom works with the same requests and rules.
- Whether to prove the queue during the eight-kingdom batch by requesting fewer slots than kingdoms. That lengthens the batch; the default is eight slots and a first queue exercise in the larger run.
