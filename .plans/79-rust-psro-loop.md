# Rust PSRO loop

Status: approved after plan review v2 (`.reviews/plans/rust-psro-loop/rust-psro-loop-synthesis-v2.md`).

This plan implements step 3, “Search the reservoir for strategies that beat the mix,” in `.html/single-kingdom-strategy-search.html`. The HTML is the product intent. `docs/strategy-search-evidence.md` defines how to interpret the result. `.plans/77-rust-goldfish-reservoir.md` and `.plans/78-rust-matrix-step.md` define the input files and Rust interfaces.

## Goal

One Rust process owns the full policy-space response oracle (PSRO) loop for one kingdom. The process reads the 20,000-strategy reservoir and the first matrix, screens and confirms responses, admits one response at a time, solves each new mix, and stops after two clean searches.

The same command runs locally and on one larger Modal machine. Rust keeps each look in memory and uses all cores. Python only starts the command and collects its files. TypeScript, JSON, task chunks, subprocess score requests, and file handoffs do not run between looks.

The process writes binary evidence after each completed look. Restarting the same command resumes at the next unfinished look. Local and Modal runs with the same inputs produce the same evidence bytes. Timing stays in a separate report.

## Scope

In scope:

- the exact screening, confirmation, admission, queue-retest, and stopping rules below;
- one Rust `psro` command and one Rust `psro-verify` command;
- deterministic seed and opponent schedules;
- binary look, admission, checkpoint, decision, and final matrix evidence;
- restart after a process or machine loss;
- a local shell command;
- a thin Python wrapper and one Modal job that call the same Rust command;
- removal of the old campaign PSRO task-chunk and TypeScript transition path after the Rust path is wired;
- tests, documentation, and local timing.

Out of scope:

- changing the Goldfish strategy space, ranking, or files from plan 77;
- changing the first 50-strategy matrix protocol or files from plan 78;
- skipping prior losers, changing the 51% line, changing any look depth, or adding a time-based stop;
- splitting one kingdom across Modal machines;
- changing balance classification. Reports continue to use `classifyStrategyDamage` as required by `docs/strategy-search-evidence.md`;
- deployment, a paid Modal run, or a 30-kingdom campaign.

## Implementation gate

Planning and the one plan-review cycle happen before the gate. No implementation file changes and no implementation writer start before the parent supplies the frozen, reviewed step-2 commit.

The implementation base must provide the plan-78 behavior in:

- `rust/goldfish/src/matrix.rs`: plan-78 readers, pair scoring, matrix construction, file writing, and verification;
- `rust/goldfish/src/equilibrium.rs`: deterministic maximum-support solve and mix checks;
- `rust/goldfish/src/kernel.rs`: `competitive_game` and purchase and family-damage telemetry;
- `rust/goldfish/src/main.rs`: the step-2 dispatch;
- the plan-78 `balance-tuning-005` kingdom fixture and test-size matrix command.

The base must also preserve the plan-77 reservoir contract: kind 4, 124-byte rows, exactly 20,000 production rows, strategy-number identity, the four Goldfish seeds, the rule fingerprint, and the row CRC. The writer must reuse the frozen Rust readers and game code. The writer must not create another reservoir decoder, strategy mapping, competitive game loop, matrix solver, or matrix file implementation.

Likely overlap with step 2 is limited but real:

- `main.rs` needs the new module and subcommand dispatch;
- `matrix.rs` must expose existing internal helpers to `psro.rs` and must support writing and checking an expanded matrix;
- `equilibrium.rs` may need visibility changes only;
- `kernel.rs` may need visibility changes only;
- both Rust allowlists need `psro.rs`.

A behavior change to step-2 scoring, telemetry, matrix percentages, solver selection, or initial file bytes is a blocker, not an authorized merge fix.

## Input contract

Production command inputs are:

- one plan-77 `top-500000.hgf` with 500,000 rows;
- one plan-77 `reservoir.hgf` with 20,000 rows;
- one plan-78 directory containing `pairs.hgm`, `purchases.hgm`, and `matrix.hgm` for 50 strategies;
- the same kingdom input used by the two earlier steps.

Before any game runs, Rust performs the full plan-77 reservoir checks against `top-500000.hgf` and the full plan-78 `matrix-verify` checks. It also requires:

- the 50 matrix strategy numbers to equal the first 50 reservoir rows in the same order;
- every strategy number to be unique and inside `0..12,972,960`;
- all three matrix files to carry the reservoir row CRC as their source checksum;
- matrix seeds `4,200,001..=4,200,125`;
- a byte-identical re-solve of the stored initial mix.

The PSRO source identity is the kingdom rule fingerprint plus the row CRCs of the reservoir, initial pairs, initial purchases, and initial matrix files. Every PSRO evidence file carries these values. A restart rejects another reservoir or matrix, even when the kingdom ID matches.

## Fixed scientific protocol

### Candidate order and identity

- A candidate is a reservoir row whose strategy number is not in the current matrix.
- Candidate order is reservoir rank order.
- Strategy identity is the plan-77 integer. Display text such as `gf-123` never enters Rust evidence.
- The current matrix order is the initial 50 rows followed by admitted strategies in admission order.

### Scores

One shuffle produces two games with seats swapped, using the same plan-78 seat rules. The candidate gets 2 points for each win, 1 for each draw, and 0 for each loss. The two-game score is one byte in `0..=4`. Confidence calculations divide each byte by 4 and see values in exact shuffle order.

Turn limit is 30 per player. Action cap is 200 per turn. Starting draft and side swapping are off. The first-player health rule stays in the kernel.

### Screening

Each full search freezes the current matrix and mix, excludes matrix strategies, and screens every remaining reservoir strategy.

- Cumulative shuffle depths: `8, 16, 32, 64, 128, 256, 512`.
- Alpha: `0.05` per candidate.
- Upper confidence bound `<= 0.51`: reject.
- Lower confidence bound `> 0.51`: provisional response.
- Otherwise: play the next look.
- Still open after 512: unresolved screening result.

A later look plays only the new suffix. Its confidence calculation uses the candidate’s full ordered prefix from every completed screening look in that search.

The whole screen finishes before confirmation starts. This freezes the confirmation family size.

### Confirmation

Every provisional response from the completed screen is one member of a fixed confirmation family.

- Fresh cumulative shuffle depths: `400, 800, 1,600, 3,200, 6,400`.
- Per-candidate alpha: `0.05 / fixed family size`.
- Lower confidence bound `> 0.51`: confirmed.
- Upper confidence bound `<= 0.51`: rejected.
- Otherwise: play the next look.
- Still open after 6,400: unresolved confirmation result.

Confirmation never reuses screening shuffles.

### Confidence calculation

Rust ports `anytimeConfidenceBounds` from `src/sim/anytimeMeanEvidence.ts` exactly:

- betting values `1/256, 1/128, 1/64, 1/32, 1/16, 1/8, 1/4, 1/2, 1`;
- the same log-mean-exp mixture, maximum log evidence, and two-sided `alpha / 2` tests;
- the same clamp to `[1e-9, 1 - 1e-9]`;
- exactly 21 bisection iterations and the same returned endpoints.

Use the pure-Rust `libm` logarithm and exponential functions. The standard library does not promise bit-identical transcendental results on macOS arm64 and Linux x86-64. `libm` is the only new dependency and is required for cross-machine evidence determinism.

Rust `libm` is the evidence authority. Golden tests pin its returned `f64` bits on macOS arm64 and Linux x86-64. TypeScript uses JavaScript `Math.log` and `Math.exp`, so it is not an exact-bit authority. TypeScript parity requires the same decision for every fixture and bounds within `2^-20`. Include threshold-edge fixtures; any Rust-versus-TypeScript decision difference is a blocker.

### Opponent schedule

Each race builds its complete maximum-depth schedule once. Every look uses a prefix of that schedule, so a later look only adds a suffix.

For schedule position `k`, starting at 1, choose the positive-weight matrix strategy with the largest value of:

`normalized weight × k - assignments so far`

Break equal deficits by lower strategy number. This differs from the old TypeScript implementation when unpadded text IDs such as `gf-10` and `gf-2` tie: the old code used UTF-16 text order. Numeric order is authoritative because the HTML defines strategy-number identity and requires the lower strategy number for ties. Update the retained TypeScript reference helper to accept an explicit numeric tie key; do not use display IDs as schedule keys.

This prefix-stable largest-deficit rule is the exact meaning of the HTML’s current “largest-remainder” sentence. Independent per-look largest-remainder allocations are not guaranteed to be prefixes, so they cannot support suffix-only looks. Update only the step-3 schedule paragraph in the HTML and process document to name this exact rule. This plan supersedes that imprecise sentence; it does not change any screening, confirmation, or admission threshold.

Screening and confirmation each build their own full schedule because confirmation needs fresh shuffles. The matrix and equilibrium weights stay frozen across both races. A queue retest gets the new mix after an admission and builds another fresh schedule.

### Seed rule

Goldfish and matrix seeds remain unchanged. Race seeds are deterministic unsigned 32-bit values from this ASCII preimage:

`rust-psro-v1:<kingdom>:<reservoir-crc>:<initial-pairs-crc>:<search>:<race-kind>:<race-ordinal>:<position>:nonce:<nonce>`

Rendering is exact:

- `<kingdom>` is the registered campaign kingdom ID, without the fingerprint;
- every integer and CRC is lowercase ASCII decimal, without a sign, padding, separators, `0x`, or leading zero except the value 0;
- `<search>` and `<race-ordinal>` start at 1;
- `<position>` is the zero-based index in the race’s full maximum-depth schedule; schedule position `k` in the assignment rule is `<position> + 1`;
- `<nonce>` starts at 0.

Rust applies the existing UTF-16 FNV-1a `stable_hash` function and uses the 32-bit hash value, excluding the display-length suffix. It increments `nonce` until the value is not in the run’s used-seed set. The used set starts with the four Goldfish seeds and 125 matrix seeds and grows with every race. Race kinds are the exact strings `screen`, `confirmation`, and `queue-retest`, so their preimages differ. Search and retest ordinals make every repeated test fresh.

The verifier regenerates every seed and rejects a duplicate, wrong order, reused screen seed, or reused confirmation or retest seed.

### Queue order, admission, and retest

Order confirmed candidates by:

1. higher confidence lower bound;
2. higher mean score;
3. higher confidence upper bound;
4. better Goldfish rank;
5. lower strategy number.

Admit only the first candidate.

For one admission, play the candidate against every current matrix strategy with all 125 matrix shuffles and both seats. The current matrix order appends the admitted candidate, so each new upper-triangle pair is `(prior matrix strategy, admitted strategy)`. Store the prior strategy’s 0-to-4 point byte for each shuffle; if scoring first produces the admitted candidate’s byte `x`, write `4 - x`. Store both strategies’ purchase counts and family-damage totals. Add the new row and column. Rebuild percentages from shuffles 1 through 75 and solve the mix with the frozen plan-78 solver.

Retest the remaining confirmed queue against the new mix. A queue retest uses fresh seeds, confirmation depths, and per-candidate alpha `0.05 / family size`, where the family is fixed to the remaining queue at the start of that retest. Order the candidates that confirm again by the same five rules. Admit one, solve again, and repeat. Rejected or unresolved retest candidates leave the queue.

An admission resets the clean-search count to 0.

### Clean searches and completion

A full search is clean when it produces no confirmed response. Screening or confirmation candidates can remain unresolved at their caps; those results are recorded and do not block a clean search.

After the queue empties, start a new full reservoir search against the latest mix. Stop after two consecutive clean searches. A missing, corrupt, partial, or failed look is operationally incomplete and never counts as clean. Elapsed time never changes a scientific decision.

## Rust design

Add `rust/goldfish/src/psro.rs`. Keep one owner for each rule:

- `kernel.rs` plays one competitive game;
- `matrix.rs` scores pairs, reads and writes matrix files, builds percentages, and checks matrix evidence;
- `equilibrium.rs` solves and checks the mix;
- `psro.rs` owns schedules, confidence, races, queue order, admissions, restart state, and PSRO evidence.

The process builds one Rayon pool with the requested thread count. It does not create a process or a new pool per look.

For a look, create a deterministic indexed list of `(candidate rank, suffix schedule position)` jobs. Rayon evaluates that list in parallel. Collection restores candidate-major and schedule order before confidence runs. This keeps all cores busy when there are many candidates and when a late look has only a few candidates but many shuffles.

Keep the reservoir, compiled current matrix strategies, active candidates’ score prefixes, current schedules, matrix point rows, purchases, and current mix in memory. A look boundary is a Rust function call followed by one evidence commit. No result file is read to decide the next transition during the same process.

Commands:

```text
hexdeck-goldfish psro \
  --kingdom <id> \
  --top-file FILE \
  --reservoir FILE \
  --matrix-dir DIR \
  --out DIR \
  --threads T \
  [--report FILE]

hexdeck-goldfish psro-verify \
  --kingdom <id> \
  --top-file FILE \
  --reservoir FILE \
  --matrix-dir DIR \
  --out DIR
```

If the frozen merged base still exposes only plan 78’s `--kingdom-file`, use the same kingdom-file argument for these commands. Do not add a second kingdom representation. Normalize on plan 77’s embedded table only when that table is present in the parent-provided base.

A test-only invocation may add `--matrix-size N --candidate-limit M`. Both options must be explicit together.

- `--matrix-size N` requires `N >= 2`, requires the input matrix files to contain exactly the first `N` reservoir strategies, and passes the equivalent explicit size to the frozen plan-78 readers.
- `--candidate-limit M` requires `M >= 1` and restricts each full search to the first `M` eligible nonmatrix reservoir rows in rank order. Matrix strategies are excluded before the limit is applied.
- The reservoir must contain at least `N + M` rows. Its production 20,000-row rule is lifted only for this paired test invocation. The plan-77 top-file cross-check still runs against every reservoir row present.

Production and Python callers pass neither option and require matrix size 50 and reservoir size 20,000. `psro-verify` rejects shortened inputs unless it receives the same pair and values.

## Binary evidence

All integers are little-endian. No evidence file contains JSON, paths, timestamps, thread counts, host names, or elapsed times.

### Common header

Every PSRO file starts with this 128-byte header:

| Offset | Bytes | Field |
| ---: | ---: | --- |
| 0 | 4 | magic `HPS1` |
| 4 | 4 | format version 1 |
| 8 | 4 | kind: 1 screen, 2 confirmation, 3 queue retest, 4 admission, 5 checkpoint, 6 decisions |
| 12 | 4 | header bytes, 128 |
| 16 | 4 | payload bytes |
| 20 | 4 | CRC-32 of the payload |
| 24 | 4 | reservoir row CRC |
| 28 | 4 | initial pairs row CRC |
| 32 | 4 | initial purchases row CRC |
| 36 | 4 | initial matrix row CRC |
| 40 | 4 | matrix generation, 0 before any admission |
| 44 | 4 | search ordinal, starting at 1 |
| 48 | 4 | race or admission ordinal |
| 52 | 4 | cumulative look depth, 0 when not a look |
| 56 | 4 | previous cumulative depth |
| 60 | 4 | fixed family size |
| 64 | 4 | row count |
| 68 | 4 | row bytes, or 0 for variable checkpoint and decision payloads |
| 72 | 4 | suffix schedule entry count |
| 76 | 4 | kingdom card count |
| 80 | 8 | alpha as `f64` bits, 0 when not a look |
| 88 | 8 | threshold 0.51 as `f64` bits, 0 when not a look |
| 96 | 16 | rule fingerprint, ASCII and NUL padded |
| 112 | 16 | protocol tag `rust-psro-v1`, ASCII and NUL padded |

Writers reject a fingerprint or protocol tag that does not fit. CRC-32 uses the plan-77 IEEE implementation.

### Look files

Names are deterministic:

- `search-0001/screen-0008.hpl`;
- `search-0001/confirmation-0400.hpl`;
- `retest-0001/confirmation-0400.hpl`.

The payload starts with suffix schedule entries of `seed u32, opponent strategy number u32`. Rows then follow in reservoir rank order.

Each fixed-size row contains:

- candidate strategy number `u32`;
- Goldfish rank `u32`;
- decision byte: 0 unresolved, 1 below or rejected, 2 provisional or confirmed; the file kind gives the stage meaning;
- three zero padding bytes;
- cumulative mean, lower bound, and upper bound as three `f64` values;
- one point byte for each suffix shuffle;
- candidate purchase counts as one `u32` per kingdom card for the suffix games;
- candidate family-damage totals as five `u32` values for the suffix games.

Rows contain only candidates that were active when that look started, in reservoir rank order. A candidate resolved in this file does not appear in a later look from the same race. The row size is recorded because suffix depths differ. The score prefix lives in prior files from the same race. The verifier joins those files in depth order before it recomputes each bound and decision. Unused fixed-width point padding is not written.

### Admission files

`admission-0001.hpa` is immutable. Its payload order is:

1. a 56-byte admission prefix: admission ordinal, search ordinal, confirmation or retest race ordinal, candidate number, Goldfish rank, matrix size before, matrix size after, and queue count as eight `u32` values, then mean, lower bound, and upper bound as three `f64` values;
2. the complete ordered queue as `queue count` strategy-number `u32` values;
3. the mix before admission: count `u32`, then count entries of strategy number `u32` and weight `f64` in matrix order;
4. the mix after admission in the same encoding;
5. one fixed row per prior matrix strategy.

An admission row is `opponent number u32`, 125 point bytes for the prior matrix strategy, then candidate telemetry and opponent telemetry. Each telemetry value is one `u32` per kingdom card followed by five family-damage `u32` values. Its row size is `4 + 125 + 2 × (4 × card count + 20)`. Rows use prior matrix order. The file binds the exact evidence that grows the matrix without replaying a game.

### Checkpoint and decisions

`checkpoint.hpc` is one manually encoded, versioned binary state. Its payload starts with a 96-byte checkpoint prefix:

| Offset | Bytes | Field |
| ---: | ---: | --- |
| 0 | 1 | status: 0 running, 1 complete |
| 1 | 1 | phase: 0 screen, 1 confirmation, 2 queue retest, 3 admission, 4 between searches, 5 complete |
| 2 | 2 | zero padding |
| 4 | 4 | search ordinal |
| 8 | 4 | look index inside the current depth list |
| 12 | 4 | queue-retest ordinal |
| 16 | 4 | admission count |
| 20 | 4 | matrix generation |
| 24 | 4 | clean-search count |
| 28 | 4 | matrix entry count |
| 32 | 4 | fixed-family entry count |
| 36 | 4 | active-candidate entry count |
| 40 | 4 | queue-record count |
| 44 | 4 | completed-file reference count |
| 48 | 4 | current race ordinal |
| 52 | 4 | previous completed depth |
| 56 | 4 | next expected depth, or 0 |
| 60 | 36 | zero reserved bytes |

Variable sections follow in this exact order:

1. matrix entries in matrix order, each `strategy number u32, weight f64`;
2. fixed-family entries in reservoir rank order, each `strategy number u32, Goldfish rank u32`;
3. active-candidate entries in reservoir rank order with the same 8-byte layout;
4. queue records in queue order, each 48 bytes: strategy number, rank, blocks, source search, source race, and zero reserved as six `u32` values, then mean, lower bound, and upper bound as three `f64` values;
5. completed-file references in transition order, each 24 bytes: kind, matrix generation, search, race or admission ordinal, depth, and payload CRC as six `u32` values.

The next expected file name is derived from the phase and counters; no path or string is encoded. Every reserved byte must be zero. The checkpoint does not copy point bytes. Those stay in immutable look and admission files.

At completion, Rust writes `decisions.hpd`. Its payload starts with eight `u32` values: final status 1, stop reason 1 for two clean searches, decision-record count, admission-record count, equilibrium-snapshot count, search-summary count, final matrix generation, and final clean-search count. The following sections are exact:

1. decision records in transition order, 56 bytes each: stage byte (0 screen, 1 confirmation, 2 queue retest), status byte (0 unresolved, 1 below or rejected, 2 provisional or confirmed), two zero bytes, then search, race, look depth, candidate number, Goldfish rank, blocks, and family size as seven `u32` values, then mean, lower, and upper as three `f64` values;
2. admission records in admission order, using the 56-byte admission prefix from `.hpa`, followed immediately by that record’s queue strategy numbers;
3. equilibrium snapshots in matrix-generation order: generation `u32`, count `u32`, then count entries of strategy number `u32` and weight `f64` in matrix order;
4. search summaries in search order, 28 bytes each: search ordinal, result (0 admitted, 1 clean), provisional count, confirmed count, unresolved-screen count, unresolved-confirmation count, and clean-search count after the search as seven `u32` values.

The verifier rejects unknown enums, wrong counts, nonzero padding, wrong section order, or trailing bytes. It derives this summary from the immutable files and requires byte equality.

### Expanded matrix outputs

After each admission, Rust rebuilds these files from the initial plan-78 evidence plus immutable admission files:

- `pairs.hgm`;
- `purchases.hgm`;
- `matrix.hgm`.

They keep plan-78 kinds 5, 6, and 7 and the same row layouts. Their range is `[0, N)`, where `N` is the current matrix size. Pair and purchase rows use the current matrix order and upper-triangle pair order. `matrix.hgm` uses all 125 stored point bytes for evidence, the first 75 for percentages, and the plan-78 solver for weights. `psro-verify`, not the step-2 production-size guard, checks these expanded files.

`matrix.hgm` is the completion marker for one admission. It is renamed last after the pair and purchase files pass all checks.

## Atomic write and restart rules

For each completed look or admission:

1. Build the complete evidence bytes in memory.
2. Write a `.tmp` file, flush it, and sync it.
3. Verify its header, CRC, source identity, schedule, rows, and decisions.
4. Rename it to its deterministic final name and sync its parent directory.
5. Write and sync `checkpoint.hpc.tmp`, rename it to `checkpoint.hpc`, and sync the output parent directory.
6. In Modal handshake mode, print and flush `checkpoint <transition-ordinal> <checkpoint-payload-crc>` and wait. Python commits the Modal Volume, then replies `committed <transition-ordinal>`. Rust checks the ordinal before it starts the next look. The two lines are operational control text, not JSON or evidence. Local mode has no handshake.

On startup:

- verify the top file, reservoir, and all three matrix input files before reading the checkpoint;
- reject a checkpoint with another source identity or invalid transition;
- remove an incomplete `.tmp` file;
- if the next deterministic final evidence file exists and is valid but the checkpoint does not name it, replay the transition from that file and advance the checkpoint without replaying games;
- reject a corrupt final evidence file instead of overwriting it;
- rebuild every active candidate’s ordered score prefix from committed look files, checking active membership and decisions at each depth;
- continue by scoring only the suffix for the first unfinished look.

An admission file is committed before expanded matrix files. If the process stops between those writes, restart rebuilds the matrix files from the admission file. No completed games are replayed.

A clean output directory and a resumed output directory must finish with byte-identical evidence files. Operational reports can differ.

## Verification

`psro-verify` starts from the reservoir and initial matrix and independently replays every scientific transition from evidence bytes. It checks:

- every header, source checksum, row size, row count, CRC, file name, ordinal, and state transition;
- candidate rank order, identity, matrix exclusion, and no duplicate candidate;
- all seed formulas, collision nonces, stage separation, schedule prefixes, opponent assignments, and score bytes in `0..=4`;
- cumulative score prefixes, confidence `f64` bits, strict 0.51 boundaries, fixed family sizes, and every unresolved result;
- confirmation and queue ordering and one-at-a-time admission;
- every admission row against the matrix order and 125 matrix seeds;
- plan-78 purchase and family-damage bounds;
- every expanded pair, purchase, percentage, strategy number, mix weight, and CRC;
- a byte-identical equilibrium re-solve after every admission;
- clean-search resets and exactly two clean searches at completion;
- a byte-identical `decisions.hpd` reconstruction.

Verification prints one small JSON summary for operators. JSON is not evidence and is not read by the Rust loop.

## Local and Modal entrypoints

Add `scripts/psro_search.sh <kingdom-id> <threads> <top-file> <reservoir> <matrix-dir> <out-dir>`. It builds or locates the release binary, runs `psro`, then runs `psro-verify`. Add an npm command that calls the script. Local execution needs no Python or TypeScript.

Add `modal/psro_step.py` with one plain wrapper:

`run_psro_step(binary, kingdom, top_file, reservoir, matrix_dir, out_dir, threads, report=None)`

It runs the Rust command, keeps a bounded stderr tail on failure, runs `psro-verify`, and returns output paths, byte counts, and the parsed operational report. In Modal mode it owns the checkpoint handshake: on each valid Rust checkpoint signal it calls `volume.commit()`, then sends the matching acknowledgement. A commit failure stops the child process and leaves the look operationally incomplete. The wrapper makes no schedule, confidence, queue, admission, or stopping decision.

Add one Modal function with 16 CPUs and enough memory for the reservoir, scores, and expanded matrix. It gives one kingdom one machine and calls this wrapper with 16 Rust threads. The function does not fan out a look.

Replace the campaign’s dynamic PSRO job graph with one `psro` job per kingdom. That job depends on the kingdom’s validated matrix result, runs the one Modal function, publishes the complete output directory only after `psro-verify` passes, and records one completion receipt. A kingdom starts without waiting for another kingdom. Retries call the same command and use the checkpoint. The controller does not inspect a look or make a scientific transition.

Tests patch subprocess, Volume, and Modal calls. Do not deploy or call the function during this task.

## Old campaign path removal

After the Rust command and wrapper are wired, remove the obsolete distributed campaign PSRO path:

- `src/sim/strategySearchParallelPsro.ts` and its campaign-only tests;
- `src/sim/strategySearchPsro.ts` if it has no non-campaign caller;
- `scripts/strategy_search_campaign_parallel_psro.ts` and the old monolithic `scripts/strategy_search_campaign_psro.ts` after their callers use the Rust command;
- `scripts/strategy_search_validate_psro_score_receipt.ts`;
- the campaign `psro-decision`, `psro-score`, `admission-row-score`, `admission-row-reduce`, and `psro-reduce` job expansion, task receipt, reducer, and publisher branches in `modal/native_strategy_search.py`;
- the old PSRO subprocess entries in `scripts/strategy_search_subprocess.ts`;
- image and scientific allowlist entries that only supported those files.

Update `scripts/strategy_search_validate_artifact.ts` and `src/sim/strategySearchStages.ts` to treat a passing Rust `psro-verify` result and the published file checksums as the final PSRO artifact. They must not decode scores or repeat scientific decisions in TypeScript.

Keep `src/sim/anytimeMeanEvidence.ts`, the relevant parts of `src/sim/thresholdRacingPsro.ts`, and their tests as the TypeScript scientific reference for Rust parity. Keep non-campaign research scripts only when they still have a named current use. Delete a dependent module or test when the removed campaign path was its last importer. Typecheck and tests must prove there is no dangling path.

This removal does not authorize a change to Goldfish or initial matrix behavior. Do not remove the Rust JSON competitive protocol if a retained conformance test or current research command still uses it.

## Documentation

- Update `README.md` with the local PSRO command, outputs, restart behavior, and verification command.
- Update only step 3 in `.html/single-kingdom-strategy-search.html`: replace the imprecise per-look largest-remainder sentence and fixed padded-row description with the prefix-stable largest-deficit schedule and suffix look files from this approved plan. Do not change step 1 or step 2.
- Rewrite step 3 in `docs/strategy-search-process.md` to match this single-process Rust implementation while preserving the scientific rules.
- Update `docs/strategy-search-campaign-operator.md` so Modal runs one kingdom per larger machine and does not describe PSRO task chunks.
- Keep `docs/strategy-search-evidence.md` unchanged unless a factual file-location sentence needs an update. Do not change its interpretation rules.
- Archive `.plans/76-global-matrix-psro-runtime.md` with a banner that names plans 78 and 79 as its replacements. Add the archive index row.

## Tests

### Rust unit tests

- Rust confidence bounds have pinned `f64` golden bits at all seven screen depths and all five confirmation depths; TypeScript bounds are within `2^-20` and every decision matches, including threshold-edge cases;
- `libm` results and final evidence bytes match on macOS arm64 and Linux x86-64;
- schedule assignment matches numeric-key TypeScript golden vectors, including zero weights and the equal-deficit `gf-2` versus `gf-10` case;
- seed generation pins exact decimal preimages, zero-based positions, fresh searches and retests, disjointness from Goldfish and matrix seeds, and deterministic collision nonces;
- queue order covers every tie field;
- a state-machine fixture covers screen rejection, provisional response, capped unresolved screening, confirmation rejection, confirmation success, capped unresolved confirmation, admission, queue-retest rejection and success, clean-search reset, and two-clean-search completion;
- malformed headers, CRCs, source checksums, schedules, score bytes, ranks, family sizes, bounds, decisions, queues, admissions, mixes, and stop states are rejected;
- a reservoir with a valid CRC but a wrong top-file source link or wrong shuffle-1 rows is rejected;
- an asymmetric admission pair proves that expanded upper-triangle bytes store the prior matrix strategy’s score, not the admitted strategy’s score.

### Restart tests

At every persistence boundary, stop and start the command again. Prove:

- a partial `.tmp` file causes only the unfinished look to run again;
- a valid renamed look with a stale checkpoint is adopted without scoring it again;
- mid-screen and mid-confirmation restarts rebuild exact prefixes and score suffix games only;
- a Modal worker killed after an acknowledged Volume commit resumes in a new container without replaying that look;
- a valid admission file with missing expanded matrix files rebuilds them without scoring;
- a corrupt final look or admission stops with a clear error;
- another reservoir or initial matrix cannot resume the directory;
- uninterrupted and resumed runs produce byte-identical scientific files.

Use a test scorer counter to prove which games run again. Do not rely only on file existence.

### End-to-end fixture

Use `balance-tuning-005`. Add a PSRO-specific committed test top file and reservoir with a valid plan-77 source link, valid shuffle-1 rows, valid sorting, and enough rows for the test sizes. Do not weaken verification to accept the plan-78 zero-source-checksum reservoir. Build the small input matrix from these PSRO fixtures with the frozen plan-78 command.

Run an explicit `--matrix-size N --candidate-limit M` process at thread counts 1, 4, and 10. Require:

- `psro-verify` passes;
- all scientific output bytes match across thread counts and a repeated run;
- test knobs have the exact matrix-size and post-exclusion candidate-limit meanings above, and verify accepts only matching values;
- later look files contain only candidates that remained active after the prior look;
- at least one fixture path reaches admission and queue retest;
- another reaches capped unresolved and two-clean-search completion;
- an independent TypeScript reference fixture produces the same schedules, bounds, decisions, admission order, and final support.

If real `balance-tuning-005` Goldfish and matrix files are available at implementation time, run the full local PSRO command as a durable terminal job and report each look, search, admission, total games, games per second, and wall time. Do not make missing untracked real evidence an implementation blocker.

### Repository validation

Run:

1. `cd rust && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`;
2. native competitive conformance tests with the binary present;
3. focused PSRO parity, restart, Python wrapper, and Modal tests;
4. `npm test`;
5. `npm run typecheck`;
6. `npm run lint`;
7. `npm run modal:test`;
8. `git diff --check`.

No Modal deployment and no paid run.

## Implementation order

1. Rebase on the parent-supplied frozen step-2 commit. Inspect its final APIs and make visibility-only seam changes.
2. Add deterministic confidence, seed, schedule, state-machine, and queue-order code with TypeScript golden parity tests.
3. Add look and checkpoint codecs, atomic commits, restart recovery, and independent verification.
4. Add parallel Rust scoring and admission files by reusing the frozen kernel and matrix functions.
5. Add expanded matrix outputs and final decisions evidence.
6. Add the local command, thin Python wrapper, and uncalled Modal function.
7. Remove the old campaign PSRO path and update allowlists and docs.
8. Run fixture parity, interruption tests, full repository validation, and available local timing.
9. Run exactly one implementation review cycle against the recorded pre-implementation SHA. Send required fixes to the same Pi writer and rerun affected validation.

## Stop conditions

Stop and report the blocker if:

- the frozen step-2 commit is not available or its result is still changing;
- step-2 scoring or solver behavior must change to implement this plan;
- Rust and TypeScript confidence, schedule, or transition fixtures differ;
- evidence bytes differ by thread count, restart path, or supported architecture;
- a completed look or admission is replayed after its valid file was renamed;
- an unresolved result is dropped, treated as confirmed, or treated as an operational failure;
- a partial or corrupt result can count as a clean search;
- implementation requires a second process or a TypeScript, JSON, or file handoff between looks;
- validation requires a deployment or paid Modal call.
