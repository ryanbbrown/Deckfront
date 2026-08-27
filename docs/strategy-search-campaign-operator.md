# Strategy-search campaign operator guide

The campaign command plans, runs, resumes, downloads, and validates one explicit kingdom selection. It does not choose kingdoms. It does not run analytics or reports.

This campaign plan does not replace plans 71 or 72. Those plans remain the protocol and performance evidence.

## Inputs

Keep both input files outside the tracked source tree:

- a campaign manifest with explicit seeds, protocol settings, runtime capacity, retry backoff (`retryBackoffSeconds` and `retryBackoffMaxSeconds`), and source-image identity;
- a selection manifest with the exact ordered `selectedKingdomIds` list.

The campaign manifest binds the selection manifest's byte SHA-256 and internal digest. The command rejects a different file, reordered IDs, duplicate IDs, unknown IDs, or an ID without four explicit Goldfish seeds.

For the authorized 30-kingdom input, extract the supplied file without copying its IDs into code:

```sh
git show 957ea0e:src/sim/balance-smoke-suite-manifest.json > /tmp/hexdeck-balance-smoke-selection.json
```

## Plan

`plan` makes no Modal call and runs no simulation:

```sh
npm run strategy-search:campaign -- plan \
  --manifest /tmp/hexdeck-campaign.json \
  --selection-manifest /tmp/hexdeck-balance-smoke-selection.json
```

Run `plan` from a clean tracked worktree. The command verifies the exact tracked files copied into the Modal image. It prints:

- the evidence and runtime hashes;
- the first-launch or runtime-increase authorization token;
- task and stage counts;
- requested global containers and CPUs;
- file and container-time estimates labelled as estimates;
- `campaignCostGate: none`.

The code does not set a campaign cost cap. A Modal workspace budget is an operator-managed external control, and this command does not verify it.

## Status

```sh
npm run strategy-search:campaign -- status \
  --manifest /tmp/hexdeck-campaign.json \
  --selection-manifest /tmp/hexdeck-balance-smoke-selection.json
```

`status` calls only the small, bounded, read-only campaign status function. It cannot enqueue campaign work. It reports remote stage counts, exact saved reasons, active containers and CPUs, paid evidence completion, and local download completion.

## First run and resume

The first run needs the exact token from `plan`:

```sh
npm run strategy-search:campaign -- run \
  --manifest /tmp/hexdeck-campaign.json \
  --selection-manifest /tmp/hexdeck-balance-smoke-selection.json \
  --authorize 'campaign-v1.REPLACE_WITH_PLAN_TOKEN'
```

A later run under the same or lower authorized ceilings needs no token. Run `plan` again and supply its new token before increasing controller timeout, global CPUs or containers, or any stage CPU, memory, thread, worker-batch, or timeout ceiling. The runtime manifest also sets the initial and maximum retry backoff. Resumable work keeps retrying until the controller deadline or a platform limit. There is no attempt or spend cap.

`run` initializes or attaches to the fenced campaign controller. It reuses saved calls and artifacts, then creates per-stage archives after active calls stop. The downloader verifies the remote content index, archive hashes, every archive member path, byte count, and SHA-256 before an atomic local install. A resumed download skips matching files and replaces corrupt files. It never follows a symlink.

`run` exits with an error while any stage is ready, active, operationally incomplete, terminal-incomplete, corrupt, or missing. Download status and local analytics do not change paid campaign completion.

## Resume after an execution-source repair

Use this path only when an implementation repair must continue an existing campaign whose evidence source image is immutable. Keep the exact prior campaign manifest. Commit and verify the repair first, then run:

```sh
npm run strategy-search:campaign -- resume-plan \
  --manifest /tmp/hexdeck-prior-campaign.json \
  --selection-manifest /tmp/hexdeck-balance-smoke-selection.json
```

`resume-plan` makes no Modal call. It prints a token that binds the prior evidence hash, prior source digest, current clean source digest, repair identifier, and lineage hash. Confirm the existing app has no tasks, then resume with that exact token:

```sh
npm run strategy-search:campaign -- resume \
  --manifest /tmp/hexdeck-prior-campaign.json \
  --selection-manifest /tmp/hexdeck-balance-smoke-selection.json \
  --authorize-source-repair 'campaign-source-repair-v1.REPLACE_WITH_RESUME_PLAN_TOKEN'
```

Add `--authorize` only when the runtime ceilings also increase. Resume requires the existing prior-evidence campaign state. It does not create a new campaign, relabel saved artifacts, or change their build identity. It verifies the current execution image, writes a sealed source-repair lineage record, keeps completed scheduler tasks, reattaches saved current calls, and schedules only incomplete or ready dependencies.

## Recover an ambiguous launch

A controller crash can leave a durable launch intent without a Modal call ID. `run` never relaunches this work automatically. First use the Modal dashboard to confirm that no live call exists. Then make that assertion explicitly:

```sh
npm run strategy-search:campaign -- recover \
  --manifest /tmp/hexdeck-campaign.json \
  --selection-manifest /tmp/hexdeck-balance-smoke-selection.json \
  --assert-no-live-call controller
```

Use the exact scheduler task ID instead of `controller` for an unbound task launch. Recovery rejects a bound call, an active controller lease, stale evidence, or a task without an unbound intent. It takes a new fence before it makes task work ready.

## Local output

Downloaded evidence is stored under:

```text
<RUNTIME.downloadRoot>/<campaignId>/<evidenceHash>/
```

The root contains `content-index.json`, `archives.json`, campaign state, scheduler state, task configuration, and all indexed stage evidence. Complete stages pass the same deep Goldfish, Matrix, and PSRO validators used on the Modal Volume.

Check local archive installation with 2,000 small files:

```sh
npm run strategy-search:campaign:download-smoke
```

Run analytics only after download. Analytics, balance summaries, plots, HTML, and fresh games are outside campaign completion.
