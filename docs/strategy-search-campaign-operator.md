# Strategy-search operator guide

The command accepts one JSON request with exactly two fields:

```json
{
  "kingdomIds": ["deep-beam-tuning-007"],
  "maxActiveCpus": 400
}
```

`kingdomIds` must be a nonempty ordered list of unique registered IDs. `maxActiveCpus` must be a safe integer of at least 4. Four CPUs are the smallest measured useful whole-stage shape. The command rejects all other fields.

The command has no kingdom, seed, shard, worker, or container defaults from operator input. It derives those values from the registered kingdoms, fixed protocols, the measured Goldfish profile, and observed runtime performance.

## Plan

Run `plan` from a clean committed worktree:

```sh
npm run strategy-search:campaign -- plan --request /tmp/strategy-search-request.json
```

`plan` makes no Modal call. It checks every requested kingdom, derives its 12,972,960-candidate space, and checks the deployment allowlist in `strategy-search-image-files.json` and scientific allowlist in `strategy-search-scientific-files.json`.

The output includes:

- the campaign execution ID;
- the ordered per-kingdom evidence IDs;
- the estimated Modal cost, labelled as an estimate;
- the exact run authorization token.

The token binds the ordered request, source digest, evidence IDs, and `maxActiveCpus`. The campaign execution ID binds the deployment digest and ordered evidence IDs, but not capacity. Runtime-only code changes therefore start clean execution state without changing reusable scientific evidence. The command does not check a Modal workspace budget.

## Run

Pass the exact token from `plan`:

```sh
npm run strategy-search:campaign -- run \
  --request /tmp/strategy-search-request.json \
  --authorize 'strategy-search-v2.REPLACE_WITH_PLAN_TOKEN'
```

`run` validates the token before any Modal call. It first records the `image-preparing` phase, then deploys a versioned compute app named from the source digest. The deployment has a 15-minute local timeout. Modal stdout and stderr stream as they arrive; the operator retains only a bounded tail for the final result. The image recipe has three source-copy layers: Node dependency manifests, Rust build sources, and final application sources. A separate lightweight runtime then invokes the deployed readiness function with a 4-minute local timeout. Container module initialization reads the built allowlist and source files from `/workspace`; only local deployment initialization reads the checkout and constructs source-copy layers. Local planning checks the static transitive closure of runtime TypeScript, worker, and JSON imports. Before execution state and the acceptance clock exist, deployed readiness runs one candidate through the exact remote Goldfish worker wrapper, subprocess, zero-time poll, bounded result retrieval, validation, Volume commit, and cleanup. This canary does not serialize production work.

The acceptance clock does not include compute deployment or readiness. After readiness succeeds, a bounded control call creates pinned execution state and starts the acceptance clock. The lightweight runtime invokes the deployed controller without importing or rebuilding the compute app. It requires a fenced state update with an active or completed task within 2 minutes. It prints the function call ID and the accepted task, stage, and CPU counts.

The runtime uses Modal Volume `hexdeck-native-strategy-results`. It stores scientific artifacts under `evidence/<kingdom-evidence-id>/`. It stores execution state under `executions/<campaign-execution-id>/`.

A changed `maxActiveCpus` value needs a new token. The existing execution keeps its pinned Goldfish ranges. The new value changes admission concurrency only.

The scheduler pools ready Goldfish jobs across all kingdoms. A kingdom starts Matrix as soon as its reservoir validates, then starts PSRO as soon as its Matrix validates. Ready Matrix and PSRO work has priority, but the scheduler continues to admit bounded Goldfish work.

Workers write only launch-scoped temporary files. Each worker validates its temporary file once and returns the file digest. One serialized publisher checks that digest, the task lease, controller fence, launch intent, bytes, and deterministic path. The publisher then renames and commits a batch of ready files and writes publication receipts. A retry cannot overwrite different bytes. A job gets at most three retryable worker or launch failures. Module, package, syntax, source-image, and runtime-asset startup failures are terminal. The controller cancels the active sibling wave and persists failed state instead of retrying deterministic failures. Polling follows the installed Modal API contract: built-in `TimeoutError` means pending, while Modal function timeouts and other exceptions mean failure. Every submitted-worker failure records its qualified type, nonempty message, `repr`, traceback, FunctionCall ID, and dashboard URL.

A complete kingdom is reusable by any later request that has the same per-kingdom evidence ID. No campaign-state import or source repair exists.

## Status

```sh
npm run strategy-search:campaign -- status --request /tmp/strategy-search-request.json
```

`status` calls one bounded read-only Modal function in the separate small control app and image. It reads execution state directly from the Volume. It does not depend on the Node, Rust, or simulation image and cannot start a controller or enqueue work. The local Modal command also has a 90-second hard timeout.

Status reports the exact phase: `image-preparing`, `startup-failed`, `controller-starting`, `controller-running`, `controller-stale`, `complete`, or `failed`. A deploy or readiness failure persists `startup-failed` with the bounded Modal error instead of leaving the phase as `image-preparing`. `controller-running` requires a live fenced controller lease. Status reports counts for ready, launching, submitted, retry-backoff, blocked, complete, and failed jobs. It also reports the live lease, common last error, submitted CPUs, stages, and per-stage totals before the final report exists.

The final report includes:

- critical-path and stage wall time;
- peak and average running CPUs from worker start and finish events;
- peak and average submitted CPUs as separate values;
- CPU use and one reason for every unused running-CPU interval;
- candidate throughput;
- bytes read and written;
- Goldfish intermediate I/O ratio;
- final artifact write time;
- admission failures, retries, task count, and Modal compute cost calculated from measured resource time.

## Local files

`run` downloads to:

```text
.data/strategy-search/<campaign-execution-id>/
```

The directory contains `report.json`, `goldfish/top-500000.hgf`, `goldfish/reservoir.hgf`, and the final Matrix and PSRO JSON evidence for each requested evidence ID. `report.json.clientOperations` measures each final download and post-download validator by path, bytes, and wall time. Runtime chunks and temporary launch files stay on the Volume.

A `terminal-incomplete` PSRO result is a failed run. Analytics and balance reports run later and do not change strategy-search completion.

## Authorized K007 smoke

The approved paid acceptance input is:

```json
{
  "kingdomIds": ["deep-beam-tuning-007"],
  "maxActiveCpus": 400
}
```

The authorized range is 400 through 800 CPUs. Do not put K007 in source code as a default. Do not use this authorization for a multi-kingdom run.
