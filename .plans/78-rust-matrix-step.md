# Rust matrix step

Status: approved after plan review v2 (`.reviews/plans/rust-matrix-step/rust-matrix-step-synthesis-v2.md`).

This plan implements step 2, "Build the first game matrix", of `.html/single-kingdom-strategy-search.html` (commit `3c1ba4d`). That HTML is the product intent. Step 1, the Goldfish reservoir, is `.plans/77-rust-goldfish-reservoir.md` (commit `a2f351b`) and is being implemented on a sibling branch. Plan 77 is the contract for the reservoir file this step reads.

## Goal

One Rust command reads the top 50 rows of a reservoir, plays the 1,225 unordered pairs on all cores, writes the `pairs` and `purchases` files, builds the 50 × 50 matrix from shuffles 1 to 75, solves the mix, verifies everything, and writes the `matrix` file. A second command verifies the three files. A thin Python function runs the command and collects the files. Nothing on the hot path is TypeScript or Python.

## Decisions already made

These come from the task brief and the HTML and are not open for review.

- Top 50 reservoir rows. 1,225 unordered pairs, no self-play, diagonal exactly 50%. Pair (A, B) gives both cells: B's points are 4 minus A's points.
- 125 fixed shuffle numbers, distinct from the Goldfish seeds. Two games per shuffle with seats swapped. Per shuffle 0 to 4 points for the first strategy of the pair (win 2, draw 1, loss 0 per game). Every shuffle's byte is stored.
- Files: `pairs` (one row per pair: two `u32` numbers + 125 bytes, pair order (1,2), (1,3), ... (49,50)); `purchases` (one row per pair and seat); `matrix` (header, 50 strategy numbers, 50 × 50 percentages from shuffles 1 to 75 only, 50 mix weights). Plan 77 header style with a CRC-32 of the row bytes. No timings in result files; a separate run report holds timings.
- Rust solves the mix as a linear program over 50 unknowns; maximum-support solution; remaining ties broken by lower strategy number; verified for nonnegative weights, sum 1, and no strategy above 50% against the mix within a fixed tolerance. `src/sim/equilibrium.ts` is the reference.
- One Rust command runs the whole step locally and on Modal. No intra-kingdom splitting. The Python wrapper only runs the command and collects the three files.
- Output bytes are identical across runs, thread counts, and machines.

## Scope seam with the sibling branch

- New files: `rust/goldfish/src/matrix.rs`, `rust/goldfish/src/equilibrium.rs`, `rust/goldfish/fixtures/balance-tuning-005.json`, `rust/goldfish/fixtures/balance-tuning-005-reservoir.hgf`, `modal/matrix_step.py`, `modal/test_matrix_step.py`, this plan.
- `rust/goldfish/src/main.rs`: two `mod` lines and one early dispatch at the top of `main` for the `matrix` and `matrix-verify` subcommands. Nothing else changes.
- `rust/goldfish/src/kernel.rs`: only what the matrix needs (listed below). No restructuring.
- `strategy-search-image-files.json` and `strategy-search-scientific-files.json`: add `rust/goldfish/src/equilibrium.rs` and `rust/goldfish/src/matrix.rs`. The image copies only allowlisted `rust/` files before `cargo build`, so `mod matrix;` in `main.rs` without these entries breaks the image build at merge.
- Not touched: the TypeScript matrix and PSRO code, the Modal controller and publisher, `README.md`, `docs/strategy-search-process.md`, `package.json`. See "Follow-ups after merge".

## Bounded decisions made in this plan

- Kingdom input: the commands take `--kingdom-file <path>` in the shape of `rust/goldfish/kingdom009.json` (`kingdom`, `orderedCardIds`, `ruleFingerprint`). The file is generated data, not trusted blindly: Rust requires `orderedCardIds` to equal the producer rule from `src/sim/mutation.ts` (`kingdomFacts`): the `kingdom.cards` entries with `id != "copper"` and `cost > 0`, unique, sorted by UTF-16 code units. Any other list is rejected. The fingerprint cannot be recomputed in Rust; it is compared with the reservoir header, which binds the reservoir to the same kingdom file. Plan 77 embeds a `kingdoms.json` table and selects by `--kingdom <id>`; that table does not exist on this branch. The fixture `rust/goldfish/fixtures/balance-tuning-005.json` is generated the same way as `kingdom009.json` (`nativeKingdomInput`, `orderedGoldfishCardIds`, `nativeRuleFingerprint(id, 30, 200)`) for `balance-tuning-005`, the first kingdom of the 30-kingdom set in `src/sim/balance-smoke-suite-manifest.json`. Every fixture, timing, and end-to-end run uses this kingdom; the older `deep-beam-tuning` kingdoms stay only where an existing conformance test pins them.
- Strategy number mapping: `matrix.rs` holds its own copy of the plan 77 mapping (permutation index = number / 54, quantity index = number % 54, `orderedPermutationAt` decode over `orderedCardIds`, `[a, b, c, 3, 3]` quantity vectors in nested order, five buy slots then five inactive slots). Plan 77 puts the same mapping in `reservoir.rs`; the follow-up after merge keeps one copy. A Rust test pins the mapping to values computed from `createOrderedCandidateSpace(...).candidateAt(n)` for kingdom `balance-tuning-005` (card IDs sorted by UTF-16: `cascade, channel, flurry, focus, gold, heavyBlow, overload, prism, regiment, silver, starfire, step, strike, volley`; candidate count 12,972,960; fingerprint `b7eaecb3cdb`):
  - 0 → cascade 1, channel 1, flurry 1, focus 3, gold 3
  - 1 → cascade 1, channel 1, flurry 2, focus 3, gold 3
  - 53 → cascade 4, channel 4, flurry 1, focus 3, gold 3
  - 54 → cascade 1, channel 1, flurry 1, focus 3, heavyBlow 3
  - 1,000,000 → channel 2, flurry 4, cascade 1, overload 3, strike 3
  - 6,486,479 → overload 4, volley 4, strike 1, step 3, starfire 3
  - 12,972,959 → volley 4, strike 4, step 1, starfire 3, silver 3
- CRC-32: IEEE 802.3 table implementation in `matrix.rs` (same algorithm as plan 77; no crate). Test vector: CRC-32 of `123456789` is `0xCBF43926`.
- Shuffle numbers: ordinal `k` in `1..=125` uses seed `4_200_000 + k`. The Goldfish seeds are `4_100_000..=4_100_003`. Step 3 gets its own ranges later.
- Competitive rules: turn limit 30 per player, action cap 200 per turn, starting draft off, `swap_sides` off, first-player health penalty and infinite count as the kernel constants. These match the campaign matrix stage (`scripts/strategy_search_campaign_matrix_score.ts`).
- Seat and seed mapping: for pair (A, B) and shuffle seed `s`, game 1 is `competitive_match(A as ochre, B as indigo, s, first_indigo = false)`, game 2 is the same with `first_indigo = true`. A's points for the shuffle are the sum of ochre's points over both games (win 2, draw 1, loss 0). This is exactly what `score_competitive` computes for a block `(A, B, s)`, so a test compares the two.
- Purchases row: `strategy u32, partner u32, u32 × card count, u32 × 5`. The card count is the number of cards in the kingdom file's `kingdom.cards` list, in that order; this is the index order of `Player::acquired`. `balance-tuning-005` has 16 cards (`copper, silver, gold, cascade, channel, flurry, heavyBlow, overload, prism, regiment, starfire, strike, volley, step, focus, scrap`), so the row is `8 + 64 + 20 = 92` bytes and the production file is `64 + 2,450 × 92` bytes. The five damage totals are the damage dealt by cards of each family over the 250 games, in the kernel `Family` order treasure, mana, melee, ranged, engine. Damage per family is the health the opponent actually lost from a card of that family, including the feint bonus and clamped at zero health. Semantics: a total is attributed to the kernel family of the card that was played (so `scrap` damage is engine damage). This is not the `classifyStrategyDamage` archetype measure in `src/sim/strategyDamage.ts`; balance reports keep using that classifier on the purchase counts, and the damage totals are telemetry only. Rows are in pair order, A's row then B's row.
- Matrix row: `strategy u32, N × f64 percentages (0 to 100), f64 weight` = `4 + 8N + 8` bytes (412 at N = 50); N rows in reservoir rank order. f64 is intended; the HTML's "about 12 KB" is loose prose. A cell is `sum75 / 3.0` where `sum75[i][j]` is the sum of the first 75 shuffle points of `i` against `j`; `sum75[j][i] = 300 − sum75[i][j]`; `sum75[i][i] = 150`. Build and verify compute cells the same way. The diagonal is exactly 50.0.
- Header for all three files: the plan 77 64-byte header with kinds 5 pairs, 6 purchases, 7 matrix; range `[0, N)` over reservoir ranks; row count; row CRC; source checksum = the reservoir's row CRC; seeds field holds a seed range for these kinds: slot 0 = first seed `4_200_001`, slot 1 = last seed `4_200_125`, slots 2 and 3 zero (plan 77 kinds hold a seed list, so a shared reader branches on kind); rule fingerprint copied from the kingdom file.
- Reservoir reader: checks magic, kind 4, row bytes 124, range `[0, 500000)`, the four Goldfish seeds `4_100_000..=4_100_003`, fingerprint equal to the kingdom file's, the CRC over all rows, and the row count. Every top-N strategy number must be below 12,972,960 and the top-N numbers must be unique; an out-of-range number would otherwise index past the card list in the decode, and a duplicate would put a strategy against itself off the diagonal. The row count must be exactly 20,000 unless `--top` is given explicitly; with `--top N` it must be at least `N`. Rank order and the source checksum against the top file are plan 77's `verify` job. Every test and the timing run pass `--top` explicitly, so a test-sized reservoir can never produce files that `matrix-verify` accepts without the same knob.
- `--top N`: parsed as an option, so an explicit `--top 50` is distinguishable from the default; `N` at least 2. An explicit `--top` lifts the 20,000-row reservoir rule. `matrix-verify` requires `N = 50` unless the same `--top` is given.
- Solver: a dense two-phase simplex in `equilibrium.rs` on `f64` with Bland's rule and a `1e-9` pivot tolerance. No crate. Determinism contract: the solver uses only `f64` add, subtract, multiply, divide, and comparisons in a fixed order; Rust does not fuse multiply-add or reorder floating-point operations, and IEEE 754 makes those operations bit-exact on every target the project builds for (aarch64 macOS, x86-64 Linux). A golden test pins the solver's output bytes for one fixed matrix; `cargo test` runs it on every machine that builds the binary. Variable order is ascending strategy number; that is the "lower strategy number" tie rule. The solved weights are mapped back to reservoir rank order before they are written, so matrix row `i` carries the weight of the strategy in row `i`. Phase 1 accepts a residual at or below `1e-9`; an equilibrium always exists for an antisymmetric matrix, so a larger residual is a program error and `matrix` exits non-zero with a message.
- Solver construction mirrors `equilibrium.ts`: payoff `payoff[i][j] = (2 × sum75[i][j] − 300) / 300`, which is exactly antisymmetric with a zero diagonal; the game value is 0 by antisymmetry, so the base-value LP is skipped. For each strategy `k`, solve `maximize p_k` subject to `p ≥ 0`, `Σ p = 1`, `Σ_i p_i payoff[i][j] ≥ 0` for every `j`. Support = strategies whose maximum exceeds `1e-6`. Weights = the average of the support witnesses, normalized to sum 1, clamped at 0. Constraints are exact (no `1e-7` slack as in the TypeScript). Known behavior: the TypeScript slack gives unsupported strategies weights of order `1e-6` and can put a strategy whose maximum sits near `1e-6` on the other side of the support boundary; the toy matrices are far from that boundary. Real matrices are degenerate (`docs/strategy-search-evidence.md` records wide single-strategy feasible bands), so each witness LP can have many optimal vertices and the averaged weights from Rust and from `solveEquilibrium` can differ materially while both are valid maximum-support equilibria with the same support. The mix in `matrix.hgm` is a new selection; it does not reproduce previously recorded TypeScript weights.
- Verification of the mix: every weight `≥ 0`; `|Σ w − 1| ≤ 1e-9`; `max_i Σ_j w_j payoff[i][j] ≤ 1e-6` (no strategy above 50% against the mix). `matrix` runs these on the solved weights. `matrix-verify` re-solves from the pair file, requires the stored weights to be byte-identical to the re-solved weights, and then runs the same checks.
- Output publication: `matrix` writes `pairs.hgm.tmp`, `purchases.hgm.tmp`, and `matrix.hgm.tmp`, runs the verify checks on them, and only then renames them in the order pairs, purchases, matrix. `matrix.hgm` is the completion marker: a consumer requires all three final files and a passing `matrix-verify`. A crash between renames leaves a partial set without `matrix.hgm`; a rerun overwrites all three. On a verify failure the `.tmp` files stay for diagnosis and no final file is written. The report is written last and is operational data outside the evidence boundary; a failed report write exits non-zero and the caller reruns.
- Run report: `--report <file>` writes `{ command, kingdomId, threads, strategyCount, pairCount, gameCount, elapsedMs, readMs, playMs, writeMs, solveMs, verifyMs, gamesPerSecond, bytesRead, bytesWritten }`. `readMs + playMs + writeMs + solveMs + verifyMs ≤ elapsedMs`. Result files never contain timings.
- Python wrapper: `modal/matrix_step.py` is plain Python with no `modal` import, so a Modal function can call it after merge. `run_matrix_step(binary, kingdom_file, reservoir, out_dir, threads, report=None)` runs the `matrix` command, raises `RuntimeError` with the bounded stderr tail on failure, and returns `{ "pairs", "purchases", "matrix" }` as path-and-bytes entries plus `"report"`: the parsed JSON when `report` is a path, else `None`.

## File formats

All integers little-endian. Header (64 bytes) as in plan 77:

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 4 | magic `HGR1` |
| 4 | 4 | kind: 5 pairs, 6 purchases, 7 matrix |
| 8 | 4 | row bytes: 133; `8 + 4 × cards + 20`; `4 + 8N + 8` |
| 12 | 4 | range start 0 |
| 16 | 4 | range end N (reservoir ranks) |
| 20 | 4 | row count: `N(N−1)/2`; `N(N−1)`; `N` |
| 24 | 4 | CRC-32 of all row bytes |
| 28 | 4 | source checksum: the reservoir's row CRC-32 |
| 32 | 16 | seed range for kinds 5 to 7: first seed `4_200_001`, last seed `4_200_125`, 0, 0 |
| 48 | 16 | rule fingerprint, ASCII, NUL padded |

Pairs row (133 bytes): first strategy number, second strategy number, 125 point bytes in shuffle ordinal order, each in `0..=4`. Pair order: for `i` in `0..N`, for `j` in `i+1..N`, by reservoir rank.

Purchases and matrix rows: see the bounded decisions.

File names under `--out <dir>`: `pairs.hgm`, `purchases.hgm`, `matrix.hgm`.

## Rust binary

```text
hexdeck-goldfish matrix        --kingdom-file FILE --reservoir FILE --out DIR --threads T [--top N] [--report FILE]
hexdeck-goldfish matrix-verify --kingdom-file FILE --reservoir FILE --out DIR [--top N]
```

`matrix`:

1. Read and check the kingdom file; compile the kingdom; check the candidate count is 12,972,960.
2. Read the reservoir (see reader rules); rebuild the `top` strategies from their numbers.
3. Build a rayon pool of `T` threads. Play the pairs with `par_iter` over the pair list; each pair plays its 125 shuffles × 2 games in order and returns its 125 point bytes plus its two purchase rows. Results are collected in pair order, so the thread count never changes the bytes.
4. Write `pairs.hgm.tmp` and `purchases.hgm.tmp`.
5. Build the percentages from shuffles 1 to 75, solve the mix, verify the mix, write `matrix.hgm.tmp`.
6. Run the `matrix-verify` checks on the three `.tmp` files. Exit non-zero on any failure. Rename the three files to their final names.
7. Write the report if requested. Print a one-line JSON summary.

`matrix-verify` reads the kingdom file, the reservoir, and the three files and checks: the kingdom file and reservoir rules above (including unique in-range top-N numbers), every header field (magic, kind, row bytes, range, row count, source checksum equal to the reservoir row CRC, seed range, fingerprint), every CRC, pair order and strategy numbers against the reservoir top rows, every pairs point byte in `0..=4`, purchases rows aligned with the pairs rows (same numbers, A then B), purchases content against each row's rebuilt buy plan (zero counts for every card outside the plan, each count at most `250 × desired count`, copper and scrap zero, each family damage total at most `250 × 50`), every matrix cell equal to `sum75 / 3.0` from the pair file with the diagonal 50.0, the matrix strategy numbers equal to the reservoir top rows in rank order, and the mix: re-solve from the pair file, require byte-identical stored weights, then run the validity checks. It exits non-zero with a message on any difference and prints a JSON summary on success.

### Kernel additions

- `Kingdom`, `Kingdom::compile`, `Kingdom::strategy`, `Strategy`, and `RawStrategy` construction become `pub(crate)` where needed.
- `State` gets `family_damage: [[i32; 5]; 2]` (by seat, by family). `damage` takes the playing card's family as an argument (the `hit!` macro in `play` passes `c.family`) and adds the health actually removed to `family_damage[active_seat][family]`. All damage flows through `damage` (the only write to `health` is there), so this captures every point.
- `competitive_match` is split into "build state" and "run to the end". A new `pub(crate) fn competitive_game(kingdom, ochre, indigo, seed, first_indigo, draft, turn_limit, action_cap) -> CompetitiveGame` returns the match result plus per seat (0 ochre, 1 indigo): `purchases: Vec<i16>` (from `Player::acquired`), `money_spent: i32`, `starting_health: i16`, `final_health: i16`, and `family_damage: [i32; 5]`. It always passes `swap_sides = false` to `State::competitive`, which is what `competitive_match` passes today. `competitive_match` calls it with the session's `starting_draft_enabled` and drops the telemetry, so there is one game loop.

## Python

`modal/matrix_step.py` and `modal/test_matrix_step.py`. The test uses a fake executable written to a temporary directory that records its arguments, writes the three files and a report, and exits 0; a second case exits 1 with stderr and expects `RuntimeError` containing that stderr; a third case passes `report=None`.

## Tests

Rust (`cargo test`):

- mapping pins listed above; CRC-32 test vector; header round trip.
- pair scoring equals `score_competitive` for the same kingdom, strategies, seeds, and blocks, on several pairs and all 125 seeds; the comparison reads the full 125-byte rows from the written `pairs.hgm`, so shuffles 76 to 125 are covered.
- `competitive_match` draft-on and draft-off parity: for a fixed set of games, the results before and after the split are identical. The writer captures the before values from the unmodified kernel at the recorded base SHA (outcome, reason, turns for a fixed list of games with draft on and off) and pins them.
- telemetry invariants on real games: for each seat, the sum of family damage equals the opponent's starting health minus final health; with draft off, the sum over cards of purchases × cost equals that seat's money spent.
- telemetry attribution on the kernel test fixture kingdom (`kernel.rs` tests): with draft off every player starts with three `scrap` (engine, 1 damage), so for a strategy that buys only `precisionShot`: ranged damage is positive, engine damage equals the scrap contribution, and treasure, mana, and melee are zero, for both seats; purchases count only `precisionShot` at its card index. A second fixture strategy that buys a melee card shows melee damage positive. The fixture gets a melee card for this.
- solver against the TypeScript reference on these matrices, weights within `1e-6` and support equal (nonzero above `1e-6`):
  - `[[0,-1,2],[1,0,-3],[-2,3,0]]` → `0.5, 1/3, 1/6` (unique)
  - `[[0,0,1],[0,0,0],[-1,0,0]]` → `0.5, 0.5, 0` (non-unique equilibrium; maximum support picks the average)
  - `[[0,-1,1,1],[1,0,-1,1],[-1,1,0,1],[-1,-1,-1,0]]` → `1/3, 1/3, 1/3, 0`
  - `[[0,1],[-1,0]]` → `1, 0`
  - a 50 × 50 antisymmetric matrix from a fixed LCG returns a verified mix, and its weight bytes equal a golden hex string recorded on first run (the cross-machine determinism check).
- fixture reservoir: `rust/goldfish/fixtures/balance-tuning-005-reservoir.hgf` is committed. It is in the plan 77 format (kind 4, 124-byte rows, range `[0, 500000)`, the four Goldfish seeds, source checksum 0, fingerprint from the fixture kingdom file, CRC), 60 rows with fixed strategy numbers from a stated formula that are unique, in range, and not in ascending order, and zero metrics. A test regenerates it with the helper and requires byte equality with the committed file.
- fixture end-to-end (integration test on the built binary): `matrix --top 6` at `--threads 1`, `--threads 4`, `--threads 10`, and a second `--threads 1` run produce byte-identical `pairs.hgm`, `purchases.hgm`, and `matrix.hgm`; the matrix row `i` carries the reservoir's rank-`i` strategy number and that strategy's weight (checked by strategy number against the solver output on the scrambled ranks, with a fixture where the weights are distinct); `matrix-verify --top 6` passes; a card outside a purchases row's buy plan has count zero; the purchases header row bytes equal `8 + 4 × 16 + 20 = 92`.
- `matrix-verify` rejections: a flipped byte in each of the three files (CRC); with the CRC recomputed: a pairs point byte of 5, a changed matrix cell, a changed stored weight, a swapped purchases row pair, a wrong source checksum, a wrong seed range, a wrong kind, a wrong row-bytes value, a wrong `--top`, a reservoir with a wrong fingerprint, a truncated reservoir, a reservoir with an out-of-range top number, a reservoir with a duplicate top number, a kingdom file with reordered `orderedCardIds`, and a run without `--top` against the 60-row fixture (row count must be 20,000).
- The integration test must finish in reasonable time. The binary the integration test runs is built with the `dev` profile (release uses `lto = "fat"` and `codegen-units = 1`, so the gap is large). Measure `--top 6 --threads 1` under `dev` first; if it is too slow, add `[profile.dev] opt-level = 2` to `rust/Cargo.toml`.

TypeScript: no additions. `npm test`, `npm run typecheck`, `npm run lint` must still pass.

Python: `npm run modal:test` with the new test file.

## Validation before completion

1. `cd rust && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`.
2. `npm run goldfish:native-build`, then `npx vitest run test/sim/rustCompetitiveConformance.test.ts` and confirm it ran (not skipped), then `npm run test:native`.
3. `npm test`, `npm run typecheck`, `npm run lint`.
4. `npm run modal:test`.
5. Timing: with the release binary, `matrix --top 50 --threads 10 --report` on the committed fixture reservoir; report games per second. This is a fixture measurement: the fixture's strategies are arbitrary, not real top-50 Goldfish strategies, so the HTML's 10,000 to 12,000 games per second is not directly comparable. Report the measured number whatever it is; the real run waits for plan 77.
6. Solver comparison on the fixture matrix: a one-off script (not committed) reads `matrix.hgm` from the timing run, calls `solveEquilibrium` from `src/sim/equilibrium.ts` on the same percentages with ids `gf-<number>`, keys both mixes by strategy id, and requires equal supports and that both mixes pass the validity checks. It reports the largest weight difference as information; a large difference is expected on a degenerate matrix and is not a defect.

No Modal deployment and no paid run. Report the diff summary, validation output, timing, the real-matrix comparison, and residual risks.

## Follow-ups after merge

These are named here so they survive the merge. None is part of this step.

1. Wire the `matrix` command into the campaign controller and publisher and delete the TypeScript matrix stage.
2. Switch `--kingdom-file` to plan 77's `--kingdom <id>` over the embedded `kingdoms.json`; delete `rust/goldfish/fixtures/balance-tuning-005.json` and the duplicate mapping in `matrix.rs`.
3. Add the two commands and the three output files to `README.md` and `docs/strategy-search-process.md`.
4. Run the real `balance-tuning-005` reservoir through `matrix` and record the timing and the solver comparison on a real matrix.
5. Run the solver golden test on the x86-64 Modal image.

## Implementation order

1. `equilibrium.rs` with its tests.
2. Kernel additions, the draft parity pins, and the pair-scoring parity test.
3. `matrix.rs`: mapping, CRC, header, reservoir reader, pair play, writers, matrix build, verify, report; `main.rs` dispatch; allowlist entries.
4. Fixture kingdom file, fixture reservoir writer, integration tests.
5. Python wrapper and test.
6. Validation and timing.
