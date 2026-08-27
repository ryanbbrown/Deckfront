# Scalable strategy-search runtime results

## Synthetic compact-stream benchmark

Command:

```text
npm run strategy-search:compact-benchmark -- --out .data/compact-benchmark/result.json
```

The benchmark ran all 12,972,960 synthetic records and exited with code 0.

| Measure | Result |
|---|---:|
| Record width | 96 bytes |
| Fixed header | 512 bytes |
| Stage-one intermediate bytes | 1,245,404,672 bytes |
| Encode time | 10,052.426 ms |
| Encode throughput | 1,290,530.212 records/s |
| Decode and reduction time | 23,712.845 ms |
| Decode and reduction throughput | 547,085.762 records/s |
| Reducer read volume | 1,245,404,672 bytes |
| Reads per record | 1 |
| Growing-set rewrite bytes | 0 |
| Final top-set writes | 500,000 records |
| Final reservoir writes | 20,000 records |

This is synthetic format and I/O evidence. It is not campaign evidence. The parent owns the paid K007 smoke and its runtime I/O-ratio result.

## Local validation exception

The complete `npm test` command passed 82 files and 756 tests, then failed one unrelated pre-existing test in `test/sim/randomPsro.test.ts`. The ignored K001 source artifact has saved rules hash `d2b18864d32`; the current unchanged validator requires `af4833e2d36`. This implementation does not change the random-PSRO test, protocol, runner, validator, or evidence. The stale ignored evidence was not changed, relabelled, regenerated, or weakened.

The implementation acceptance suite therefore excludes only `test/sim/randomPsro.test.ts`. All other repository test files remain required.

## Compute startup corrections

The first parent-owned K007 attempt did not reach `strategy_search_run_entry`. Its separate status preflight waited on the full compute image for more than 29 minutes. No strategy-search scoring started.

The corrected operator validates run authorization and starts `run` without a status preflight. Explicit `status` uses a separate dependency-free Modal app and control image, reads execution state directly from the Volume, has a 30-second remote timeout, and has a 90-second local process timeout.

A second parent-owned attempt proved that status returned promptly, but execution state stayed missing for 5 minutes 43 seconds while the compute app prepared. No strategy-search scoring started. A third parent-owned attempt created state promptly, but the inline compute build did not reach useful controller work in 5 minutes 56 seconds. No strategy-search scoring started.

These waits occurred during Modal image build, not measured campaign execution. A clean `npm ci` and Rust release build can take minutes even though a built container starts quickly. Build-log inspection then found that 122 allowlisted files were added with separate `add_local_file(copy=True)` calls, which serialized roughly 122 image layers.

The image now uses exactly three allowlist-backed source-copy layers: Node manifests, Rust build inputs, and final application sources. The first explicit three-layer build completed in 78.4 seconds. Its readiness call then failed because the deployed module was imported from `/root/native_strategy_search.py` and derived `/` as its project root, so every container tried to read `/strategy-search-image-files.json`. No campaign task started.

Local deployment initialization now reads the checkout and constructs the three image layers. Deployed-container initialization reads the built allowlist and executable source from `/workspace`, independent of remote `__file__`. An isolated container-layout import test executes the real module and readiness function against built workspace content. The operator exposes the bounded versioned deployment as a separate preflight and streams Modal output instead of buffering the build. Status reports `image-preparing` during this work and persists `startup-failed` with the bounded import or readiness error when preflight fails. A live readiness call verifies the deployed compute function and exact source digest. Only then does the control app create pinned schema-2 execution state and start the campaign acceptance clock. A lightweight runtime calls the deployed controller without inline compute-image construction and requires a fenced active or completed task within 2 minutes. Status changes to `controller-running` only after that fenced save and includes live task and CPU counts. Local tests cover layer count, allowlist coverage, streamed progress, truthful phases, preflight identity, state creation, pin preservation, deployment order, and fenced useful-work acceptance. This document does not claim a successful remote deployment or campaign run; the parent owns both.
