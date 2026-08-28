# Goldfish-only Modal operator

This route runs only the completed Rust Goldfish pipeline. It never creates or starts Matrix or PSRO work.

## Request

Create `/tmp/goldfish-modal-balance-tuning-005.json`:

```json
{
  "kingdomIds": ["balance-tuning-005"],
  "workerCores": 4,
  "maxActiveCpus": 64,
  "maxWallSeconds": 3600,
  "maxCostUsd": 20
}
```

All five fields are required. The route has no paid defaults.

- `workerCores` is the Modal CPU request and Rust thread count for each score container.
- `maxActiveCpus` is the maximum total CPU count for active score containers. It must be at least 4 so a reducer can run.
- `maxWallSeconds` starts after image deployment, readiness, and execution preparation finish.
- `maxCostUsd` must cover the calculated worst case and cannot exceed the hard route limit of $100.

Reducers use four cores and 8 GiB of memory. Only one reducer can run at a time. The plan reports reducer resources separately from the score-container shape.

## Plan

Run the local plan first:

```sh
npx tsx scripts/strategy_search_goldfish_modal.ts plan \
  --request /tmp/goldfish-modal-balance-tuning-005.json
```

`plan` makes no Modal call. It prints:

- exact task counts for `score-one`, `reduce-one`, `score-two`, and `reduce-two`;
- score containers, cores per container, maximum scheduled CPUs, and unused capacity;
- task and scientific wall-time limits;
- worst-case Modal compute cost;
- the exact authorization token for this request and source image.

The cost guard uses Modal rates of $0.00003942 per physical core-second and $0.00000667 per GiB-second. The bound includes three attempts for every task, timeout margins, the controller, publisher, readiness, canary, and control calls.

For one `balance-tuning-005` kingdom, 64 maximum active CPUs, a 3,600-second scientific limit, and the current measured partition policy, the three comparison shapes are:

| Score shape | `workerCores` | Exact tasks | Worst-case compute cost |
| --- | ---: | ---: | ---: |
| 16 containers × 4 cores | 4 | 137 | $16.880823 |
| 4 containers × 16 cores | 16 | 37 | $15.696675 |
| 1 container × 64 cores | 64 | 11 | $15.657010 |

Run `plan` again after any source or request change. The printed token changes when the source, kingdom order, resource shape, timeout, cost limit, partitions, or evidence IDs change.

## Paid run

Copy the complete token from `plan`. Then run:

```sh
npx tsx scripts/strategy_search_goldfish_modal.ts run \
  --request /tmp/goldfish-modal-balance-tuning-005.json \
  --authorize 'goldfish-only-v1.REPLACE_WITH_THE_COMPLETE_PLAN_TOKEN'
```

`run` rejects a missing or different token before its first Modal command. The remote controller recalculates the task count and current-rate cost bound before it starts a worker. It also rejects any non-Goldfish task.

The run performs these steps in order for each kingdom:

1. `score-one`
2. `reduce-one`
3. `score-two`
4. `reduce-two`
5. Rust verification of both final files
6. download and local deep verification
7. stop

Workers and reducers publish the same evidence paths and bytes as the full campaign route. Partition shape and execution state do not change the kingdom evidence ID.

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

- scientific wall time for each of the four Goldfish stages;
- measured worker, controller, and publisher cost at the same current Modal rates as the guard;
- exact task attempts, retries, CPU use, I/O, and final write time;
- image build and deployment wall time;
- readiness and canary wall time;
- execution preparation wall time;
- Goldfish controller wall time;
- final download wall time;
- post-download verification wall time.

Image, deployment, and startup time are not included in the scientific stage wall times.
