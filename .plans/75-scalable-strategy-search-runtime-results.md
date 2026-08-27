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

## Status preflight correction

The first parent-owned K007 attempt did not reach `strategy_search_run_entry`. Its separate status preflight waited on the full compute image for more than 29 minutes. No strategy-search scoring started.

The corrected operator validates run authorization and starts `run` without a status preflight. Explicit `status` uses a separate dependency-free Modal app and control image, reads execution state directly from the Volume, has a 30-second remote timeout, and has a 90-second local process timeout.

A second parent-owned attempt proved that status returned promptly, but execution state stayed missing for 5 minutes 43 seconds while the compute app prepared. No strategy-search scoring started. The control app now creates pinned schema-2 execution state before compute deployment and emits a visible preparation event. The compute image starts from the official Rust 1.98 image instead of downloading Rust with rustup. It installs Node dependencies and builds unchanged Rust sources in cacheable layers before it copies changing TypeScript sources. Local architecture tests cover state creation, pin preservation, control/compute ordering, and image build placement. This document does not claim a successful remote campaign run; the parent owns the retry.
