# PSRO serial overhead removal

Status: reviewed implementation plan (`.reviews/plans/psro-serial-overhead-removal/`, round v1; findings applied once).

## Goal

Make the `psro` command spend its wall time playing games. Work that plays no game and makes no decision leaves the default path or runs on all cores. Scientific evidence bytes do not change: the same looks, seeds, schedules, confidence bounds, decisions, admissions, matrices, and `decisions.hpd` come out of a clean run and of a resumed run, and `psro-verify` still replays and checks all of it independently.

## Measured problem

`balance-tuning-090` under the current rules is 3.82M games in 14 screen looks with no admission.

- Modal, 16 cores: Rust ran 143 s. About 35 s was parallel game play. The rest was single-threaded: confidence bounds after each look (computed twice, once inside `score_look` and once again in `execute_race`), two full replays of every transition at the end of the run, and per-look file writes with sync and read-back on the Volume mount. Startup input checks took 0.14 s.
- Local host, 14 threads: 99 s wall, 66 s inside transitions, 33 s outside. A macOS `sample` of the non-game path shows 237,000 samples of pool threads waiting on a condition variable against one busy thread.
- Code facts. `score_look` computes `confidence` for each active candidate in a sequential loop after the Rayon game loop, inside the timed region. `execute_race` then recomputes `confidence` for every row of every look in a second sequential loop, outside the timed region, and requires bit equality. `run_psro` ends with `replay_transitions`, then `ensure_decisions`, then `verify_complete`, which calls `replay_transitions` again. `verify_complete` is shared with `run_verify`, and `run_verify` builds a one-thread pool. `atomic_write_verified` reads and parses the temporary file; the look and admission paths read and parse the renamed file a second time. `replay_transitions` reads every look of every race to completion, so it cannot run against a mid-race checkpoint.
- The same shape appears in every kingdom: across the local persistent-mana runs, 25% to 35% of wall time was outside transitions, and the transitions themselves included the serial confidence work.

## Changes

### Rust, `rust/goldfish/src/psro.rs` only

1. Parallel candidate evaluation. Extract one helper that takes candidate index order, each candidate's cumulative ordered scores, and alpha, and returns each candidate's bounds and decision. It runs on the runtime's Rayon pool with `par_iter` and collects in index order. `confidence` is a pure function of one candidate's ordered scores, so per-candidate `f64` bits are unchanged. Callers:
   - `score_look` uses it for fresh rows.
   - The `execute_race` post-look loop stops recomputing bounds for fresh rows; it extends each prefix and uses the bounds and decision already in the row. For an adopted committed look, it recomputes through the helper and still requires bit equality with the stored row. The restart safety check is kept and runs on all cores.
   - `replay_race` uses it, so `psro-verify` and the bounded resume rebuild use all cores.
   - `psro-verify` gains an optional `--threads` argument. Its default stays 1, as today.

2. Live decision records. The runtime accumulates the same `DecisionRecord`, admission, equilibrium-snapshot, and `SearchSummary` values that `replay_race` derives, at the moment each transition commits: resolutions and capped unresolved results at each look, the admission record and the mix before and after each admission, one snapshot per solve, and one summary when a search ends. `decisions_payload` encodes the live records with no change to the encoding, so the file is byte-for-byte the payload an independent replay produces. `run_psro` no longer calls `replay_transitions` after the loop.

   Resume. `replay_transitions` gains a bound: it replays only the transitions listed in the checkpoint's file references and stops there. It never opens a look beyond the checkpoint. After the bounded replay, `require_replayed_state` compares the partial replay state with the checkpoint's scientific state, as today. The replay yields the records for committed transitions; an unfinished search gets no summary. `execute_race` then continues the in-progress race and accumulates the rest. A resume of a complete run replays everything and `ensure_decisions` compares the existing file with the rebuilt payload, as today. The bounded replay uses the parallel helper; its cost is reported as part of `startupMs`.

   Divergence fix. `execute_race` treats an empty candidate family as a race with no looks; `replay_race` treats it as an error. Align `replay_race` with `execute_race` and add a fixture that reaches an empty family, so live and replay records agree on that path.

3. Completion check without replay. Add `assert_run_complete` for the `psro` command. It checks that the checkpoint status is complete, that `decisions.hpd` exists with a valid header, source identity, kind, length, and payload CRC, and that its payload CRC equals the CRC in the checkpoint's `DECISIONS_KIND` file reference. It does not replay. `verify_complete` stays byte-for-byte as it is and is called only by `run_verify`. The `psro` command therefore no longer runs `verify_look_evidence`, the scientific file-set check, `matrix::verify_files` at completion, or the final references comparison; all four remain in `psro-verify`. The admission rebuild path, which recreates expanded matrix files from an admission file after a restart, runs `matrix::verify_files` immediately after the rebuild, so the rebuilt-matrix fixture still proves the rebuild without a completion replay.

4. Cheaper atomic writes. `atomic_write_verified` keeps write, sync, rename, and parent sync. Its check reads the temporary file back and compares the bytes with the in-memory buffer; it no longer decodes or parses the payload. This applies to all four callers: checkpoint, look, admission, and decisions. The checkpoint's parse round trip is dropped with it. The post-rename read and parse of the look file and of the admission file are removed; the `FileRef` payload CRC comes from the in-memory header, which is the same value. A short or corrupt write still fails before rename.

5. Honest timing. `TransitionTiming` gains `gameMs` for the parallel game loop and `evaluateMs` for candidate evaluation or, for an admission, the solve; `elapsedMs` is their sum. Admission `elapsedMs` covers pair scoring, HST games, and the solve only. `RunReport` gains `startupMs` (input checks and any resume rebuild), `evidenceWriteMs` (the sum of all look, admission, checkpoint, expanded matrix, HST, and decisions writes), `finalizeMs` (decisions encoding and the completion check), and `otherMs`, such that:

   ```text
   elapsedMs = startupMs + sum(transitions[i].elapsedMs) + evidenceWriteMs + finalizeMs + otherMs
   ```

   `otherMs` is the remainder and must be reported, not hidden. These are operational JSON fields and never enter evidence. Step 1 of the order records these fields on the current binary so the before-and-after split uses the same definitions.

No change to seeds, schedules, depths, alpha, the threshold, queue rules, admission rules, matrix or HST formats, file names, headers, or the checkpoint layout.

### Runtime, `modal/psro_step.py` and `strategy_search_psro_job`

6. Local-disk staging. The Volume is the only durable authority; a warm container never reuses local state.
   - Before Rust starts, the wrapper removes and recreates `/tmp/hexdeck-psro/<evidence-id>`. If the Volume output directory contains `checkpoint.hpc`, it copies every Rust-owned file from the Volume directory into it. Rust-owned means every file except `lease.json`, `progress.json`, and `job-report.json`.
   - Rust runs with `--out` and `--report` under the local directory. `lease.json`, `progress.json`, and `job-report.json` stay on the Volume path, so `status` is unchanged.
   - On a handshake that reaches the ten-minute interval, the wrapper first writes `progress.json` to the Volume path, then copies every local file to the Volume directory, overwriting, and removes any remote `.tmp` file, then commits, then writes `committed N`. Rust is paused for the copy. A handshake inside the interval is acknowledged with no copy and no commit.
   - After the Rust process exits, the wrapper always copies local to Volume and commits, whether or not a handshake is pending, because `decisions.hpd`, the final checkpoint, and `run-report.json` are written after the last handshake.
   - The copy is bounded by the output size, under 100 MiB for the largest kingdom seen. Download selection is unchanged.

## Verification policy

After this change no deep replay runs inside the paid path. `psro` writes `decisions.hpd` from its own records and checks the file against its checkpoint reference. `psro-verify` is the independent replay and is opt-in: locally through `download --verify`, and in the Modal job it stays off. This matches the project rule that deep Goldfish, Matrix, and PSRO verification is opt-in. Update the sentences that say ordinary reporting trusts "completed deep verification": `docs/strategy-search-evidence.md` (the HST backfill paragraph), `docs/strategy-search-process.md` under "Evidence and restart", and the two README sentences about backfill and reporting. They must say that evidence is structurally checked and that deep verification is a separate, deliberate `psro-verify` run.

## Identity consequences

`rust/goldfish/src/psro.rs` is on both allowlists, so the scientific digest and the deployment digest change. Every evidence ID changes with them. The rule fingerprint does not change, because no game rule changes, so existing evidence files remain valid and comparable and the new `psro-verify` must pass on them.

- The Volume holds Goldfish files under the old evidence IDs. The first PSRO launch after this change needs the Goldfish-only route re-run for its kingdoms under the new digest; the files are byte-identical to the old ones. Eight kingdoms cost about $1 and 11 minutes.
- The eight-kingdom batch running under execution `1af5cd…` uses the deployed old image and its own app name. It is unaffected. Do not launch any paid PSRO run with the new binary until that batch has completed and been downloaded.

## Out of scope

- The competitive game kernel. The local 090 run spent 217 s of system time against 322 s of user time across 14 threads, which points at allocation and page-fault cost inside game play. That is a separate measurement and plan for `kernel.rs`.
- Goldfish and Matrix commands.
- Any change to what `psro-verify` checks.

## Acceptance

- A fresh local run of `balance-tuning-090` with the new binary against the same Goldfish and Matrix inputs produces scientific files byte-identical to the Modal evidence in `.data/damage-retune-86/balance-tuning-090/psro/`. `psro-verify` with the new binary passes on both directories, at 1 thread and at 14 threads.
- Existing Rust tests still pass without weakened assertions: byte identity across 1, 4, and 10 threads, every restart boundary, and the fixture paths for admission, queue retest, unresolved results, and two-clean-search completion.
- New Rust tests:
  - on every fixture path, including admission, queue retest, unresolved, and two clean searches, the live `decisions.hpd` equals the payload built from an independent replay;
  - a resume at every persistence boundary, including a boundary inside a race where earlier depths already resolved candidates, produces the same `decisions.hpd` as an uninterrupted run;
  - a resume with `HEXDECK_PSRO_TEST_STOP_AFTER_DECISIONS_RENAME`, where the file exists but the checkpoint has no decisions reference, compares the file with the rebuilt payload;
  - the bounded replay never opens a look beyond the checkpoint;
  - an empty candidate family gives the same records live and in replay;
  - `psro` rejects a self-consistent `decisions.hpd` whose CRC differs from the checkpoint reference and rejects a missing file; `psro-verify` still rejects the raw byte flip and the resealed `false_clean` corruption; the plan records that `psro` alone no longer rejects the resealed semantic corruption;
  - the atomic write rejects a truncated temporary file;
  - the rebuilt-matrix fixture passes with the verification at the rebuild point;
  - timing fields satisfy the equation on fresh, resumed, adopted-look, and admission runs.
- Python tests: the local directory is cleared before staging even when it holds stale looks; the pull copies only Rust-owned files; the push overwrites evidence, removes remote `.tmp` files, and does not touch `lease.json`, `progress.json`, or `job-report.json`; `progress.json` written before the copy survives it; no commit happens between intervals; the copy happens before `committed N` is written; the post-exit copy and commit run when no handshake is pending; `run-report.json` reaches the Volume.
- Timing target on the local 090 run: time outside `gameMs` at most 15% of wall. Report the actual split in the handoff.

Run:

```sh
npm run verify:native
npm run modal:test
npm run typecheck
npm run lint
git diff --check
```

`verify:native` covers the Rust kingdom check, native conformance tests, `cargo test`, `cargo fmt --check`, and `cargo clippy`.

## Implementation order

1. Timing split, recorded on the current binary first.
2. Parallel candidate evaluation shared by `score_look`, the adopted-look check, and `replay_race`; `psro-verify --threads`.
3. Live decision records, bounded resume replay, the empty-family alignment, and removal of the end-of-run replays; `assert_run_complete`; `matrix::verify_files` at the rebuild point.
4. Atomic write simplification at all four callers.
5. Runtime local-disk staging.
6. Tests and the four document sentences.
7. Validation, then the local 090 byte-identity and timing run.
8. One implementation review cycle against the recorded pre-implementation SHA, because this edits the scientific Rust path.

## Stop conditions

Stop and report if:

- any scientific byte differs between the new binary and the Modal 090 evidence;
- any existing thread-count or restart test needs a weakened assertion;
- live records and replay records differ on any fixture;
- the change needs a new evidence format, header field, or checkpoint field;
- the local timing target is missed by more than double, which means another serial path remains and needs its own measurement.
