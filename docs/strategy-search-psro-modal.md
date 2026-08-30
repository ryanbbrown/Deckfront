# Modal PSRO batch operator

This route runs one complete Rust policy-space response oracle (PSRO) search per Modal machine. It runs Matrix locally first. It does not use the older distributed `parallel-psro` campaign path.

## Request

Create a request file such as `/tmp/psro-modal-090-16.json`:

```json
{
  "kingdomIds": ["balance-tuning-090"],
  "workerCores": 16,
  "maxActiveCpus": 16,
  "maxWallSecondsPerKingdom": 7200,
  "maxCostUsd": 5
}
```

All five fields are required. The route has no paid defaults.

- `kingdomIds` is a nonempty ordered list of unique registered kingdom IDs.
- `workerCores` is both the Modal CPU request and the Rust thread count. It must be from 1 to 64.
- `maxActiveCpus` must fit at least one complete worker. The route uses `floor(maxActiveCpus / workerCores)` machines at once.
- `maxWallSecondsPerKingdom` must be from 300 to 21,600 seconds. The Modal Function timeout adds 60 seconds.
- `maxCostUsd` covers the full execution and cannot exceed the route hard limit of $100.

Each machine uses 8 GiB of memory. Deep verification runs locally only when you add `--verify` to `matrix` or `download`.

## Prepare Matrix locally

The `matrix` operation is unpaid. It copies missing Goldfish files from a completed Goldfish campaign, runs the Rust Matrix command, and checks the Matrix and same-strategy telemetry files.

```sh
npx tsx scripts/strategy_search_psro_modal.ts matrix \
  --request /tmp/psro-modal-090-16.json \
  --root .data/damage-retune-86 \
  --goldfish-campaign 84e22f519a74f1476e9522f5367073a0125c645d4c5f2e4f757f99cc9c269db6
```

The command writes each kingdom under `<root>/<kingdom-id>/` and rebuilds `<root>/matrix-batch-report.json`.

## Plan before spending

```sh
npx tsx scripts/strategy_search_psro_modal.ts plan \
  --request /tmp/psro-modal-090-16.json \
  --root .data/damage-retune-86
```

`plan` makes no Modal call. It hashes these six local files for each kingdom:

```text
goldfish/top-500000.hgf
goldfish/reservoir.hgf
matrix/pairs.hgm
matrix/purchases.hgm
matrix/matrix.hgm
matrix/self-play-v1.hst
```

It prints the execution ID, machine slots, unused CPU capacity, timeouts, one-attempt bound, full launch bound, readiness reservation, and authorization token. Run `plan` again after any request, source, or input change.

The attempt bound uses the current Modal Function rates:

```text
(workerCores × $0.0000131 + 8 GiB × $0.00000222) × (maxWallSecondsPerKingdom + 120)
```

At 7,200 seconds, the bound is $1.6642752 for 16 cores and $3.1985472 for 32 cores. The launch bound also reserves general readiness, the Goldfish canary, and the 1-core PSRO readiness check.

## Run the paid search

Use the complete token from `plan`:

```sh
npx tsx scripts/strategy_search_psro_modal.ts run \
  --request /tmp/psro-modal-090-16.json \
  --root .data/damage-retune-86 \
  --authorize 'psro-batch-v1.REPLACE_WITH_THE_COMPLETE_PLAN_TOKEN'
```

`run` rejects a missing or different token before its first Modal command. It deploys the compute image, checks general readiness, then uses a 1-core readiness Function to import the PSRO wrapper and check the Rust `psro` subcommand before it uploads Matrix inputs or starts a worker. It starts at most the planned number of machines. Each machine runs the unchanged Rust `psro` command for one kingdom.

Rust checkpoints every scientific transition. The wrapper commits changed Volume files at most once every 600 seconds and after the final checkpoint. Rust waits for each checkpoint acknowledgement, but it does not wait for a Volume commit when the 600-second interval has not passed. A stopped machine resumes from the last committed checkpoint.

The local ledger records every launch attempt. A measured attempt uses the cost in `job-report.json`. A failed, timed-out, cancelled, or unknown attempt keeps its full bound. Every `run` invocation also keeps a readiness reservation. The client refuses a new attempt when the ledger would exceed `maxCostUsd`.

One local client holds `~/.hexdeck-modal-psro/<execution-id>.lock` for the full run. Do not run one execution from two operator hosts. If a client stops between a spawn and saving its call ID, inspect the Modal dashboard. Then either let `status` adopt the matching Volume lease or run again with `--abandon-launch <launch-id>` after you confirm that the old call will not start.

## Status and resume

```sh
npx tsx scripts/strategy_search_psro_modal.ts status \
  --request /tmp/psro-modal-090-16.json \
  --root .data/damage-retune-86
```

`status` reads Volume files only for attempts that are not complete in local state. It reads a lease when the call ID is missing, progress while a call is pending, and the job report when a call first completes. A complete local attempt uses its stored result. The client polls attempts in parallel and scales its timeout with the attempt count. It prints queued, pending, complete, failed, or unknown state, checkpoint progress, active machines, and the cost ledger.

Run the authorized `run` command again after a local interruption. It attaches to pending calls, skips complete kingdoms, and relaunches failed kingdoms only when the ledger has room. A deployment source change needs a new plan token. The client refuses a new deployment while an old call is pending.

## Download and report

```sh
npx tsx scripts/strategy_search_psro_modal.ts download \
  --request /tmp/psro-modal-090-16.json \
  --root .data/damage-retune-86

npx tsx scripts/strategy_search_psro_modal.ts report \
  --root .data/damage-retune-86
```

`download` copies every PSRO output except `lease.json`, `progress.json`, and `job-report.json` into `<root>/<kingdom-id>/psro/`. It uses up to 16 parallel Volume reads. A failed read gets three retries after delays of 1, 2, and 4 seconds. The client verifies each downloaded size and scales its timeout with the kingdom count.

The client downloads all kingdoms before it replaces any destination. It then removes and replaces each `<root>/<kingdom-id>/psro/` directory in request order. A download failure removes all temporary directories and leaves every destination unchanged. A replacement failure leaves earlier replacements complete and later destinations unchanged. Every command downloads every complete kingdom again. The client then checks headers, CRCs, source links, checkpoint completion, final Matrix order, and same-strategy telemetry.

Add `--verify` to run the deep Rust `psro-verify` command locally. Add `--compare-with <other-root>` to compare every scientific file by SHA-256.

`report` rebuilds `<root>/psro-batch-report.json` from every `<root>/*/psro/run-report.json`. A completed `run` also writes `<root>/modal-psro/<execution-id>/report.json` with deployment, readiness, launch, download, validation, worker, Rust, transition, Volume commit, memory, concurrency, and cost measurements.

## Local dynamic queue

Run complete kingdoms locally with a fixed number of processes and threads per process:

```sh
scripts/psro_batch_local.sh \
  .data/damage-retune-86 7 2 \
  balance-tuning-005 balance-tuning-009 balance-tuning-021
```

The script starts the next kingdom when a process finishes. It writes each console log to `<root>/logs/<kingdom-id>-psro-console.log`. It does not use or change Modal state.
