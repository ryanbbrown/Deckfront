# Goldfish-only Modal operator

This route runs only the completed Rust Goldfish pipeline. It never creates or starts Matrix or PSRO work.

## Request

Create `/tmp/goldfish-modal-balance-tuning-005.json`:

```json
{
  "kingdomIds": ["balance-tuning-005"],
  "workerCores": 32,
  "maxActiveCpus": 512,
  "maxWallSeconds": 3600,
  "maxCostUsd": 100
}
```

All five fields are required. The route has no paid defaults.

- `workerCores` is the Modal CPU request and Rust thread count for each kingdom container. It must be from 16 to 64.
- `maxActiveCpus` is the requested maximum total CPU count. It must fit at least one complete kingdom container. The route uses `floor(maxActiveCpus / workerCores)` containers at once.
- `maxWallSeconds` starts after image deployment, readiness, and execution preparation finish.
- `maxCostUsd` must cover the calculated worst case and cannot exceed the hard route limit of $100.

Each kingdom container uses 8 GiB of memory. The route does not impose a workspace-wide CPU cap. Modal admits work according to the workspace's current limits.

## Plan

Run the local plan first:

```sh
npx tsx scripts/strategy_search_goldfish_modal.ts plan \
  --request /tmp/goldfish-modal-balance-tuning-005.json
```

`plan` makes no Modal call. It prints:

- two tasks for each kingdom;
- kingdom containers, cores per container, maximum scheduled CPUs, and unused capacity;
- task and scientific wall-time limits;
- worst-case Modal compute cost;
- the exact authorization token for this request and source image.

The route uses Modal Functions. Each Function invocation runs in a container; it does not use Modal Sandboxes. The cost guard uses the current Function rates of $0.0000131 per physical core-second and $0.00000222 per GiB-second. The bound includes three attempts for every task, timeout margins, the controller, publisher, readiness, canary, and control calls.

For one kingdom, 512 maximum active CPUs, and a 3,600-second scientific limit, the supported comparison shapes are:

| `workerCores` | Maximum containers | Exact tasks | Kingdom-one timeout | Kingdom-two timeout | Exact worst-case cost |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 16 | 32 | 2 | 1,113 s | 300 s | $1.201972 |
| 32 | 16 | 2 | 707 s | 300 s | $1.595977 |
| 64 | 8 | 2 | 504 s | 300 s | $2.416435 |

The $100 hard cap fits about 70 kingdoms at 32 cores or 45 kingdoms at 64 cores. Run `plan` with the complete request to get the exact bound.

Run `plan` again after any source or request change. The printed token changes when the source, kingdom order, resource shape, timeout, cost limit, or evidence IDs change.

## Paid run

Copy the complete token from `plan`. Then run:

```sh
npx tsx scripts/strategy_search_goldfish_modal.ts run \
  --request /tmp/goldfish-modal-balance-tuning-005.json \
  --authorize 'goldfish-only-v2.REPLACE_WITH_THE_COMPLETE_PLAN_TOKEN'
```

`run` rejects a missing or different token before its first Modal command. The remote controller recalculates the task count and current-rate cost bound before it starts a worker. It also rejects any non-Goldfish task.

Each kingdom runs as two dependent tasks:

1. `goldfish-one-reduce` scores all 12,972,960 candidates, reduces the local score file, validates `top-500000.hgf`, and publishes the final file.
2. `goldfish-two-reduce` scores all 500,000 retained candidates, reduces the local score file, validates `reservoir.hgf`, and publishes the final file.

Each task uses `/tmp/hexdeck-goldfish/<launch-id>/` for scratch files and removes that directory when it finishes or fails. The task checks free disk space before it starts Rust and fails when less than 2 GiB is free. Intermediate score files stay on the container's local disk. Only `top-500000.hgf` and `reservoir.hgf` reach the Modal Volume.

Local deep verification is off by default. Add `--verify` to the `run` command only for final production evidence or an explicit audit.

The route publishes stable evidence paths and bytes. Container shape and execution state do not change the kingdom evidence ID.

## Output

The run writes to:

```text
.data/strategy-search-goldfish/<execution-id>/
```

For each evidence ID it downloads:

```text
evidence/<evidence-id>/goldfish/top-500000.hgf
evidence/<evidence-id>/goldfish/reservoir.hgf
```

The root `report.json` includes:

- scientific wall time for `goldfish-one-reduce` and `goldfish-two-reduce`;
- measured worker, controller, and publisher cost at the same current Modal rates as the guard;
- exact task attempts, retries, CPU use, I/O, and final write time;
- image build and deployment wall time;
- readiness and canary wall time;
- execution preparation wall time;
- Goldfish controller wall time;
- final download wall time;
- post-download verification wall time.

`intermediateSerializationAndReadMs`, `intermediateIoRatio`, and `goldfishIntermediateIoTargetMet` measure container-local disk I/O. Image, deployment, and startup time are not included in the scientific stage wall times.
