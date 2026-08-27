# Strategy-search operator guide

The command accepts one JSON request with exactly two fields:

```json
{
  "kingdomIds": ["deep-beam-tuning-007"],
  "maxActiveCpus": 400
}
```

`kingdomIds` must be a nonempty ordered list of unique registered IDs. `maxActiveCpus` must be a safe integer of at least 10. Ten CPUs are required for the measured whole-stage Goldfish stage-two shape. The command rejects all other fields.

The command has no kingdom, seed, shard, worker, or container defaults from operator input. It derives those values from the registered kingdoms, fixed protocols, the measured Goldfish profile, and observed runtime performance.

## Plan

Run `plan` from a clean committed worktree:

```sh
npm run strategy-search:campaign -- plan --request /tmp/strategy-search-request.json
```

`plan` makes no Modal call. It checks every requested kingdom, derives its 12,972,960-candidate space, and checks the exact executable image allowlist in `strategy-search-image-files.json`.

The output includes:

- the campaign execution ID;
- the ordered per-kingdom evidence IDs;
- the estimated Modal cost, labelled as an estimate;
- the exact run authorization token.

The token binds the ordered request, source digest, evidence IDs, and `maxActiveCpus`. The command does not check a Modal workspace budget.

## Run

Pass the exact token from `plan`:

```sh
npm run strategy-search:campaign -- run \
  --request /tmp/strategy-search-request.json \
  --authorize 'strategy-search-v2.REPLACE_WITH_PLAN_TOKEN'
```

`run` uses Modal Volume `hexdeck-native-strategy-results`. It stores scientific artifacts under `evidence/<kingdom-evidence-id>/`. It stores execution state under `executions/<campaign-execution-id>/`.

A changed `maxActiveCpus` value needs a new token. The existing execution keeps its pinned Goldfish ranges. The new value changes admission concurrency only.

The scheduler pools ready Goldfish jobs across all kingdoms. A kingdom starts Matrix as soon as its reservoir validates, then starts PSRO as soon as its Matrix validates. Ready Matrix and PSRO work has priority, but the scheduler continues to admit bounded Goldfish work.

Workers write only launch-scoped temporary files. One serialized publisher validates the task lease, controller fence, launch intent, bytes, and deterministic path. The publisher then renames and commits a batch of ready files and writes publication receipts. A retry cannot overwrite different bytes.

A complete kingdom is reusable by any later request that has the same per-kingdom evidence ID. No campaign-state import or source repair exists.

## Status

```sh
npm run strategy-search:campaign -- status --request /tmp/strategy-search-request.json
```

`status` calls one bounded read-only Modal function. It cannot start a controller or enqueue work.

The final report includes:

- critical-path and stage wall time;
- peak and average active CPUs;
- CPU use and one reason for every unused CPU interval;
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

The directory contains `report.json` and the final Goldfish, Matrix, and PSRO evidence for each requested evidence ID. Runtime chunks and temporary launch files stay on the Volume.

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
