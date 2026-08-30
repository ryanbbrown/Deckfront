# PSRO serial overhead removal

Status: implementation plan.

## Goal

Make the `psro` command spend its wall time playing games. Work that plays no game and makes no decision leaves the default path or runs on all cores. Scientific evidence bytes do not change: the same looks, seeds, schedules, confidence bounds, decisions, admissions, matrices, and `decisions.hpd` come out of a clean run and of a resumed run, and `psro-verify` still replays and checks all of it independently.

## Measured problem

`balance-tuning-090` under the current rules is 3.82M games in 14 screen looks with no admission.

- Modal, 16 cores: Rust ran 143 s. About 35 s was parallel game play. The rest was single-threaded: confidence bounds after each look inside the "transition" timer (about 15 s), two full replays of every transition at the end of the run (about 55 to 65 s), and per-look file writes with sync and read-back on the Volume mount (about 15 to 25 s). Startup input checks took 0.14 s.
- Local host, 14 threads: 99 s wall, 66 s inside transitions, 33 s outside. A macOS `sample` of the non-game path shows 237,000 samples of pool threads waiting on a condition variable against one busy thread.
- Code facts: `score_look` computes `confidence` for each active candidate in a sequential loop after the Rayon game loop and inside the timed region. `run_psro` ends with `replay_transitions`, then `ensure_decisions`, then `verify_complete`, which calls `replay_transitions` again. `atomic_write_verified` reads and parses the temporary file, and the look path reads and parses the renamed file a second time.
- The same shape appears in every kingdom: across the local persistent-mana runs, 25% to 35% of wall time was outside transitions, and the transitions themselves included the serial confidence work.

## Changes

### Rust, `rust/goldfish/src/psro.rs` only

1. Parallel candidate evaluation. Extract one helper that takes the active candidates, their cumulative score prefixes, the new suffix points, and alpha, and returns each candidate's bounds and decision. It runs on the existing Rayon pool with `par_iter` over candidate index and collects in index order. `confidence` is a pure function of one candidate's ordered scores, so per-candidate `f64` bits are unchanged. `score_look` and `replay_race` both call this helper, so `psro-verify` and restart adoption also use all cores.

2. Live decision records. During the run, the runtime accumulates the same `DecisionRecord`, admission, equilibrium-snapshot, and `SearchSummary` values that `replay_race` derives, at the moment each transition commits. On a resume, the existing startup adoption path already reads the committed files; it rebuilds the records for committed transitions once with `replay_transitions`, then live accumulation continues. At completion, `decisions.hpd` is written from the live records with the same `decisions_payload` encoding. `run_psro` no longer calls `replay_transitions` after the loop.

3. Completion check without replay. `verify_complete` in the `psro` command checks only that the checkpoint is complete, the decisions file exists with a valid header, source identity, and CRC, and its record counts match the checkpoint counters. The full independent replay and byte-equality check of `decisions.hpd` stays in `psro-verify`, unchanged.

4. Cheaper atomic writes. `atomic_write_verified` keeps write, sync, rename, and parent sync. The read-back check compares the temporary file's bytes with the in-memory buffer and stops; it no longer decodes and parses the payload. The second read and parse of the renamed look file is removed. A short or corrupt write still fails before rename.

5. Honest timing. `TransitionTiming` gains `gameMs` for the parallel game loop and `evaluateMs` for candidate evaluation, and `elapsedMs` keeps their sum. `RunReport` gains `startupMs`, `evidenceWriteMs` as the sum of all look, admission, checkpoint, matrix, HST, and decisions writes, `finalizeMs`, and `outsideTransitionMs`. These are operational JSON fields and never enter evidence.

No change to seeds, schedules, depths, alpha, the threshold, queue rules, admission rules, matrix or HST formats, file names, headers, or the checkpoint layout.

### Runtime, `modal/psro_step.py` and `strategy_search_psro_job`

6. Local-disk staging. Rust writes to `/tmp/hexdeck-psro/<evidence-id>` on the container's local disk instead of the Volume mount. Before Rust starts, if the Volume output directory contains `checkpoint.hpc`, the wrapper copies the whole Volume directory to the local directory. At each interval commit and after the final checkpoint, the wrapper copies every local file to the Volume directory, then commits. The handshake, ten-minute cadence, lease, progress, job report, and download are unchanged. The copy is bounded by the output size, under 100 MiB for the largest kingdom seen.

## Identity consequences

`rust/goldfish/src/psro.rs` is on both allowlists, so the scientific digest and the deployment digest change. Every evidence ID changes with them. The rule fingerprint does not change, because no game rule changes, so existing evidence files remain valid and comparable and the new `psro-verify` must pass on them.

- The Volume holds Goldfish files under the old evidence IDs. The first PSRO launch after this change needs the Goldfish-only route re-run for its kingdoms under the new digest; the files are byte-identical to the old ones. Eight kingdoms cost about $1 and 11 minutes.
- The eight-kingdom batch running under execution `1af5cd…` uses the deployed old image and its own app name. It is unaffected. Do not launch any paid PSRO run with the new binary until that batch has completed and been downloaded.

## Out of scope

- The competitive game kernel. The local 090 run spent 217 s of system time against 322 s of user time across 14 threads, which points at allocation and page-fault cost inside game play. That is a separate measurement and plan for `kernel.rs`.
- Goldfish and Matrix commands.
- Any change to what `psro-verify` checks.

## Acceptance

- A fresh local run of `balance-tuning-090` with the new binary against the same Goldfish and Matrix inputs produces scientific files byte-identical to the Modal evidence in `.data/damage-retune-86/balance-tuning-090/psro/`. `psro-verify` with the new binary passes on both directories.
- Existing Rust tests still pass: byte identity across 1, 4, and 10 threads, every restart boundary, and the fixture paths for admission, queue retest, unresolved results, and two-clean-search completion.
- New Rust tests: on every fixture path the live `decisions.hpd` equals the payload built from an independent replay; a resumed run at every persistence boundary produces the same `decisions.hpd` as an uninterrupted run; `psro-verify` still rejects a tampered decisions file; the completion check rejects a missing decisions file; the atomic write rejects a truncated temporary file.
- Python tests: staging copies the Volume directory to local disk before a resume, copies local files to the Volume at each commit and at the end, and does not commit between intervals.
- Timing target on the local 090 run: time outside game play at most 15% of wall. Report the actual split in the handoff.
- Docs: one sentence in `docs/strategy-search-process.md` under "Evidence and restart" stating that `psro` writes `decisions.hpd` from its own records and `psro-verify` is the independent replay. README unchanged unless a command changes.

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

1. Timing split, so the before and after are measured the same way.
2. Parallel candidate evaluation shared by `score_look` and `replay_race`.
3. Live decision records and removal of the two end-of-run replays.
4. Atomic write simplification.
5. Runtime local-disk staging.
6. Tests and the process-document sentence.
7. Validation, then the local 090 byte-identity and timing run.
8. One implementation review cycle against the recorded pre-implementation SHA, because this edits the scientific Rust path.

## Stop conditions

Stop and report if:

- any scientific byte differs between the new binary and the Modal 090 evidence;
- any existing thread-count or restart test needs a weakened assertion;
- live records and replay records differ on any fixture;
- the change needs a new evidence format, header field, or checkpoint field;
- the local timing target is missed by more than double, which means another serial path remains and needs its own measurement.
