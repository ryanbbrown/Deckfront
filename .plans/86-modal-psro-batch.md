# Modal PSRO batch runtime

Status: implementation plan.

## Goal

Run the authoritative Rust PSRO loop on Modal with one complete kingdom per machine and cross-kingdom parallelism. Each kingdom runs the unchanged `hexdeck-goldfish psro` command with all requested cores. Modal runs kingdoms concurrently, queues the rest, and starts the next kingdom when a slot frees. The route downloads the finished evidence into the same local layout that the balance reports read.

The route supports three sizes with one implementation:

1. one paid benchmark kingdom on one machine;
2. eight kingdoms on eight machines at once;
3. a larger set with a bounded number of active machines and a dynamic queue.

Complete Goldfish -> Matrix -> PSRO stays mandatory. PSRO stays the proven loop from `.plans/79-rust-psro-loop.md` with the confirmed queue cap of 100 from `.plans/84-card-balance-smoke.md`, deferred candidates returning through fresh full-reservoir screens, and the two-clean-full-search stop. No screening depth, confirmation depth, alpha, threshold, queue rule, or admission rule changes. No Rust source changes.

## Current state

- `hexdeck-goldfish psro` owns all dependencies between looks and uses one Rayon pool sized by `--threads`. It writes a checkpoint after each look or admission. With `HEXDECK_PSRO_HANDSHAKE` set, it prints `checkpoint <ordinal> <crc>` after each checkpoint and waits for `committed <ordinal>` before the next look.
- `modal/psro_step.py::run_psro_step` starts that command, commits the Modal Volume on each handshake, and collects the output files and `run-report.json`.
- `modal/native_strategy_search.py::strategy_search_psro_job` is a deployed 16-core, 16 GiB, 24-hour Modal Function with `retries=0` and `@modal.concurrent(max_inputs=1)`. It calls `run_psro_step` with 16 threads. Nothing calls it.
- The Goldfish-only route (`.plans/80-goldfish-only-modal-route.md`) deploys the compute app named from the source digest, checks readiness, and publishes `evidence/<evidence-id>/goldfish/top-500000.hgf` and `reservoir.hgf` on Volume `hexdeck-native-strategy-results`.
- Campaign `84e22f519a74f1476e9522f5367073a0125c645d4c5f2e4f757f99cc9c269db6` holds the fresh Goldfish outputs for `balance-tuning-005`, `009`, `021`, `056`, `064`, `090`, `097`, and `126`. The current source derives the same eight evidence IDs, so the Volume Goldfish files match the local download.
- Matrix and PSRO have not run for this retune. The local routine path runs `hexdeck-goldfish matrix` and then `scripts/psro_search.sh` per kingdom.
- The older distributed-within-a-look `parallel-psro` campaign path is not used by this plan and is not revived.

## Decisions

### Matrix runs locally before any paid launch

An initial Matrix is 306,250 games per kingdom. The eight local PSRO runs under the persistent-mana rules played 7.9M to 53.1M games per kingdom, 173.3M in total. Matrix is therefore about 1.4% of the batch. All eight Matrix steps finish in a few minutes on the 14-core host. Pipelining PSRO behind Matrix has no useful gain, so the route runs Matrix for every requested kingdom locally first, then uploads the four Matrix files to the Volume. The operator can inspect the initial equilibrium before paying.

### Modal is the cross-kingdom queue

The client spawns one Function call per kingdom in request order on a handle created with `with_options(cpu=workerCores, memory=..., timeout=..., max_containers=slots, retries=0, scaledown_window=10)`. Modal runs at most `slots` containers and queues the other calls. When a call finishes, the next queued kingdom starts. For eight kingdoms and eight slots, all eight start at once. No project scheduler, controller lease, or task graph exists for PSRO. Modal 1.5.4 supports every option above on `Function.from_name` handles.

### Volume outputs are execution scoped

Each kingdom writes to `psro-executions/<psro-execution-id>/<evidence-id>/`. A second run with the same execution ID resumes from the committed checkpoint. A different core count has a different execution ID and therefore a fresh directory, which makes the 16-versus-32-core benchmark a byte comparison of two complete runs. The route does not publish PSRO files to `evidence/<evidence-id>/psro/`; the local download is the deliverable.

### Volume commits are measured, not assumed

The job commits the Volume once per Rust checkpoint and waits for the commit before the next look, so commit time is pure overhead on the critical path. `balance-tuning-090` had 76 transitions locally. The job reports the commit count, total commit time, and the share of job wall time spent in commits. This plan does not change the commit cadence. If the benchmark shows a commit share above 15% at the chosen core count, a later plan adds a commit-every-N-checkpoints option; restart granularity would then be N looks.

### Core count is chosen by measurement

Rust evidence bytes do not depend on thread count. Plan 79 tests prove byte-identical output at 1, 4, and 10 threads. The benchmark runs the same kingdom at 16 and 32 cores, byte-compares the scientific files, and reports speedup, games per core-second, and cost. Choose 32 cores for the batch when the measured speedup is at least 1.75; otherwise choose 16. If Modal cannot admit a 32-core container, the benchmark records the admission error and the batch uses 16.

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
- `workerCores`: 1 to 64. It is the Modal CPU request, the Rust `--threads` value, and part of the execution ID.
- `maxActiveCpus`: at least `workerCores`. Slots are `floor(maxActiveCpus / workerCores)`. The plan prints the slots and any CPUs that cannot fit another machine.
- `maxWallSecondsPerKingdom`: 300 to 21,600. The Function timeout is this value plus 60 seconds. A timeout kills the container; the committed checkpoint stays on the Volume and a relaunch resumes.
- `maxCostUsd`: at most the route hard cap of $100. It must cover the worst case below.

Memory is a route constant of 8,192 MiB. The PSRO process holds one 20,000-row reservoir, score prefixes, and the expanded matrix, which is far below that. The job reports the child's maximum resident set size so a later run can lower or raise the constant with evidence.

### Cost guard

The guard uses the current Modal Function rates from the Goldfish route: $0.0000131 per physical core-second and $0.00000222 per GiB-second. For one kingdom:

```text
(workerCores × 0.0000131 + 8 × 0.00000222) × (maxWallSecondsPerKingdom + 60)
```

At 16 cores and 7,200 seconds this is $1.6506 per kingdom; at 32 cores it is $3.1723. The route adds the readiness and canary constants from the Goldfish route. `retries=0` means one attempt per launch, so the launch bound is the sum over launched kingdoms.

A relaunch is a new paid launch. The local execution state keeps a ledger: measured cost of finished calls plus the worst-case bound of pending and newly launched calls must stay at or below `maxCostUsd`. `run` refuses a launch that would exceed it.

### Identity

- Kingdom evidence identity and evidence IDs are unchanged and come from `deriveStrategySearch`.
- Input identity is the SHA-256 of the six input files per kingdom: local `goldfish/top-500000.hgf`, `goldfish/reservoir.hgf`, `matrix/pairs.hgm`, `matrix/purchases.hgm`, `matrix/matrix.hgm`, and `matrix/self-play-v1.hst`.
- The PSRO execution ID is the SHA-256 of the canonical JSON of the route name `psro-batch-v1`, the scientific source digest, the ordered evidence IDs, the input hashes by evidence ID, and `workerCores`. Runtime-only code changes, cap changes, and slot changes keep the same execution and can resume it. A scientific source change, other inputs, or another core count start a fresh execution.
- The authorization token binds the complete request, the deployment digest, the ordered evidence IDs, the input hashes, the execution ID, and the cost guard. `run` rejects a missing or different token before its first Modal command. Any input or request change needs a new `plan`.
- The job checks the deployed source identity with `verify_strategy_search_source`, hashes the six Volume input files, and rejects any hash that differs from the launch configuration before Rust starts. Rust then performs its own reservoir, matrix, and checkpoint source checks.

## Volume layout

```text
evidence/<evidence-id>/goldfish/top-500000.hgf          existing Goldfish route output
evidence/<evidence-id>/goldfish/reservoir.hgf           existing Goldfish route output
evidence/<evidence-id>/matrix/pairs.hgm                 uploaded by the client
evidence/<evidence-id>/matrix/purchases.hgm             uploaded by the client
evidence/<evidence-id>/matrix/matrix.hgm                uploaded by the client
evidence/<evidence-id>/matrix/self-play-v1.hst          uploaded by the client
psro-executions/<psro-execution-id>/<evidence-id>/      Rust --out directory
  search-NNNN/*.hpl, retest-NNNN/*.hpl, admission-NNNN.hpa, checkpoint.hpc,
  decisions.hpd, pairs.hgm, purchases.hgm, matrix.hgm, self-play-v1.hst,
  run-report.json                                       Rust operational report
  lease.json                                            job launch guard
  progress.json                                         last committed transition
  job-report.json                                       job timing and cost
```

Scientific files are only the Rust outputs. `lease.json`, `progress.json`, `job-report.json`, and `run-report.json` are operational and are never used for a decision.

## Job changes

`modal/psro_step.py::run_psro_step` gains:

- timing of every `volume.commit()` and a return value with `commitCount` and `volumeCommitMs`;
- an optional `on_checkpoint(ordinal, crc)` callback invoked before the commit so the job can write `progress.json` into the same commit.

`modal/native_strategy_search.py::strategy_search_psro_job` changes to:

1. call `verify_strategy_search_source(config["sourceImage"])`;
2. `volume.reload()`, then compare the SHA-256 of the six input files with `config["inputSha256"]` and fail before Rust on any difference;
3. read `lease.json` in the output directory; if it names another Function call ID that is still pending according to `modal.FunctionCall.from_id(...).get(timeout=0)`, fail with `duplicate PSRO launch`; otherwise write its own `modal.current_function_call_id()` and start time and commit;
4. run `run_psro_step` with `threads=config["threads"]`, the handshake Volume, the progress callback, and `deep_verify=config["deepVerification"]`;
5. write `job-report.json` with worker start and finish epoch milliseconds, Rust elapsed time, total games, games per second, transition timings, commit count, commit time, commit share, maximum child resident set size, requested cores and memory, and the measured cost at the guard rates, then commit;
6. return the same report.

The Function decorator keeps `cpu=16, memory=16384, timeout=86400`; the client overrides all three with `with_options`. The Rust command, arguments, and output layout do not change.

## Client operations

`scripts/strategy_search_psro_modal.ts` owns the operator commands. `src/sim/strategySearchPsroModal.ts` owns request parsing, identity, cost, state transitions, and download selection so tests can cover them without Modal. `modal/strategy_search_psro_runtime.py` is a lightweight local Modal module, like `strategy_search_runtime.py`, with four `local_entrypoint` functions. No operation defaults to a paid action.

### `matrix --request R --root DIR`

Unpaid. For each kingdom in order:

1. If `DIR/<kingdom>/goldfish/` is missing, copy `top-500000.hgf` and `reservoir.hgf` from `.data/strategy-search-goldfish/<campaign>/evidence/<evidence-id>/goldfish/`. The `--goldfish-campaign` option names the campaign. Copies, not symbolic links, because the evidence loader rejects symbolic links.
2. If `DIR/<kingdom>/matrix/matrix.hgm` is missing, run `hexdeck-goldfish matrix --kingdom <id> --reservoir ... --out DIR/<kingdom>/matrix --threads <host cores> --report DIR/logs/<kingdom>-matrix-report.json`.
3. Run the exported structural Matrix check from `src/sim/rustStrategySearchEvidence.ts`: HGM headers, CRCs, reservoir source link, pair order, percentages, stored equilibrium witness, and HST header, source, and order. This is the existing `readMatrixSet` and `readSelfPlay` logic exported as `loadRustInitialMatrixEvidence`.
4. Write `DIR/matrix-batch-report.json` with protocol `routine-matrix-batch-report-v1`.

Deep `matrix-verify` runs only with `--verify`.

### `plan --request R --root DIR`

Unpaid and makes no Modal call. It parses the request, derives evidence IDs, requires the six local input files per kingdom, hashes them, computes slots, timeouts, the worst-case cost, the execution ID, and the token, and prints them. It fails when the worst case exceeds `maxCostUsd` or the hard cap.

### `run --request R --root DIR --authorize TOKEN`

Paid. In order:

1. Validate the token against a fresh `plan` derivation.
2. Lock `DIR/modal-psro/<execution-id>/state.json` with an exclusive file lock for the whole operation. A second `run` for the same execution fails immediately.
3. Deploy the compute app with `modal deploy --name hexdeck-strategy-<digest24> modal/native_strategy_search.py` and run readiness through `strategy_search_compute_ready`, exactly as the Goldfish route does, with the same timeouts and failure recording.
4. `launch_entry`: check that both Goldfish files exist on the Volume for every kingdom; upload the four Matrix files for every kingdom that will be launched with `Volume.batch_upload`; spawn one call per kingdom that is not complete and has no pending call; record call IDs, spawn time, and the launch cost bound in the state file; then poll every 15 seconds with `FunctionCall.get(timeout=0)` until every call is terminal. A local interruption does not stop the Modal calls.
5. `download_entry` and structural validation as in `download`.
6. Write the batch report.

A second `run` with the same token after a failure or interruption resumes: it reattaches to pending calls, skips complete kingdoms, and relaunches only failed or missing kingdoms within the cost ledger. A relaunched kingdom resumes from its committed checkpoint on the Volume; no completed look is replayed.

### `status --request R --root DIR`

Unpaid apart from Volume reads. It reads the state file, polls each recorded call, reads each kingdom's `progress.json`, and prints per kingdom: queued, running, complete, or failed; the last committed transition kind, search, ordinal, depth, and time; commit count and commit time so far; and the measured cost so far. It prints the batch makespan so far, active machines, and the ledger against `maxCostUsd`.

### `download --request R --root DIR`

Downloads every scientific file and `run-report.json` from `psro-executions/<execution-id>/<evidence-id>/` into `DIR/<kingdom>/psro/` for each complete kingdom. It writes to a temporary directory and renames only after every file is present. It then runs `loadRustStrategySearchKingdomEvidence` for the kingdom, which checks HGM, HPS, and HST headers, CRCs, source links, checkpoint completion, final Matrix order, and self-play bounds. It writes `DIR/psro-batch-report.json` with protocol `routine-psro-batch-report-v1`, `confirmedQueueCap: 100`, `stoppingRule`, per-kingdom searches, admissions, final matrix size, clean final searches, and `allValid`. This is the format `generate_rust_strategy_search_balance_report.ts` accepts.

Deep `psro-verify` runs only with `--verify`.

`--compare-with DIR2` byte-compares the scientific files of a downloaded kingdom with another local PSRO directory and reports `identical` per file. The benchmark uses it.

## Reports

`DIR/modal-psro/<execution-id>/report.json` records:

- image build and deploy wall time, readiness and canary wall time, upload wall time and bytes, launch wall time, download wall time and bytes, structural validation wall time;
- per kingdom: evidence ID, call ID, spawn, start, and finish epoch milliseconds, queue delay, job wall time, Rust elapsed time, total games, games per second, games per core-second, transition count, non-transition share of Rust elapsed time, commit count, commit time, commit share, maximum resident set size, measured cost;
- batch: makespan from first spawn to last finish, peak concurrent machines, sum of measured cost, the worst-case bound, and the ledger.

The benchmark comparison report adds speedup, cost ratio, commit share at each core count, and the byte-comparison result.

## Local dynamic queue

Plan 85 ran local PSRO in fixed waves of seven two-thread processes. Under a dynamic seven-worker queue the earlier eight would have taken an estimated 51.4 minutes instead of 91.5, and the newly chosen eight 40.2 minutes instead of 57.9. Add `scripts/psro_batch_local.sh <root> <workers> <threads> <kingdom>...`. It pipes the kingdom list through `xargs -P <workers>` into `scripts/psro_search.sh` with the root layout and writes `<root>/logs/<kingdom>-psro-console.log`. It has no scheduler state and does not touch the Modal path. It is the last implementation step and can be dropped without affecting the route.

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
- `src/sim/rustStrategySearchEvidence.ts` to export the Matrix-only loader;
- `package.json` with `strategy-search:psro-modal` and `psro:batch-local`;
- `README.md`.

Do not edit Rust sources, `strategy-search-scientific-files.json`, or the Rust kingdom table. `strategy-search-image-files.json` already contains `modal/psro_step.py` and `modal/native_strategy_search.py`; the new runtime module runs locally and is not added.

## Tests

TypeScript tests prove:

- strict request parsing rejects missing fields, extra fields, unknown kingdoms, duplicate kingdoms, `maxActiveCpus` below `workerCores`, wall seconds outside 300 to 21,600, and cost above the hard cap;
- slots, timeouts, and the worst-case cost match the rates and formula, including $1.6506 at 16 cores and $3.1723 at 32 cores for 7,200 seconds;
- the execution ID changes with the scientific digest, evidence order, any input hash, and `workerCores`, and does not change with caps, slots, or the deployment digest;
- the token changes with every request field, the deployment digest, and every input hash, and `run` refuses without it;
- `plan` makes no adapter or Modal call;
- state transitions: a pending call is never respawned, a complete kingdom is never launched, a failed kingdom is relaunched once per `run`, and a launch that exceeds the ledger is refused;
- download selection excludes `lease.json`, `progress.json`, and `job-report.json` and includes every scientific file and `run-report.json`;
- the byte comparison reports identical and differing files.

Python tests prove:

- `run_psro_step` times commits, counts them, and calls the progress callback before each commit;
- the job passes `config["threads"]` to Rust, rejects a differing input hash before Rust starts, rejects a live lease from another call, accepts a lease whose call is terminal, writes `job-report.json`, and reports cost at the guard rates;
- the runtime entrypoints spawn only launchable kingdoms with the requested options, persist call IDs before polling, reattach from a state file, and download only the selected files. Modal Functions, calls, and the Volume are fakes.

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
2. `strategy_search_psro_job`: source check, input hashes, lease, progress, job report, with tests.
3. `modal/strategy_search_psro_runtime.py`: preflight, launch, status, and download entrypoints, with fake-Modal tests.
4. `src/sim/strategySearchPsroModal.ts`: request, identity, cost guard, token, state machine, download selection, with tests.
5. `src/sim/rustStrategySearchEvidence.ts`: export the Matrix-only structural loader.
6. `scripts/strategy_search_psro_modal.ts`: `matrix`, `plan`, `run`, `status`, `download`, `--verify`, `--compare-with`, reports.
7. `scripts/psro_batch_local.sh` and the npm commands.
8. `docs/strategy-search-psro-modal.md` and `README.md`.
9. Repository validation above.
10. One implementation review cycle against the recorded pre-implementation SHA.

## Operation after implementation

Each paid step needs explicit user authorization with the exact `plan` output in front of the user. The token is the authorization record.

1. Unpaid: `matrix` for the eight kingdoms with `--goldfish-campaign 84e22f519a74f1476e9522f5367073a0125c645d4c5f2e4f757f99cc9c269db6`. Then `plan` for three requests: `balance-tuning-090` at 16 cores, `balance-tuning-090` at 32 cores, and the other seven kingdoms at the still-open core count with `maxActiveCpus` equal to seven machines. Present slots, timeouts, worst-case bounds, execution IDs, and tokens.
2. Paid, on authorization: run `balance-tuning-090` at 16 cores with `maxWallSecondsPerKingdom` 7,200 and `maxCostUsd` 5. Worst case is $1.66. It is the largest of the eight under the previous rules, 53.1M games and 76 transitions locally, so it gives the clearest scaling and commit-overhead signal.
3. Paid, on separate authorization: run the same kingdom at 32 cores with `maxCostUsd` 5. Worst case is $3.18. Download with `--compare-with` against the 16-core directory. Any differing scientific byte is a blocker. Record speedup, cost ratio, and commit share, and apply the core-count rule.
4. Paid, on authorization: run the other seven kingdoms at the chosen core count with seven slots so all start at once. Worst case is $11.55 at 16 cores or $22.21 at 32 cores. Materialize `balance-tuning-090` from the benchmark that used the chosen core count. The report thread then has all eight kingdoms under one root.
5. Larger sets later use the same request with `maxActiveCpus` set to the approved machine limit. Modal queues the rest and starts each next kingdom when a slot frees.

Expected scale, to be replaced by measurement: local two-thread processes reached 14,000 to 31,000 games per second, so a 16-core Modal machine at half the per-core rate would play 56,000 to 120,000 games per second. `balance-tuning-090` would then take 8 to 16 minutes of game time plus the measured non-transition share of about 21% and the commit time. The whole eight-kingdom batch would cost under $1 at measured rates against a $13 to $23 worst-case bound.

## Stop conditions

Stop and report the blocker if:

- the eight local evidence IDs stop matching the Goldfish campaign directories;
- the Modal Goldfish files or the uploaded Matrix files hash differently from the local copies;
- Rust rejects the resumed checkpoint or any input on the Volume;
- 16-core and 32-core scientific files differ by any byte;
- a relaunch replays a committed look, which shows in the transition timings;
- a second `run` can spawn a kingdom that already has a pending call;
- a worst-case bound cannot be computed before a launch, or a launch would exceed `maxCostUsd`;
- the commit share exceeds 50% at the chosen core count, which means the shape is not useful without a cadence change.

## Unresolved decisions

- Commit cadence: this plan commits every checkpoint. A follow-up plan is needed only if the benchmark shows a commit share above 15%.
- Benchmark kingdom: `balance-tuning-090` is recommended. Another kingdom works with the same requests and rules.
- Whether the eight-kingdom batch should relaunch `balance-tuning-090` for one clean execution instead of reusing the benchmark output. Evidence bytes are identical either way; relaunching costs one more kingdom.
