# Successive-Halving Double Oracle cycle-count pilot

## Goal

Build one exploratory, single-admission Double Oracle pilot for these kingdoms, in this fixed order:

1. `deep-beam-tuning-001` (`K001`)
2. `deep-beam-tuning-007` (`K007`)
3. `deep-beam-tuning-008` (`K008`)

For each kingdom, start from its audited protocol-v2 P75 50-strategy payoff matrix and its exact ordered 20,000-strategy reservoir. On each cycle:

1. solve the exact current 75-seed matrix;
2. put every inactive reservoir strategy into one fresh, deterministic, standard Successive Halving lane against that selected equilibrium lottery;
3. select exactly one response;
4. confirm that response on 400 fresh shuffle seeds against the unchanged lottery;
5. admit it only when the strict lower endpoint of its fresh bootstrap 95% interval is above 50%;
6. if admitted, simulate only its missing off-diagonal matrix row and column at 75 seeds, solve the enlarged matrix, and start the next cycle; and
7. stop when the selected response is not admitted or after cycle 100.

This is a cycle-count pilot. It assumes, at the user's request, that one standard Successive Halving lane is adequate for now. A stop with no admitted selected response is not protocol closure, reservoir closure, or proof that no inactive counter exists.

Do not implement this plan as part of the design commit. Do not run real games while implementing or validating the code. Do not use Modal. Do not change `docs/strategy-search-process.md`.

## Frozen source inputs

Use only the audited max-125 protocol-v2 P75 bundles and ordered reservoirs already approved by the response-oracle calibration:

| Kingdom | Reservoir SHA-256 | P75 manifest file SHA-256 | P75 report file SHA-256 | P75 manifest evidence hash |
|---|---|---|---|---|
| K001 | `4357b70bd6d114a4eb744b0096040a2f01f8dd9d24573fbb3811e2cd0241e9a8` | `724c8831ae96de289b25785a74692c8f2a2622380946fbf736ff4666a3cdc5a9` | `732cdd4e42fd367606f88dacace27c0201307128121b6363b1af1ba2d08968d4` | `da5e59c8e3c56d61c55ca242de3db5aca9227e75b3df29c232525359fef25263` |
| K007 | `17a1e34e0e4322940fa364543de96bfa44372797c2aa197cd2bb34ef97fa9ee9` | `176601ec0de344dc4f4f8d6514cc862464d7dd4b589b9e484d90d3109f91bbaf` | `b111bee25b8649abc13b28cbe092f14a12046a1af157b25002c1b81518df8c27` | `9dc4e7ef37fe795fff63d4cb98e88ed2f4d7aa7b4d1490915ab316f0c9edb8ff` |
| K008 | `56380c680b53f32c81e5128e538ea5b206901b5557bbf1452e2d9f590c8c816d` | `a9ade55c44860881a3c4f97ce0d9b175db779cbea7fb904ac042a59f42845536` | `9965631a602908cc03a151f34f5fb16b8e7f33357b75780aa2f5ecc7b2c62ffc` | `c276da906da08dbbe1935498e9494700754be2c7be8ccaf2ea22a6e36add94a5` |

The input JSON has exactly three entries in the fixed kingdom order. Each entry supplies absolute or caller-relative paths for:

- `ranked.json` and its `.sha256` file;
- `reservoir.json` and its `.sha256` file; and
- the protocol-v2 P75 root containing `manifest.json`, `report.json`, and `chunks/`.

The suite manifest stores the resolved paths and the SHA-256 of every direct source file. The P75 manifest already pins the ranked SHA-256, reservoir SHA-256, run ID, product version, scorer version, rule fingerprint, and candidate provenance digest. Validation must rehash the ranked and reservoir bytes, run the existing ordered-reservoir validator, validate all 20,000 entries in rank order, and compare every transitive identity with the P75 source identity. A valid shape or top-level evidence hash is not enough.

The response-oracle calibration result artifacts are not pilot inputs. Their standard Successive Halving constants and deterministic ranking code are reusable. Their games, lanes, fixed-screen prefix, reference evidence, and seeds are not reusable because every pilot cycle needs one fresh lane against a new current lottery.

## Frozen pilot protocol

Use version `successive-halving-double-oracle-pilot-v1` with these values:

| Field | Value |
|---|---:|
| Initial matrix strategies | 50 |
| Initial and added matrix seed evaluations per pair | 75 |
| Games per seed evaluation | 2 |
| Successive Halving depths | `1,2,4,8,16,32,64,128,256,512,1024,2048,4096,8192,16384` |
| Successive Halving retention | `ceil(active / 2)`, using cumulative mean |
| Responses selected per cycle | 1 |
| Confirmation seed evaluations | 400 |
| Bootstrap resamples | 2,000 |
| Admission threshold | bootstrap 95% interval lower endpoint strictly `> 0.5` |
| Maximum cycles | 100 |
| Turn limit per player | 30 |
| Action cap per turn | 200 |
| Starting draft | off |
| Early stopping | off |
| Simulation backend | local `WorkerPairingRunner` only |
| Default local workers | 4 |

One seed evaluation is the existing standard two-game fixed-seat, alternating-first-player orientation. Use `GAMES_PER_SEED`; do not restate game orientation in a new simulator.

Use the existing `RESPONSE_ORACLE_HALVING_DEPTHS`, `rankCalibrationCandidates`, `replayStandardSuccessiveHalving`, and `successiveHalvingCost` behavior. If a small generic extraction is needed, preserve byte-for-byte response-oracle calibration outputs and keep its tests unchanged. Use `mixtureSchedule`, `evaluateCandidates`, `solveEquilibrium`, `canonicalStrategy`, `stableHash`, `compareUtf16`, and `percentileBootstrapMean`. Add no dependency.

## P75 matrix loading and diagonal decision

Add a strict, read-only protocol-v2 bundle loader. It must:

1. require the pinned manifest bytes, report bytes, manifest evidence hash, reservoir bytes, and ordered source identity;
2. call `validateInitialMatrixManifest` and `validateOrderedCalibrationSource`;
3. reject every unexpected file in the P75 root;
4. load and deeply validate every expected protocol-v2 cell chunk against its exact row, column, seed offset, count, purpose, strategy IDs, canonical strategies, scores, matches, telemetry, simulation time, manifest hash, and evidence hash;
5. require a complete max-125 bundle and a report attached to that exact manifest;
6. require the report to contain one complete P75 prefix over ordinals 1–75 and all 50 strategy weights;
7. record the file SHA-256 and evidence hash of every source chunk; and
8. never create, replace, migrate, or repair a source artifact.

Rebuild the pilot's initial payoff matrix from the first 75 records of each of the 1,225 off-diagonal cells. For cell `{i,j}`, compute the centered payoff from the saved `payoffScore` values with the existing game weighting. Set every diagonal to exactly zero. Keep active strategies in ordered-reservoir rank order, so the initial solve uses the same ordering as the P75 report. Solve the rebuilt matrix and require its strategy IDs, value, weights, maximum feasible weights, maximum known advantage, and residuals to match the saved P75 equilibrium within the solver's existing `1e-7` validation tolerance. Save the rebuilt centered matrix and equilibrium in a derived, hashed `initial-matrix.json` artifact.

Diagonal telemetry is not needed. The pilot reports cycle count, responses, confirmation intervals, admissions, matrix widths, stop state, and accounting. It does not report acquisitions or classifier labels. Zero-sum payoff diagonals are structurally zero, and diagonal games do not estimate an off-diagonal payoff. Validate the source diagonal chunks as part of the complete audited bundle, and report their historical source-game count, but do not copy them into the pilot matrix, simulate new diagonals, or include them in pilot-added games.

The P75 source basis is:

- 183,750 off-diagonal payoff games used by the rebuilt matrix;
- 7,500 diagonal telemetry games present but not used by this pilot; and
- 191,250 total games in the P75 prefix.

These are source games, not newly simulated pilot games. The complete max-125 bundle has 318,750 source games and is validated without replay.

## Deterministic fresh seed plan

Derive all unsigned 32-bit seeds from the pilot version, kingdom ID, reservoir SHA-256, P75 manifest evidence hash, cycle ordinal, phase, and seed index. Use separate labels for:

- `cycle:N:halving:game`;
- `cycle:N:halving:opponent`;
- `cycle:N:halving:tie`;
- `cycle:N:confirmation:game`;
- `cycle:N:confirmation:opponent`; and
- `cycle:N:confirmation:bootstrap`.

Build the complete 100-cycle plan before simulation. Use deterministic collision resolution, not acceptance of a hash collision: take the first eight hash characters, and if that value is already reserved, hash the same namespace with an increasing collision nonce until it is unused. Reserve the 75 initial matrix game seeds first. Require every halving game seed, confirmation game seed, opponent-sampling seed, tie seed, and bootstrap seed to be unique across all 100 cycles. Matrix row simulation intentionally reuses the original 75 matrix seeds for every matrix cell and is the only declared seed reuse.

Store the derivation rule, collision nonces, per-cycle seed-plan hashes, and one complete-plan hash in the suite manifest. Store each cycle's exact seeds and schedules in its snapshot artifact. Deep validation reconstructs the full plan and rejects a missing seed, changed seed, collision, namespace reuse, restarted opponent sampler, or schedule change.

This up-front plan makes every cycle fresh even after resume. It also prevents a changed matrix or earlier stop from changing a later cycle's shuffle seeds.

## Cycle snapshot and exact lottery

At the start of cycle `c`:

1. require a deeply valid matrix with `m = 49 + c` active strategies if every earlier cycle admitted one response;
2. solve the complete 75-seed centered payoff matrix in active admission order;
3. include all active IDs in the saved weight map, including exact zero and tiny positive weights;
4. build the current lottery schedule with only the complete positive weight vector, as `mixtureSchedule` already does;
5. define inactive candidates as every reservoir entry whose exact strategy ID is not active, in original goldfish-rank order;
6. require `n = 20,000 - m` inactive candidates with unique IDs and canonical strategies; and
7. hash the protocol, source identity, active strategies, centered matrix, selected equilibrium, inactive identities, seed plan, and complete halving and confirmation schedules into one immutable cycle snapshot.

All screening and confirmation artifacts reference that snapshot hash. A matrix admission cannot change the lottery inside the current cycle. The next solve and new lottery occur only after the admitted row is complete and valid.

## One fresh standard Successive Halving lane

Every inactive candidate enters depth 1. All candidates active at the same seed index receive the same shuffle seed and sampled current-lottery opponent. Each later round evaluates only the exact suffix needed to reach its cumulative depth. Rank every round by:

1. descending cumulative mean over that candidate's complete prefix;
2. ascending stable tie hash from the cycle tie seed, strategy ID, and canonical strategy;
3. ascending UTF-16 strategy ID; and
4. ascending UTF-16 canonical strategy.

Retain `ceil(active / 2)`. When two candidates enter a round, retain one and finish. Save the complete top-score tie and retention-boundary tie even though one deterministic order must select a survivor. The final survivor is the one selected response. Do not select a second response, preserve a top-four admission path, pool old screening evidence, or admit a tied group.

Use 250-candidate atomic score chunks per round. Each chunk stores:

- schema, version, kingdom, cycle, snapshot hash, round, cumulative depth, suffix bounds, and active candidate index bounds;
- exact rank, ID, canonical strategy, suffix block scores, candidate-seed evaluations, games, and matches for each row;
- referenced schedule hash and exact schedule suffix;
- measured simulation wall time; and
- a SHA-256 evidence hash over every saved field except the hash itself.

After all chunks in one round are valid, write one atomic round summary with the complete active IDs, cumulative means, deterministic ranked IDs, top tie, boundary tie, survivors, child file hashes, candidate-seed evaluations, games, and summed chunk wall time. Later-round work cannot start before this summary exists. The final `successive-halving.json` references every round hash and records the selected response and exact total accounting.

A resumed run reuses valid chunks and summaries. A missing chunk is simulated with the same schedule. Any invalid, stale, partial, duplicate, out-of-order, or unexpected final artifact stops the run and is never replaced.

## Fresh 400-seed confirmation and admission

Confirm only the selected response. Use the cycle's independent 400-block confirmation schedule against the same frozen equilibrium lottery. Screening scores never enter the confirmation mean, interval, or admission decision.

Split confirmation into atomic 25-seed chunks. Each chunk records the selected strategy identity, snapshot and Successive Halving hashes, schedule suffix, 25 block scores, 50 matches, measured simulation wall time, and its evidence hash. After all 16 chunks validate:

1. concatenate scores in schedule order;
2. require exactly 400 candidate-seed evaluations and 800 games;
3. calculate the mean;
4. call the existing `percentileBootstrapMean(scores, bootstrapSeed, 2000)`;
5. save both interval endpoints; and
6. set `admitted = interval.lower > 0.5`.

This keeps the existing project's strict bootstrap 95% lower-endpoint semantics used by the 400-block historical attacks. Equality at 50% is not admission. Do not add a mean threshold, multiplicity correction, anytime test, indifference zone, or optional extension. This pilot tests one fresh selected response per cycle.

## Admit one row, or stop

If confirmation does not admit the selected response:

- do not run a matrix game;
- write a terminal cycle summary with `stopReason: "selected-response-not-admitted"`; and
- stop that kingdom.

If confirmation admits it:

1. append exactly that one strategy to active admission order;
2. simulate its pairing against each of the `m` old active strategies;
3. use the exact original P75 matrix seed ordinals 1–75 for every pairing;
4. simulate no old-old cell and no diagonal cell;
5. create centered payoff values from the complete 75 block scores;
6. require exactly `75m` candidate-seed evaluations and `150m` games;
7. build the enlarged antisymmetric matrix with a zero diagonal;
8. solve it and write a matrix-row summary plus the new matrix snapshot; and
9. start the next cycle unless this was cycle 100.

Use one atomic matrix cell chunk for each 25-seed suffix. A completed admitted row therefore has `3m` chunks. Each chunk records the before-matrix hash, admitted identity, old opponent identity, canonical strategies, seed bounds, scores, matches, simulation wall time, and hash. The row summary references every expected child in old active order, proves that no old-old or diagonal work exists, reports the row's exact accounting, and includes the after-matrix hash and solver wall time.

There is no strategy-equivalence collapse. At most one exact inactive strategy is admitted per cycle, so the final matrix width is at most 150.

If cycle 100 admits its response, solve and save the complete 150-strategy matrix, then stop with `stopReason: "cycle-safety-cap"`. If cycle 100 does not admit its response, keep `stopReason: "selected-response-not-admitted"`. In both cases report `safetyCapReached: true`. A lower cycle count reports `safetyCapReached: false`.

## State and artifact schemas

Use this ignored output layout:

```text
.experiments/successive-halving-double-oracle-pilot/v1/
  manifest.json
  checkpoint.json
  report.json
  report.md
  deep-beam-tuning-001/
    initial-matrix.json
    cycles/cycle-001/
      snapshot.json
      halving/round-00/chunk-000.json
      halving/round-00/summary.json
      ...
      halving/successive-halving.json
      confirmation/chunk-000.json
      ...
      confirmation.json
      matrix-row/cell-<opponent-rank>/chunk-000.json
      ...
      matrix-row/summary.json
      cycle.json
    ...
    kingdom.json
  deep-beam-tuning-007/
    ...
  deep-beam-tuning-008/
    ...
```

`manifest.json` contains:

- exact input paths and source SHA-256 values;
- complete reservoir and P75 identities;
- the fixed protocol and fixed kingdom order;
- the full seed-plan hash and per-cycle plan hashes;
- simulation limits and `modal: false`;
- false flags for formal closure, protocol closure, mathematical closure, acquisition reporting, and automatic extra cycles; and
- its evidence hash.

`checkpoint.json` contains only the suite manifest hash, each kingdom state, ordered completed cycle-summary hashes, current kingdom, exact added-game and measured-time totals, and its evidence hash. It is a replaceable atomic index, not authority. Resume rebuilds the state from the complete child chain and requires exact equality with the checkpoint.

Each `cycle.json` records:

- cycle number, snapshot hash, matrix size before and after;
- inactive candidate count and exact selected candidate identity and rank;
- Successive Halving round counts, selected cumulative score, ties, evaluations, games, and measured time;
- confirmation mean, full 95% interval, lower confidence bound, admission decision, games, and measured time;
- admitted strategy ID or null;
- matrix row games and measured time, or exact zero when not admitted;
- before and after equilibrium summaries;
- stop reason, safety-cap status, child hashes, phase accounting, and total accounting; and
- its evidence hash.

`kingdom.json` is terminal only. It records cycle count as cycles attempted, admissions count separately, initial and final matrix sizes, the complete ordered list of cycle hashes, terminal reason, safety-cap status, source and added accounting, and `formalClosure: false`.

The JSON and Markdown reports are derived only from three deeply valid terminal kingdom artifacts. They contain:

- fixed protocol, source paths and hashes, and fixed sequential run order;
- per kingdom: cycles attempted, admissions, initial and final matrix sizes, stop reason, and safety-cap status;
- per cycle: inactive candidate count, selected response ID, canonical strategy, goldfish rank, selected Successive Halving score, confirmation mean and 95% interval, admitted flag, admitted ID, and matrix sizes;
- exact Successive Halving, confirmation, matrix, total added game counts, and source game counts;
- exact candidate-seed counts, saved chunk simulation wall times, solver wall times, and their separately summed totals; and
- a prominent statement that the result is exploratory cycle-count evidence under the assumed adequacy of one SH lane and is not formal closure.

## Atomic writes and strict resume

Write JSON to a tool-owned staging path on the same filesystem, flush and close it, then rename it atomically to the final path. On resume, discard only an unreferenced staging file whose name exactly matches this command's staging convention. Unknown files and directories fail validation. Never remove or overwrite a final evidence artifact.

Every artifact uses an exact key allowlist and SHA-256 over all saved fields, including measured wall time. Validators also recompute semantics. A matching hash alone is not valid evidence. Derived summaries must sum child game counts and child measured times exactly; they cannot trust copied totals.

Deep resume validation must replay, without games:

- source bytes, source validators, P75 matrix reconstruction, and the initial solve;
- the full seed plan and global uniqueness;
- every cycle snapshot and exact lottery;
- every Successive Halving active set, score prefix, cumulative mean, tie order, survivor count, and selected response;
- every confirmation schedule, score, bootstrap interval, and strict admission decision;
- every admitted row, centered payoff, antisymmetric matrix, equilibrium, and one-admission state transition;
- every stop and safety-cap transition; and
- all candidate-seed, game, simulation-time, and solver-time accounting.

A valid existing artifact is reused. A missing artifact on the current incomplete phase is generated. An invalid, stale, unexpected, or semantically inconsistent artifact stops the command. Evidence after a terminal cycle, a matrix row after non-admission, two admissions in one cycle, or a later kingdom started before an earlier kingdom became terminal is invalid.

## Exact game accounting

Let cycle `c` be one-based. If all earlier cycles admitted one response:

```text
matrix size before cycle: m(c) = 49 + c
inactive candidates:      n(c) = 20,000 - m(c)
SH seed evaluations:      H(n), using successiveHalvingCost(n)
SH games:                 2H(n)
confirmation games:       800
admitted row games:       150m(c), or 0 when not admitted
```

Important cycle values are:

| Cycle | Matrix before | Inactive | SH seed evaluations | SH games | Total if not admitted | Total if admitted |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 50 | 19,950 | 169,165 | 338,330 | 339,130 | 346,630 |
| 2 | 51 | 19,949 | 169,164 | 338,328 | 339,128 | 346,778 |
| 50 | 99 | 19,901 | 168,956 | 337,912 | 338,712 | 353,562 |
| 100 | 149 | 19,851 | 168,791 | 337,582 | 338,382 | 360,732 |

If all 100 cycles admit a response, one kingdom adds exactly:

- 33,795,344 Successive Halving games;
- 80,000 confirmation games;
- 1,492,500 matrix-row games; and
- 35,367,844 games in total.

The three-kingdom all-admit safety-cap maximum is 106,103,532 added games. Source P75 games stay separate. At the earlier measured 10,200–12,800 local games per second, the first admitted cycle is about 27–34 seconds of simulation and the per-kingdom all-admit cap is about 46–58 minutes of simulation. These are planning estimates only. Reports use measured artifact times and exact game counts.

## CLI and sequential execution

Add:

```json
"successive-halving:double-oracle-pilot": "tsx scripts/successive_halving_double_oracle_pilot.ts"
```

Support exactly one mode:

```sh
npm run successive-halving:double-oracle-pilot -- \
  --validate-inputs --inputs .experiments/successive-halving-double-oracle-inputs.json

npm run successive-halving:double-oracle-pilot -- \
  --run --inputs .experiments/successive-halving-double-oracle-inputs.json \
  --out .experiments/successive-halving-double-oracle-pilot/v1 --workers 4

npm run successive-halving:double-oracle-pilot -- \
  --status --out .experiments/successive-halving-double-oracle-pilot/v1

npm run successive-halving:double-oracle-pilot -- \
  --report --out .experiments/successive-halving-double-oracle-pilot/v1
```

Reject unknown flags. Allow `--inputs` with `--validate-inputs` and `--run` only. Allow `--workers` with `--run` only, from 1 to 192, default 4. `--validate-inputs`, `--status`, and `--report` must never construct a pairing runner.

`--run` first validates all three source bundles without games. It then creates one local runner for K001, runs or resumes K001 to a terminal state, closes that runner, and only then creates the K007 runner. Apply the same rule from K007 to K008. Never have two kingdom runners alive at once. A source or evidence validation error stops the suite before later work. A valid non-admission or safety-cap terminal state allows the next kingdom to start.

No code path imports Modal, invokes `modal`, accepts a remote backend, or reads the response-oracle calibration evidence as game input.

## Implementation files

Add:

- `src/sim/successiveHalvingDoubleOraclePilot.ts`: protocol constants, source identities, generic cycle state, deterministic seed allocation, matrix rebuild, schedules, SH artifacts, confirmation decision, row extension, accounting, report creation, and deep validators.
- `scripts/successive_halving_double_oracle_pilot.ts`: strict input loading, filesystem allowlists, atomic chunks, local runner orchestration, sequential kingdom state, status, and report commands.
- `test/sim/successiveHalvingDoubleOraclePilot.test.ts`: focused protocol, cost, state, schema, and corruption tests.
- `test/sim/successiveHalvingDoubleOraclePilotIntegration.test.ts`: a small fake-runner, reduced-field end-to-end resume fixture for two or three kingdoms without real games.

Update:

- `package.json`: add the command.
- `README.md`: document the exploratory boundary, input schema, exact commands, game formula, artifact root, sequential local execution, and no-closure warning.

Reuse and, only where needed, expose small read-only helpers from:

- `src/sim/initialMatrixCalibration.ts`;
- `src/sim/responseOracleCalibration.ts`;
- `src/sim/mixtureEvaluation.ts`;
- `src/sim/equilibrium.ts`; and
- `src/sim/pairingRunner.ts`.

Do not change response-oracle calibration protocol values or existing artifact bytes. Do not change ordered full-PSRO protocols, `PayoffMatrix` keys, game rules, cards, strategy generation, the ordered reservoir, or `docs/strategy-search-process.md`.

## Tests and mutation tests

Use reduced constants only through explicit test fixtures. Production constants must not be configurable from the CLI.

Unit tests must prove:

- exact pinned source identities and fixed kingdom order;
- complete protocol-v2 source validation and exact first-75 off-diagonal matrix reconstruction;
- zero diagonals, no dependence on diagonal telemetry, and exact agreement with the saved P75 equilibrium shape;
- the exact 19,950-candidate first cycle and all stated cost values;
- global fresh seed allocation, deterministic collision resolution, fixed later-cycle seeds after an early stop, and intentional matrix-seed reuse only;
- shared per-index lottery schedules, preservation of tiny positive equilibrium weights, and changed schedules after a changed equilibrium;
- standard cumulative Successive Halving depths, `ceil-half` survivor counts, suffix-only top-ups, stable tie handling, final one-response selection, and complete first-round inactive coverage;
- fresh 400-block confirmation, deterministic 2,000-sample bootstrap, no screen-score reuse, strict non-admission at a lower endpoint equal to 0.5, and admission above 0.5;
- one admitted strategy, only its missing row and column, 75 seeds per old opponent, no diagonal, and exact antisymmetry;
- non-admission stop, cycle-100 admitted stop, cycle-100 non-admitted stop, and no cycle 101;
- exact child-to-cycle-to-kingdom-to-suite game and runtime sums;
- fixed K001 then K007 then K008 runner lifecycle; and
- status, report, and input validation paths that create no runner and play no games.

Add table-driven mutation tests. Start from a complete valid fixture, mutate one field without rebuilding dependent evidence, and require rejection for at least:

- each direct source hash, manifest hash, chunk hash, rule fingerprint, run ID, rank, ID, canonical strategy, source score, match count, telemetry field, and elapsed time;
- one seed, namespace, collision nonce, opponent, weight, schedule block, snapshot hash, and tie seed;
- one SH active ID, suffix score, cumulative mean, ranked ID, tie member, boundary, survivor, depth, evaluation count, game count, and child hash;
- the selected confirmation ID, one score, seed count, screening-hash reference, bootstrap seed, interval endpoint, strict decision, game count, and child hash;
- an old-old matrix cell, missing admitted-opponent cell, added diagonal, row seed, centered sign, strategy order, matrix hash, equilibrium weight, and solver result;
- a second admission, skipped matrix solve, wrong cycle number, wrong matrix width, changed stop reason, incorrect safety-cap flag, later artifact after terminal state, and out-of-order kingdom start; and
- report candidate lists, cycle count, matrix sizes, phase totals, runtime totals, source totals, formal-closure flag, and source artifact hashes.

These are semantic artifact mutation tests built with Vitest. Do not add a mutation-testing package.

## Validation commands

Implementation validation must not run real games. Use fake runners and saved source validation only:

```sh
npx vitest run \
  test/sim/successiveHalvingDoubleOraclePilot.test.ts \
  test/sim/successiveHalvingDoubleOraclePilotIntegration.test.ts \
  test/sim/initialMatrixCalibration.test.ts \
  test/sim/responseOracleCalibration.test.ts \
  test/sim/nestedPayoffMatrix.test.ts \
  test/sim/equilibrium.test.ts
npm test
npm run typecheck
npm run lint
npm run build
npm run build:sim
git diff --check
npm run successive-halving:double-oracle-pilot -- \
  --validate-inputs --inputs .experiments/successive-halving-double-oracle-inputs.json
```

The last command hashes and validates saved inputs only. It must print `gamesPlayed: 0` and must not create an output root or runner. If the real source bundles are not present in the implementation worktree, report that command as a production-input blocker instead of weakening or replacing it with fixtures.

After implementation review and a separate user instruction to run production, use only:

```sh
npm run successive-halving:double-oracle-pilot -- \
  --run --inputs .experiments/successive-halving-double-oracle-inputs.json \
  --out .experiments/successive-halving-double-oracle-pilot/v1 --workers 4
npm run successive-halving:double-oracle-pilot -- \
  --status --out .experiments/successive-halving-double-oracle-pilot/v1
npm run successive-halving:double-oracle-pilot -- \
  --report --out .experiments/successive-halving-double-oracle-pilot/v1
```

Do not run these production commands during design or implementation validation. Do not start another lane, another confirmation extension, another kingdom replica, or cycle 101 without a new approved plan.

## Completion gate

Before implementation is ready for production:

- all validation commands that do not need missing external source artifacts pass;
- the complete diff is inspected against implementation-start SHA `20022c080727e9809f5d5eccf95356313d42f6e3`;
- `docs/strategy-search-process.md` is byte-for-byte unchanged;
- existing response-oracle calibration outputs remain unchanged;
- the report states the exploratory assumption and no-closure boundary;
- all three source bundles pass the no-game input validator; and
- the implementation commit SHA is recorded before any real game starts.

Current design blockers: the audited `.experiments` source bundles are not present in this worktree, so this design could not rehash them or run the no-game source validator. Their approved identities are pinned above from the current code and plans. No implementation blocker is known if those external artifacts are available at the paths supplied to the production input file.
