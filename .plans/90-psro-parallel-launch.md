# PSRO parallel launch inputs

Status: implementation plan (direct mode; no plan panel; one implementation review).

## Goal

Remove the last serial per-kingdom client loop. The PSRO `launch` step checks two Goldfish paths, compares four Matrix files, and uploads missing ones, one kingdom at a time, at about 9.7 s per kingdom (measured 77.3 s for 8 kingdoms in execution `b695aa14…`). At 160 kingdoms this costs about 25 minutes. Target: about 1 s per kingdom effective.

## Decisions

- D1. `launch()` in `modal/strategy_search_psro_runtime.py` keeps its two-phase order with the same fail-fast meaning: phase A checks every Goldfish path of every kingdom; phase B compares and uploads Matrix files. Any phase-A failure raises before any upload. Both phases run their per-item Volume calls through a thread pool of 16.
- D2. One `volume.batch_upload()` context uploads every missing Matrix file of every kingdom, registered sequentially after the parallel hash comparisons. The SDK uploads the batch on context exit. The launch-intent upload stays as it is.
- D3. Hash comparison keeps `_remote_bytes` (full read of a ~0.4 MB file); a present file with a different SHA-256 still raises and nothing spawns.
- D4. Spawns stay sequential, and the state file is still written after every spawn. Spawn cost is about 0.3 s per kingdom and the per-spawn persistence is the crash-safety contract.
- D5. Rate limits: generalize the `list_files` retry into `retry_resource_exhausted(operation, sleep=time.sleep)` in `modal/volume_download.py` (retries only an error whose type name is `ResourceExhaustedError`, delays 2, 4, 8, 16, 32 s, six attempts, any other error raises at once). `list_files` uses it, and the launch phase wraps each existence check, remote read, and the batch upload with it.
- D6. Client timeout: `psroLaunchTimeoutMs(kingdomCount) = 300_000 + 5_000 × kingdomCount` in `scripts/strategy_search_psro_modal.ts`, exported, tested, and used by the adapter's launch call.
- D7. No file on either allowlist changes; the deployment digest and every token stay the same.

## Tests

- `modal/test_volume_download.py`: `retry_resource_exhausted` retries only the named error with delays 2 and 4 through a fake sleep, raises after six attempts, and raises other errors at once; `list_files` behavior unchanged.
- `modal/test_strategy_search_psro_runtime.py`: a missing Goldfish path raises before any upload (the fake records upload calls); a Matrix hash mismatch raises and nothing spawns; all missing Matrix files of two kingdoms go through one `batch_upload` context; a rate-limited existence check retries and succeeds; matching files are not re-uploaded; spawn order and per-spawn state writes unchanged.
- `test/sim/strategySearchPsroModal.test.ts`: `psroLaunchTimeoutMs` values at 0, 8, and 130 kingdoms.

## Documents

`docs/strategy-search-psro-modal.md`: one sentence in the run section: input checks and uploads run in parallel across kingdoms with rate-limit retries.

## Acceptance

- `npm run modal:test`, `npm run typecheck`, `npm run lint`, `git diff --check`, and `npx vitest run test/sim/strategySearchPsroModal.test.ts` pass; no existing assertion is weakened.
- The writer runs no Modal command and no paid operation. The launch-time gain is measured on the next paid run, not by the writer.

## Stop conditions

Stop if the change needs an allowlist file, if `batch_upload` cannot register files outside its own thread, or if fail-fast ordering cannot be kept.
