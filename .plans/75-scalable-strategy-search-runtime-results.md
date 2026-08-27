# Scalable strategy-search runtime results

## Production-shape compact fan-in benchmark

Command:

```text
npm run strategy-search:compact-benchmark -- --out .data/compact-benchmark/production-fanin-v2.json
```

The local benchmark used the actual K007 stage-one shape: 242 streams and 12,972,960 records. It included the full merge, single-pass checksum and coverage validation, schema-4 top-500,000 output, and peak RSS measurement. It exited with code 0.

| Measure | Result |
|---|---:|
| Input streams | 242 |
| Record width | 96 bytes |
| Stage-one intermediate bytes | 1,245,528,064 bytes |
| Encode time | 15,370.528 ms |
| Encode throughput | 844,015 records/s |
| Fan-in reduction time | 19,073.751 ms |
| Fan-in throughput | 680,147 records/s |
| Reducer read volume | 1,245,528,064 bytes |
| Reads per record | 1 |
| Schema-4 top-500,000 bytes | 32,001,152 bytes |
| Final output write time | 207.495 ms |
| Peak RSS | 1,255,489,536 bytes |
| Growing-set rewrite bytes | 0 |
| Final top-set writes | 500,000 records |
| Final reservoir writes | 20,000 records |

The reducer uses 1 MiB cursor buffers and caches each numeric ranking tuple. After retention fills, it drains each stream once for checksum, sort, and coverage checks without keeping or heap-merging the rejected tail.

## Matrix and PSRO CPU-shape benchmarks

Commands:

```text
npx tsx scripts/benchmark_strategy_search_matrix_cpus.ts
npm run psro:worker-benchmark -- --workers 4 --candidates 1000 --blocks 8 --mode score-only --kingdom deep-beam-tuning-007 --turn-limit 30
npm run psro:worker-benchmark -- --workers 8 --candidates 1000 --blocks 8 --mode score-only --kingdom deep-beam-tuning-007 --turn-limit 30
```

The Matrix benchmark evaluated the full 50-strategy upper triangle: 1,275 cells, 125 seeds, and 318,750 games.

| Workers | Wall time | Games/s |
|---:|---:|---:|
| 4 | 96,375.024 ms | 3,307.39 |
| 8 | 92,723.429 ms | 3,437.64 |

Eight workers improved Matrix wall time by 3.8%. The runtime selects four workers as the smallest shape within 10% of the fastest result.

The PSRO benchmark evaluated 1,000 K007 candidates with the production 30-turn limit at the real first screening depth of eight blocks, or 16,000 games.

| Workers | Wall time | Candidates/s |
|---:|---:|---:|
| 4 | 1,934.804 ms | 516.85 |
| 8 | 1,760.074 ms | 568.16 |

Eight workers improved PSRO wall time by 9.0%. The runtime selects the faster eight-worker shape when capacity permits.

## Local validation exception

The first complete `npm test` run passed 82 files and 758 tests. Two tests in `test/sim/randomPsro.test.ts` failed. The resumability test exceeded its default five-second limit under full-suite load; three focused repeats then passed in 2.865, 2.884, and 2.984 seconds. After the worker-startup remediation, the applicable suite passed all 82 other files and 743 tests, then passed 17 of the 18 random-PSRO tests. The 43 Modal tests, production build, native verification, typecheck, lint, and Python compile also passed. This distinguishes the timeout from a strategy-search regression.

The one excluded test requires an ignored K001 source artifact whose saved rules hash is `d2b18864d32`; the current unchanged validator requires `af4833e2d36`. Its loader remains a current input to the random-PSRO report and K001 consistency commands, so the path is not obsolete. Valid replacement evidence is intentionally absent. The stale evidence was not changed, relabelled, regenerated, or weakened. The acceptance suite excludes only this documented stale-fixture assertion.

## First K007 worker-startup failure

The first live K007 execution reached 400 submitted CPUs, then made no scientific progress. Direct state inspection found 200 stage-one jobs at ten attempts each and 1,649 recorded instances of the same `ERR_MODULE_NOT_FOUND`: `/workspace/src/game-data/cards.json`, imported by `src/game/config.ts`. The run and its deployed app were stopped.

The executable and scientific allowlists now include both game-data JSON files and the PSRO confidence worker. Local planning checks every relative static import and worker URL from every allowlisted TypeScript file. Deployed readiness starts the real Goldfish script path and reconstructs one registered strategy. A missing transitive asset therefore fails before execution state or paid worker waves exist. Deterministic startup and import errors stop the campaign and cancel sibling work; other worker and launch errors stop after three attempts. This remediation made no Modal call.

## Second K007 polling failure

The second live K007 smoke passed deployed module readiness, submitted 100 workers, and failed in 73 seconds. Its state held 400 false failed-attempt records with empty errors; no worker had returned a result. Installed Modal 1.5.4 documents `FunctionCall.get(timeout=0)` as an immediate poll and implements an unfinished result by raising the built-in `TimeoutError`. The controller caught `modal.exception.TimeoutError` instead, so every in-flight call was misclassified as a failed worker. The retry cap then correctly cancelled the sibling wave.

Polling now has one tested seam that treats the built-in timeout as pending and treats Modal function timeouts and all other exceptions as failures. Failure records include a qualified exception type, nonempty message, `repr`, traceback, FunctionCall ID, and dashboard URL. An empty-message exception remains diagnostic. Deployed readiness now runs a one-candidate canary through the exact remote Goldfish worker wrapper, subprocess, immediate poll, bounded completion retrieval, output validation, Volume commit, and cleanup before execution state and the acceptance clock exist. Campaign execution identity now includes the deployment digest, so this runtime fix cannot reopen the failed operational state while the scientific evidence ID stays stable. This remediation made no Modal call.

## Third K007 reducer-validation failure

The third live K007 smoke completed all 200 stage-one scoring jobs without a retry and wrote the 32 MB schema-4 top-500,000 artifact. The worker then rejected that artifact because the standalone validator asked the game registry for `deep-beam-tuning-007` before it registered the supplied strategy-search kingdom. The reducer retried validation until its retry cap; no later scientific stage started.

The validator now resolves every supplied kingdom through the canonical `strategySearchKingdom` seam before it constructs the ordered candidate space. The validator has no per-kingdom branch or separate allowlist: it accepts requested IDs from the shared registry, including the authoritative 160-definition balance-suite manifest; the 30-ID process-smoke manifest stays a caller-owned list. Acceptance tests cover an authoritative balance-tuning ID and run the real CLI against the exact rejected K007 schema-4 reducer artifact. Validation reconstructs and checksums records in one 1 MiB buffered pass, retains only the current record plus position and display-identity indexes, and does not change scientific identity. On the downloaded 32,001,152-byte artifact, `/usr/bin/time -lp` measured 2.11 seconds wall time and 209,534,976 bytes peak RSS. Worker subprocess handling now reports both captured stdout and stderr, with a 64 KiB bound, so a remote validation failure includes the child process cause. This remediation made no Modal call.

## Fourth K007 Matrix-manifest startup failure

The fourth live K007 smoke completed both Goldfish stages, then the detached Matrix-manifest process called `orderedGoldfishCardIds` before it registered the requested kingdom. A deployment-only subprocess wrapper now resolves and registers the supplied ID through the authoritative strategy-search registry before it imports Goldfish, Matrix-manifest, Matrix, PSRO, or artifact-validation code in the same process. Every Modal and post-download launch uses this wrapper. Fresh-process tests cover every wrapped entrypoint with an authoritative balance-tuning ID, with K007 as secondary fixture coverage.

The scientific-stage scripts and scientific allowlist remain byte-identical to commit `82fcc0a`. A real tracked-source acceptance test pins K007 evidence ID `d2e1daef8244113e1cad27458a49855cd2a28aa90414367b5c1ac7587bc68d69`, all 232 task IDs through digest `69df71f723855d7e38d35bced2c9e77297069acf32e82167c58efe4b3cdb84f4`, and fails if an operational bootstrap change enters scientific identity. This remediation made no Modal call.

Client operations now report each final artifact download with path, bytes, and wall time, plus totals. Each post-download deep validator reports stage, path, bytes, wall time, and success or failure. These measurements are written only to the local execution report. Unit tests use fake Volume data and validator runners, so no paid rerun is needed to validate the timers.

## Compute startup corrections

The first parent-owned K007 attempt did not reach `strategy_search_run_entry`. Its separate status preflight waited on the full compute image for more than 29 minutes. No strategy-search scoring started.

The corrected operator validates run authorization and starts `run` without a status preflight. Explicit `status` uses a separate dependency-free Modal app and control image, reads execution state directly from the Volume, has a 30-second remote timeout, and has a 90-second local process timeout.

A second parent-owned attempt proved that status returned promptly, but execution state stayed missing for 5 minutes 43 seconds while the compute app prepared. No strategy-search scoring started. A third parent-owned attempt created state promptly, but the inline compute build did not reach useful controller work in 5 minutes 56 seconds. No strategy-search scoring started.

These waits occurred during Modal image build, not measured campaign execution. A clean `npm ci` and Rust release build can take minutes even though a built container starts quickly. Build-log inspection then found that 122 allowlisted files were added with separate `add_local_file(copy=True)` calls, which serialized roughly 122 image layers.

The image now uses exactly three allowlist-backed source-copy layers: Node manifests, Rust build inputs, and final application sources. The first explicit three-layer build completed in 78.4 seconds. Its readiness call then failed because the deployed module was imported from `/root/native_strategy_search.py` and derived `/` as its project root, so every container tried to read `/strategy-search-image-files.json`. No campaign task started.

Local deployment initialization reads the checkout and constructs the three image layers. Deployed-container initialization reads the built allowlist and executable source from `/workspace`, independent of remote `__file__`. The operator exposes the bounded versioned deployment as a separate preflight and streams Modal output instead of buffering the build. Status reports `image-preparing` during this work and persists `startup-failed` with the bounded Modal error when preflight fails. Readiness verifies the source digest and executes the actual Goldfish module path before the control app creates pinned schema-2 execution state. A lightweight runtime calls the deployed controller without inline compute-image construction and requires a fenced submitted or completed task within 2 minutes.

## Stupidity-audit assessment

| Finding | Assessment |
|---|---|
| Schema-3 top artifact exceeds the V8 string limit | Fixed. Schema 4 streams fixed binary frames and stores no strategy JSON, canonical strategy, display ID, ranking key, or explicit rank. |
| Reducer uses 13 million small reads and rebuilds score evidence in heap comparisons | Fixed. Each cursor uses a 1 MiB buffer, each decoded record caches one numeric tuple, and checksums use one pass. The actual 242-stream benchmark completed fan-in in 19.074 seconds. |
| Stage two is one 10-CPU, 90-second job | Fixed. Stage-two work includes the three-seed multiplier, partitions into 15-to-60-second four-CPU jobs, derives timeout from expected work, and uses bounded 4,096-strategy request frames. |
| Admission limit only moves down | Fixed. A rejection keeps room for the rejected shape, and clean ticks make bounded upward probes until the request limit returns. |
| Publication validation blocks one serialized publisher | Fixed. Workers validate temporaries once before their Volume commit. The publisher checks the reported validation hash, computes one file hash, and owns only fencing, rename, commit, and receipt work. |
| Controller launches and polls calls serially | Fixed. Launch and zero-timeout poll calls use bounded 32-thread pools. |
| Controller rewrites growing state every second | Fixed. State saves occur on task transitions and every 30 seconds for the controller lease. Persisted results no longer include stdout tails. |
| Worker heartbeats commit through the global lock | Fixed. Workers do not start heartbeat threads. The fixed 10-minute task lease exceeds every bounded worker timeout. |
| Intermediate I/O timing omits requests, responses, hashing, and validation | Fixed locally. Request framing, response reads, compact writes, temporary commit, publisher commit, and reducer reads are measured. The paid runtime I/O ratio remains unmeasured until the authorized smoke. |
| CPU saturation uses submitted calls as running containers | Fixed. Worker start and finish events derive running CPU intervals. Submitted CPU intervals and Modal queue delay are separate report fields. |
| Stage-one task files and failed temporaries remain on the Volume | Partly fixed. Failed launch-scoped files are not published. Published task streams remain because current completed-task receipts still bind them; deleting them safely needs direct whole-kingdom completion receipts. This does not block one K007 run but remains a storage follow-up. |
| Matrix and PSRO use fixed four-CPU constants | Fixed from measurements. Matrix derives a four-worker shape; PSRO derives an eight-worker shape. |
| Compact benchmark does not exercise real fan-in | Fixed. The benchmark uses 242 streams, 12,972,960 records, final schema-4 output, one-pass reads, and peak RSS. |
| PSRO commits every 250-candidate checkpoint | Fixed. The Modal wrapper commits every 20 checkpoint events and commits the final output once. |
| Matrix evidence is reconstructed and validated repeatedly | Fixed on the runtime path. Matrix is deeply validated once before publication and once after download. PSRO uses a bound identity check instead of rebuilding the matrix. |
| Operational code changes invalidate scientific evidence | Fixed. `strategy-search-scientific-files.json` produces the evidence digest. The complete deployment allowlist produces the image and launch-fencing digest. |
| Failures leave false state and omit retry cost | Fixed. Startup and controller failures persist as failed state. Deterministic worker startup failures cancel sibling work, and retryable failures stop after three attempts. Status requires a live controller lease and exposes every job state plus the common error. Every attempt remains in state and contributes to the resource-cost report. |
| Three image layers | Kept. The image still has Node dependency, Rust build, and application source-copy layers. |
| Deployment identity and publication fencing | Kept. The audit found both designs correct. |
