# Goldfish-only Modal route

Status: implementation plan.

## Goal

Add a separate paid route that runs the completed Rust Goldfish pipeline for one or more kingdoms. The route runs `score-one`, `reduce-one`, `score-two`, `reduce-two`, and final Rust verification. It then stops and downloads `top-500000.hgf`, `reservoir.hgf`, and a timing and cost report. It never creates or starts Matrix or PSRO work.

## Request and safety contract

The route accepts one strict JSON request:

```json
{
  "kingdomIds": ["balance-tuning-005"],
  "workerCores": 4,
  "maxActiveCpus": 64,
  "maxWallSeconds": 3600,
  "maxCostUsd": 20
}
```

Every field is required. `workerCores` controls Rust threads and Modal CPU cores for each score container. `maxActiveCpus` controls the maximum total worker CPUs. The plan reports `floor(maxActiveCpus / workerCores)` score containers and any CPUs that cannot fit another complete container. Reducers keep their measured four-core shape and can run one per kingdom in parallel within the same CPU budget.

Validation limits are:

- 1 to 64 score-worker cores;
- enough active CPUs to fit one score worker and the four-core reducer;
- 5 minutes to 6 hours after verified startup;
- a caller cost limit no greater than the route hard cap of $100.

The route does not impose a workspace-wide CPU or container cap. Modal admission applies the workspace's current limits. The cost calculation uses the current Modal Function rates: $0.0000131 per physical core-second and $0.00000222 per GiB-second. Each Function invocation runs in a container; this route does not use Modal Sandboxes. The calculation includes all three permitted attempts for every score and reduction task, the task timeout margins, the bounded controller and publisher, readiness, the Goldfish canary, and bounded control calls. It does not change the older cost constants used by other routes.

`plan` makes no Modal call. It prints exact stage and total task counts, resource shape, timeout limits, worst-case Modal compute cost, the caller cost limit, and an authorization token. The token binds the complete request, source image digest, ordered evidence IDs, execution ID, partitions, and cost calculation. `run` rejects a missing or different token before the first Modal command. The remote controller recalculates and enforces the task count and cost guard before it starts a worker.

The CLI has no operation that defaults to `run`.

## Evidence and execution identity

Reuse the current kingdom evidence identity and final evidence paths. Worker partitions can change with `workerCores` because the Rust reducers require exact coverage and produce the same final bytes for every valid partition.

Use a separate Goldfish-only execution ID. Bind it to the route version, full request, deployment digest, ordered evidence IDs, partitions, and cost calculation. Different shapes therefore have separate execution state and reports without changing scientific evidence identity or final evidence bytes.

Do not add operator-only files to the scientific source allowlist. The native runtime remains in the executable image identity.

## Runtime

Build a schema-version-3 launch bundle that contains only Goldfish partitions, jobs, and task configurations. Add a Goldfish-only controller mode to `modal/native_strategy_search.py` and use the current Goldfish worker, publisher, leases, receipts, retries, deterministic paths, validation, and report accounting.

In Goldfish-only mode:

1. Reject any non-Goldfish task or partition before worker launch.
2. Materialize bounded score windows with the requested score-worker cores.
3. Run and publish stage one, then its reducer.
4. Run and publish stage two, then its reducer.
5. Run the existing Rust `verify` checks before each final publication.
6. Record Goldfish-only completion receipts without claiming Matrix or PSRO completion.
7. Stop when every reservoir is complete.
8. Cancel active work and fail when `maxWallSeconds` expires.

Use the existing deployment and readiness process. Start the scientific timeout after readiness and execution preparation. Download only the two final Goldfish files for each kingdom. Run the existing deep validators on both downloaded files.

The local report separates:

- image build and deploy wall time;
- readiness and canary wall time;
- execution preparation wall time;
- bounded Goldfish controller wall time;
- final download wall time;
- post-download verification wall time;
- scientific wall time for each of the four Goldfish stages;
- measured Modal compute cost from the controller.

## Files

Add:

- `src/sim/strategySearchGoldfishModal.ts` for request parsing, partitioning, bundle creation, exact cost calculation, and authorization;
- `scripts/strategy_search_goldfish_modal.ts` for `plan` and authorized `run`;
- `test/sim/strategySearchGoldfishModal.test.ts` for the public operator contract;
- `docs/strategy-search-goldfish-modal.md` for exact examples and output.

Update:

- `modal/native_strategy_search.py` for Goldfish-only validation, configurable score shape, bounded completion, and reporting;
- `modal/strategy_search_runtime.py` to download only the route finals;
- the matching Python tests;
- `README.md`.

Do not edit Rust scientific logic, Matrix logic, PSRO logic, or the scientific source allowlist.

## High-value tests

TypeScript tests prove:

- `plan` makes no adapter or Modal call;
- strict request parsing rejects hidden defaults, extra fields, unsafe shapes, unsafe cost limits, and unbounded wall time;
- 4-, 16-, and 64-core workers create exact complete partitions and report 16x4, 4x16, and 1x64 shapes at 64 active CPUs;
- exact task counts and worst-case costs use the current Modal rates;
- authorization changes with every paid input and is required before the adapter runs;
- the bundle contains only the four Goldfish stages and keeps the existing evidence IDs and final paths.

Python tests prove:

- the remote cost guard recalculates the current-rate bound and rejects a larger task count, stale price result, excess cost, excess capacity, or any Matrix or PSRO task;
- dynamic Goldfish materialization uses the requested score cores and timeouts;
- Goldfish-only completion stops at `goldfish-two-reduce` and records only Goldfish completion receipts;
- runtime download selection contains only the two Goldfish files;
- worker command construction still passes requested CPU cores as Rust threads;
- image/deploy, readiness, controller, download, verification, and scientific stage timings remain separate.

Run:

```sh
npm run goldfish:native-verify
npm run test:native
npm run modal:test
npm test
npm run typecheck
npm run lint
```

No Modal deployment and no paid run are part of implementation or validation.
