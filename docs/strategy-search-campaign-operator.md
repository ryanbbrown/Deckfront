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

One controller owns all worker-capacity tokens. `maxActiveCpus` covers running Goldfish, Matrix, PSRO, admission-row, and reduction workers. The one-core controller and one-core publisher are separate and appear separately in the report.

The scheduler keeps at most two global worker waves ready. The execution state stores complete deterministic Goldfish partitions and adds jobs as workers consume the ready window. Matrix and PSRO add only the current score look and its reducer. A kingdom starts its four-core Matrix score tasks as soon as its reservoir validates. It starts PSRO only after its complete 125-seed Matrix validates. No kingdom waits for another kingdom's stage.

Small reducers and decisions have first priority. Matrix and PSRO score tasks have second priority and use round-robin kingdom order. Goldfish reduction follows. Goldfish score work is last, but at least one Goldfish task can start whenever downstream work and one Goldfish task both fit. A reducer waits with the `reducer-admission-limit` reason when another reducer uses the configured memory and Volume I/O allowance.

Workers write only launch-scoped temporary files. Each worker validates its temporary file once and returns the file digest. One serialized publisher checks that digest, the task lease, controller fence, launch intent, bytes, and deterministic path. The publisher then renames and commits a batch of ready files and writes publication receipts. Matrix and PSRO retries load valid deterministic chunks and run only missing tasks. A reducer can restart from published chunks. A stale worker from an old controller fence cannot publish.

A job gets at most three retryable worker or launch failures. Module, package, syntax, source-image, and runtime-asset startup failures are terminal. The controller cancels the active sibling wave and persists failed state instead of retrying deterministic failures. Polling follows the installed Modal API contract: built-in `TimeoutError` means pending, while Modal function timeouts and other exceptions mean failure. Every submitted-worker failure records its qualified type, nonempty message, `repr`, traceback, FunctionCall ID, and dashboard URL.

A complete kingdom is reusable by any later request that has the same per-kingdom evidence ID. No campaign-state import or source repair exists.

## Status

```sh
npm run strategy-search:campaign -- status --request /tmp/strategy-search-request.json
```

`status` calls one bounded read-only Modal function in the separate small control app and image. It reads execution state directly from the Volume. It does not depend on the Node, Rust, or simulation image and cannot start a controller or enqueue work. The local Modal command also has a 90-second hard timeout.

Status reports the exact phase: `image-preparing`, `startup-failed`, `controller-starting`, `controller-running`, `controller-stale`, `complete`, or `failed`. A deploy or readiness failure persists `startup-failed` with the bounded Modal error instead of leaving the phase as `image-preparing`. `controller-running` requires a live fenced controller lease. Status reports counts for ready, launching, submitted, retry-backoff, blocked, complete, and failed jobs. It also reports the live lease, common last error, submitted CPUs, stages, and per-stage totals before the final report exists.

The final report includes:

- campaign critical-path time and each kingdom's completion time;
- stage wall time, throughput, and barrier latency;
- peak and average running worker CPUs from worker start and finish events;
- peak and average submitted CPUs as separate values;
- controller and publisher cores as separate values;
- CPU use and one reason for every unused running-worker interval;
- Matrix and PSRO score-worker counts and cross-kingdom score overlap;
- bytes read and written;
- Goldfish intermediate I/O ratio and final artifact write time;
- admission failures, retries, retry cost, task count, and measured Modal compute cost.

## Local files

`run` downloads to:

```text
.data/strategy-search/<campaign-execution-id>/
```

The directory contains `report.json`, `goldfish/top-500000.hgf`, `goldfish/reservoir.hgf`, and the final Matrix and PSRO JSON evidence for each requested evidence ID. `report.json.clientOperations` measures each final download and post-download validator by path, bytes, and wall time. Validated runtime chunks stay on the Volume until the publisher seals the whole kingdom completion receipt. Launch-scoped temporary files are removed during publication.

A `terminal-incomplete` PSRO result is a failed run. Analytics and balance reports run later and do not change strategy-search completion.

## Authorized runtime smokes

Run the one-kingdom smoke first:

```json
{
  "kingdomIds": ["balance-tuning-005"],
  "maxActiveCpus": 400
}
```

After it passes, run one parallel campaign:

```json
{
  "kingdomIds": ["balance-tuning-007", "balance-tuning-009", "balance-tuning-010"],
  "maxActiveCpus": 400
}
```

Both runs must download and deeply validate every final artifact. Do not run the 30- or 160-kingdom campaign under this authorization.
