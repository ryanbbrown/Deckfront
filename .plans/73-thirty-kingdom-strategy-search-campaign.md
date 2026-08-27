# Thirty-kingdom strategy-search campaign

Status: ready for implementation. This plan does not authorize a paid Modal smoke or full campaign launch.

## Goal

Build one resumable campaign command for an explicit list of kingdoms. Each kingdom runs through:

1. ordered Goldfish ranking and a 20,000-strategy reservoir;
2. a matching 50-strategy initial matrix;
3. one threshold-racing Double Oracle run;
4. download and deep validation of the raw evidence.

The paid campaign is complete when every requested kingdom has a validated PSRO artifact on the shared Modal Volume. Local download status is separate. Analytics and reports do not run on Modal and do not gate campaign completion.

## Settled decisions

- The user supplies every kingdom ID. No command, fixture, default, or fallback selects campaign kingdoms.
- The command accepts any nonempty explicit list of registered kingdoms. The production manifest will contain 30 IDs, but tests and an authorized smoke can contain fewer.
- Each kingdom has one threshold-racing run with the current threshold, screen depths, confirmation looks, Bonferroni rule, weighted schedule, single-response admission order, and two-clean-scan closure rule.
- An evidence closure can produce a complete PSRO artifact. A timeout, worker limit, workspace limit, process failure, abort, or other operational stop produces an incomplete resumable artifact.
- A fixed protocol that reaches its last screen or confirmation look without a decision produces `terminal-incomplete`. A resume does not replay it forever. A later protocol extension has a new evidence identity and can import the prior raw score artifacts after deep validation.
- CPU, memory, worker, container, and timeout capacity are not part of evidence identity. A resume can change them without invalidating completed evidence.
- The Volume locator, canonical Goldfish shard partition, Matrix chunk size, and source-image digest are immutable for one campaign because they control artifact location, partition, or code identity.
- There is no code-level campaign cost gate by default. The new campaign path does not use the cumulative worst-case Modal ledger. An operator can set a high Modal workspace budget outside this code as catastrophic protection.
- A paid three-kingdom smoke and the full paid launch each need separate explicit user authorization.
- The campaign uses one Modal image definition and one shared Modal Volume.
- The dependency chain is Goldfish -> Matrix -> PSRO. Report generation is local and out of scope for campaign completion.

## Command interface

Add these operations:

```sh
npm run strategy-search:campaign -- plan --manifest PATH
npm run strategy-search:campaign -- status --manifest PATH
npm run strategy-search:campaign -- run --manifest PATH [--authorize TOKEN]
```

### `plan`

`plan` performs no Modal call and no simulation. It:

- validates the manifest and every kingdom against the registered suite;
- rejects duplicate, unknown, implicit, or empty kingdom lists;
- derives code, rules, candidate-space, and stage identities;
- requires a clean tracked worktree and derives a digest of the exact files copied into the Modal image;
- prints the paid-launch authorization token for the evidence hash and current runtime ceilings;
- prints the stage graph, requested runtime capacity, and a clearly labelled cost and download-size estimate that does not gate launch;
- reports that campaign cost is not gated in code.

### `status`

`status` performs no simulation and launches no missing stage. It:

- reads the saved campaign state when one exists;
- deeply validates every saved remote and downloaded stage artifact;
- reports complete, terminal-incomplete, operationally incomplete, active, and ready stage counts, with exact failure reasons;
- reports active containers and CPUs from saved calls;
- reports the external workspace-budget setting as operator-managed, not verified by this command;
- distinguishes paid evidence completion from local download completion.

When remote artifacts exist, `status` can call one dedicated read-only function that reads only campaign state and content indexes from the Volume. The function has a short fixed timeout and one small container. `status` must not call a shard, Matrix, PSRO, scheduler, or other stage entrypoint. This read-only call has a small Modal charge.

### `run`

The first paid launch requires the exact token printed by `plan`. The token binds the evidence hash and authorized runtime ceilings. The remote campaign state records both. Later invocations can attach, download, validate, or resume under the same or lower ceilings. An increase to CPU, containers, workers, or timeouts requires a new token for the increased ceilings but does not change evidence identity.

`run`:

- creates or attaches to one detached campaign controller;
- resumes only missing or invalid work;
- waits for or reattaches to the controller;
- downloads complete and incomplete raw artifacts;
- validates every downloaded byte against a remote content index;
- exits nonzero when any stage is incomplete or invalid;
- never converts an operational stop into a complete result.

Tests derive tokens only against injected fake launch adapters. No test invokes the Modal CLI, a Modal function, or paid work with an authorization token.

## Manifest

Use one versioned JSON manifest with two separately hashed sections.

### Evidence section

The evidence hash is immutable and includes:

- campaign ID;
- the exact ordered kingdom ID list;
- Git build version and a SHA-256 digest of the exact clean source tree copied into the Modal image;
- rule fingerprints for every kingdom;
- candidate generator and traversal identity;
- four explicit Goldfish seeds per kingdom;
- derived candidate count, retained count, reservoir count, and canonical Goldfish shard partition;
- initial-matrix seed protocol, strategy count, and chunk size;
- all PSRO evidence constants and seed namespaces;
- simulator and artifact schema versions.

Build the image from a deterministic, secret-free source context. Reject a dirty tracked worktree. Exclude `.git`, `.env`, credentials, generated evidence, reviews, build output, and other files that are not part of the image. Recompute and verify the source digest inside the image before any paid stage runs.

The manifest must not supply one seed set as an implicit default for every kingdom. It must map each supplied kingdom ID to exactly four explicit Goldfish seeds.

### Runtime section

A deployment locator outside the runtime hash fixes the shared Modal Volume name for the campaign lifetime. Changing the Volume requires a new campaign or an explicit, separately tested migration; this implementation does not add migration.

The runtime hash includes settings that can change on resume:

- execution mode;
- local download root;
- campaign controller timeout;
- global active-container and active-CPU limits;
- per-stage CPU, memory, thread, worker-batch, and timeout limits;
- commit/checkpoint intervals.

A runtime `dispatchBatchSize` can change how many canonical Goldfish shards the scheduler submits together. It cannot change canonical shard bounds, IDs, or paths.

Changing only the runtime section updates campaign state history but preserves the evidence hash and all valid artifacts. A changed evidence section creates a different campaign and cannot reuse evidence.

Use Zod for manifest parsing because the project already depends on it. Reject unknown keys.

## Evidence identity and existing ordered artifacts

Introduce a current ordered-product schema whose target identity is derived from:

- the registered kingdom definition;
- ordered action-card IDs and order;
- quantity vectors and skeleton count;
- traversal algorithm and candidate count;
- rules fingerprint;
- explicit seed set;
- scorer and build versions.

The current campaign path must not use a kingdom allowlist or kingdom-specific authorization string.

Keep a narrow legacy validator for existing K001, K007, K008, and K009 schema-v1 artifacts so those artifacts still validate. New campaign artifacts use the derived schema and do not add new kingdom-specific constants.

A dry K002 source check must derive and validate its candidate identity without generating candidates or running games. Unknown or changed registered data fails closed.

## Campaign module

Add a deep TypeScript module in `src/sim/strategySearchCampaign.ts`. Its small interface owns:

- manifest parsing and the evidence/runtime hashes;
- registered-kingdom validation;
- deterministic stage IDs and Volume paths;
- campaign and stage state validation;
- legal state transitions;
- content-index validation;
- launch authorization token derivation from evidence identity and runtime ceilings;
- normalized, root-confined content-index path validation.

The script and Modal adapters call this module. Tests use the same interface. Do not duplicate identity or transition rules in the CLI and Python code.

Campaign state is an atomic, hash-sealed JSON artifact with a monotonic revision and fencing token. All state claims and mutations go through one serialized remote state-mutator function. The state-mutator uses expected revision checks, grants one controller lease, rejects concurrent first-launch claims, and increments the fencing token on stale-owner takeover. Every controller verifies its fencing token before a state write or paid launch, so an old controller cannot write or launch after takeover.

Each stage has one of these states:

- `pending`;
- `ready`;
- `active` with one saved Modal call ID, controller fencing token, heartbeat, and saved resource allocation;
- `incomplete` with an exact operational reason and resumable artifact paths;
- `terminal-incomplete` with a fixed-protocol evidence reason and reusable raw artifacts;
- `complete` with validated artifact hashes.

On restart, the scheduler reattaches to every saved active call before it considers a relaunch. A live or successfully completed call is never relaunched. A dead call becomes `incomplete`; only then can the scheduler move it to `ready`. Only a deep stage validator can set `complete`. A terminal-incomplete stage does not automatically return to ready.

## Goldfish stage

Generalize the ordered-product path for every requested registered kingdom.

- Derive the candidate count from the registered kingdom's ordered card IDs, quantity vectors, and skeletons. Record the derived count in evidence. Reject with a clear protocol error when it is not 12,972,960; do not use a fixed Python loop bound as the source of truth.
- Keep 500,000 strategies after seed one and 20,000 after all four seeds.
- Keep sharded Rust scoring.
- Pool ready Goldfish shard calls across all kingdoms under the global campaign container and CPU limits.
- Use deterministic shard IDs and paths.
- Write every shard checkpoint atomically and commit it to the shared Volume.
- Merge stage one only after every stage-one shard validates.
- Start stage two for a kingdom as soon as that kingdom's stage-one cohort validates.
- Finalize ranked and reservoir artifacts only after all stage-two shards validate.
- Write a complete marker last. Missing, stale, overlapping, corrupt, or noncontiguous shards leave the stage incomplete.

The generic campaign path replaces allowlist checks in `scripts/ordered_goldfish_product.ts`, `src/sim/orderedGoldfishProduct.ts`, `src/sim/initialMatrixCalibration.ts`, `scripts/initial_matrix_calibration.ts`, and the campaign launch path in `modal/native_strategy_search.py`. The isolated schema-v1 adapter retains the old target and seed-set checks only for legacy validation.

The scheduler must not wait for all kingdoms to finish Goldfish before it starts a ready Matrix stage.

## Matrix stage

Run one whole Matrix stage function per ready kingdom. The function starts the existing Node controller and resident TypeScript worker pool inside one Modal container.

Preserve current matrix semantics:

- the top 50 ordered-reservoir strategies;
- the exact derived 125-seed list;
- training prefixes at ordinals 1-75 and 1-100;
- held-out calibration evidence at ordinals 101-125;
- upper-triangle cells including diagonal self-play telemetry;
- both fixed-seat, alternating-first-player games per seed;
- full telemetry and no early stop;
- current payoff, seed, telemetry, and equilibrium calculations required by PSRO.

Campaign Matrix artifacts use a new schema. Legacy schema-v2 artifacts and the K007 parity fixture remain on chunk size 5. New campaign runs use evidence-pinned chunk size 25. At a fixed chunk size, batching must preserve seed, payoff, telemetry, strategy, and ordering bytes apart from timing-schema fields. A chunk-size change creates a new evidence identity and cannot mix chunks.

Remove orchestration waste:

- submit several independent cell chunks in one `WorkerPairingRunner` call;
- assign deterministic result slots and write chunk files in exact order;
- keep four to eight workers active when work exists;
- keep validated chunks in memory on a clean run and do not reread them before equilibrium calculation;
- validate every existing chunk once on resume;
- store exact non-overlapping `simulationMs` on deterministic multi-cell batch timing records, not as invented per-chunk elapsed time;
- record total command wall time and worker count.

The campaign Matrix stage writes only the evidence and P75 equilibrium source that PSRO needs. It does not run `analyzeInitialMatrix`, classify archetypes, or create a balance report. Optional P75/P100/held-out analytics run locally after download. Keep campaign complete and incomplete markers in the stage-control root, outside the guarded Matrix output root.

The Python stage wrapper watches explicit checkpoint events from the Node process and commits partial Volume writes while the same Node process remains active. The stage reserves a shutdown margin before the Modal timeout. On that margin it stops cleanly, commits valid chunks, writes an incomplete marker, and exits without a complete marker.

A clean Matrix stage writes its complete marker only after the current deep validator accepts all chunks, batch timing records, and the P75 equilibrium source. Resume reruns only missing or invalid chunks.

## PSRO stage

Extract the kingdom-independent threshold-racing implementation from `scripts/successive_halving_double_oracle_pilot.ts`. Parameterize experiment name, protocol version, run identifier, kingdom, reservoir count, source identity, and checkpoint strings. Keep the existing K007 command as a thin legacy adapter so its tests and saved run-1, run-2, and run-3 artifacts continue to validate.

Run one whole PSRO stage function per ready kingdom. The function starts one Node controller, one resident Rust competitive scorer, one TypeScript confidence worker pool, and the full-telemetry TypeScript matrix-row workers inside one Modal container.

Preserve these evidence rules exactly:

- screen looks at 8, 16, 32, 64, 128, 256, and 512 blocks;
- confirmation looks at 400, 800, 1,600, 3,200, and 6,400 blocks;
- response threshold 0.51;
- screen alpha 0.05;
- confirmation alpha `0.05 / familySize`;
- weighted largest-deficit schedules;
- unchanged confidence-bound operation order per candidate;
- one admitted response at a time;
- 75 matrix seeds per admitted row;
- two clean scans after the latest admission for evidence closure;
- all current simulator, orientation, seed, and queue-order semantics.

Generalization must remove K007 constants, the fixed run-ID range, and hard-coded reservoir size assertions. Protocol values remain explicit in the evidence manifest.

### Raw PSRO evidence

Persist raw score evidence instead of only derived decisions. For every screen, confirmation, and queue retest look, write atomic chunk-level score artifacts with:

- candidate identities and exact order;
- exact candidate and schedule ranges;
- full and suffix schedule blocks with seeds and opponent assignments;
- exact `0..4` score bytes and played counts in candidate-major, block-major order;
- look depth, family size, alpha, threshold, and source hash;
- artifact hash and dimensions.

Seal chunks during a look, then assemble and seal the look before making its confidence decision. A timeout can reuse all complete chunks and rerun only missing ranges. The checkpoint references chunk and look artifacts by path and hash. Resume validates them and does not replay a completed range. Keep all matrix cells and full telemetry for initial and admitted strategies in the PSRO artifact.

The Python stage wrapper commits the Volume after each sealed checkpoint event without restarting the Node controller or resident Rust process.

An evidence closure writes `complete`. These conditions write `incomplete` and preserve all valid evidence:

- operational deadline or Modal timeout margin;
- candidate or matrix abort;
- corrupt or missing look result;
- worker, CPU, container, or workspace limit;
- child process or Volume failure.

A last-look confidence or screen cap with unresolved candidates writes `terminal-incomplete`, not operational `incomplete`. It does not count as closure and does not replay under the same evidence identity. Its raw score chunks can seed a separately authorized protocol extension with a new evidence identity.

Operational `incomplete` reasons remain resumable under the same evidence identity:

- operational deadline or Modal timeout margin;
- candidate or matrix abort;
- corrupt or missing score chunk;
- worker, CPU, container, or workspace limit;
- child process or Volume failure.

## Global Modal scheduler

Add one campaign controller to `modal/native_strategy_search.py` using the existing image and Volume objects.

The controller:

- claims one fenced lease through the serialized state-mutator before any paid call;
- stores state under one deterministic campaign root on the fixed Volume;
- validates state and artifacts before every transition;
- reattaches saved active calls before it launches replacements;
- maintains one active call per kingdom stage;
- uses individual `spawn` calls plus saved `FunctionCall` IDs and nonblocking completion checks, not blocking per-stage `map` barriers;
- flattens Goldfish shard work from all kingdoms into one global pool;
- starts Matrix and PSRO whole-stage calls as soon as their kingdom dependency validates;
- tracks requested containers and CPUs before each launch;
- never exceeds global or per-stage runtime limits;
- rejects a runtime profile that cannot fit its smallest eligible whole stage;
- gives ready PSRO work priority over Matrix work and ready Matrix work priority over new Goldfish shards, then uses an age-based round-robin across kingdoms at the same stage;
- reserves enough global capacity for the highest-priority ready whole stage so continuous shard work cannot starve it;
- lets unrelated kingdoms continue after one failure;
- saves every Modal function call ID for reattachment;
- stops launching before its own timeout margin;
- writes an incomplete campaign state when an operational limit stops progress;
- writes campaign `complete` only after every PSRO stage deep-validates.

Runtime limits control scheduling only. They do not change stage IDs, seeds, artifact hashes, or evidence validity.

The new campaign controller must not call `reserve_cost`, read `LEDGER_PATH`, enforce `GROSS_BUDGET_USD`, reserve worst-case cost, or treat historical reservations as campaign spend. Existing standalone launch commands can keep their current ledger behavior.

Use an external Modal workspace budget for catastrophic protection when the operator chooses to configure one. The campaign command reports this as an operator responsibility and does not claim to verify it.

## Download and local evidence

After the remote campaign reaches complete or incomplete state, build a remote content index for every campaign file that is safe to download. Each index entry includes relative path, byte count, SHA-256, stage identity, and completeness state.

The index validator rejects absolute paths, empty components, `.` or `..`, backslashes, duplicate normalized paths, Unicode or case-fold collisions, symlinks, and any resolved path outside the local campaign root. Extraction never follows a local symlink. Temporary files are created on the destination filesystem before atomic rename.

Package indexed files into deterministic per-stage archives so download does not make one Volume call per small Matrix chunk. Stream and hash each archive, validate every member against the content index, then atomically install valid files. A resumed download skips matching local files and replaces corrupt files. Keep the prior valid local file when a download is interrupted.

At 25-seed chunks, 30 kingdoms produce 191,250 Matrix chunk files before Goldfish and PSRO evidence. The implementation records a byte and file-count baseline from existing evidence and prints a clearly labelled estimate in `plan`. The three-kingdom smoke measures actual archive size, compression, download wall time, and validation wall time before the full launch.

Download complete and partial evidence, including:

- campaign and stage manifests, state, call IDs, failures, and hashes;
- ordered shard checkpoints, ranked parts, reservoir entries, strategy tables, and source identities;
- initial-matrix chunks, seeds, payoff records, diagonal records, and full telemetry;
- PSRO checkpoints, equilibria and weights, matrices and cells, admissions, schedules, raw look scores, and full telemetry;
- acquisitions, plan-position purchases, plays, damage, dead draws, turns, and orientation records contained in telemetry;
- build, rules, scorer, candidate, and artifact identities.

Do not generate archetype labels, balance summaries, card summaries, plots, HTML, or fresh reporting games in the paid campaign. Local analytics can consume the downloaded evidence later.

## Verification

### Unit and fixture checks

- Manifest parsing rejects missing, duplicate, unknown, and implicit kingdom IDs.
- Runtime-only edits preserve evidence and stage IDs.
- Evidence edits produce new IDs and reject old artifacts.
- The authorization token binds the exact evidence hash and authorized runtime ceilings.
- No campaign launch occurs without first-launch authorization.
- Existing K001, K007, K008, and K009 ordered artifacts still validate.
- A dry K002 source validates without games.
- Goldfish shard coverage rejects gaps, overlap, stale identity, and corruption.
- At one fixed chunk size, Matrix batching preserves job order, seed/payoff/telemetry bytes, and resume behavior; timing uses the new batch records.
- A saved K007 Matrix fixture has semantic payoff, telemetry, P75 equilibrium, P100 equilibrium, and held-out parity apart from timing fields.
- Generic PSRO replay has exact K007 decisions, queue order, admissions, matrix, equilibrium, and terminal reason.
- Raw score artifacts reconstruct every saved look prefix exactly.
- PSRO resume reuses complete looks and reruns only missing work.
- Every operational-limit fixture remains incomplete and resumable.
- A final unresolved protocol look becomes terminal-incomplete without replay; a new extended protocol identity can import its validated raw scores.
- Two concurrent first launches create one controller and one set of paid calls.
- Stale controller takeover increments the fence and prevents the old controller from writing or launching.
- Restart reattaches saved live calls before any relaunch.
- The scheduler starts downstream work per kingdom without a cross-kingdom barrier.
- Tight one-container and two-container fixtures prove forward progress and no starvation.
- Global container and CPU accounting never exceeds configured runtime limits.
- One kingdom failure does not stop unrelated ready work.
- Campaign completion ignores download and analytics status.
- Download rejects absolute, parent, symlink, duplicate-normalized, Unicode-colliding, and case-colliding paths.
- Download resumes by hash and never installs a partial file.
- Dirty source or an image-context digest mismatch fails before paid work.
- Volume, canonical shard partition, and Matrix chunk-size edits are rejected for an existing campaign.
- Runtime reductions need no new token; runtime increases above authorized ceilings do.
- Campaign tests prove the new path does not read or gate on the cumulative cost ledger.

### Local integration checks

- Run Goldfish -> Matrix -> PSRO stage adapters against small saved fixtures without Modal or new simulation games.
- Compare local and staged artifact digests for the same fixture.
- Build one Matrix fixture at chunk sizes 5 and 25. Assert identical per-cell seed sequences and semantic payoffs, different evidence hashes and paths, and no mixed resume.
- Batch several Matrix cells and assert exact `(row, column, startSeedIndex)` result placement.
- Interrupt each stage and one mid-look PSRO chunk at deterministic test checkpoints, then verify exact resume.
- Validate a complete multi-kingdom fixture with shuffled task completion order.
- Verify `plan` makes no Modal call.
- Verify `status` calls only the dedicated bounded read-only function and cannot enqueue work.
- Run a local download-throughput smoke with several thousand small fixture files.

### Repository checks

Run and pass:

```sh
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:native
npm run modal:test
```

Also run focused campaign, ordered-product, matrix, PSRO, competitive evaluator, and Modal scheduler tests while implementing each step.

## Implementation order

1. Add manifest, source-image identity, authorization ceilings, fenced state, stage-path, and content-index modules with tests.
2. Add the current derived ordered-product schema and isolated legacy validation at every existing allowlist site.
3. Add the campaign Matrix schema; optimize deterministic batching, clean-run reuse, batch timing, and checkpoint events.
4. Extract and generalize threshold-racing PSRO; add chunk-level raw score artifacts and checkpoint events.
5. The main agent inspects the extraction, legacy parity, raw score reconstruction, and focused tests before Modal work starts.
6. Add deep Goldfish, Matrix, and PSRO stage validators and external control-root markers.
7. Add whole Matrix and PSRO Modal functions with resident processes and periodic Volume commits.
8. Add the fenced global campaign scheduler without campaign cost-ledger gating.
9. The main agent inspects duplicate-launch protection, reattachment, global admission control, incomplete behavior, and focused tests before the CLI is connected.
10. Add `plan`, bounded read-only `status`, `run`, runtime-ceiling authorization, archived download, and local deep validation.
11. Update `package.json`, `README.md`, and focused operator documentation. State that this plan does not supersede plans 71 or 72; they remain protocol and performance evidence. Archive only a document that is truly replaced, with the required banner.
12. Run all verification and the one requested implementation review cycle.

## Paid launch boundaries

Implementation stops after local verification and review.

Do not launch the paid three-kingdom smoke until the user separately authorizes its exact evidence manifest, source-image digest, Volume locator, and runtime ceilings. Use its measured wall time, peak containers, peak CPUs, resume behavior, semantic parity, archive size, download time, validation time, and Modal dashboard cost to choose production runtime settings.

Do not launch the 30-kingdom campaign until the user separately supplies the exact 30 kingdom IDs and explicit full-launch confirmation.
