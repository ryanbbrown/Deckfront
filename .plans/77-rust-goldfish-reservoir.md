# Rust Goldfish reservoir step

Status: implementation plan for review.

This plan implements step 1 of the strategy-search process as described in `.html/single-kingdom-strategy-search.html` (step 1 committed at `16a8a02`; the file now also holds step 2, which is out of scope here). That HTML is the product intent. This plan replaces the Goldfish parts of `.plans/74-scalable-strategy-search-runtime.md` and deletes the legacy Goldfish experiment paths. Matrix and PSRO keep the rules in `.plans/76-global-matrix-psro-runtime.md`.

## Goal

One Rust binary owns the whole Goldfish hot path for one kingdom: strategy number to five-card shopping list, simulation, scoring, fixed-size result rows, the top-500,000 reduction, the shuffle 2–4 rescoring, the 20,000-row reservoir, and verification of the final files.

No TypeScript and no Python game or ranking logic runs in this step. Python only hands out ranges, launches the binary, collects files, calls reduce, and calls verify. A local run needs no Python.

## Decisions already made

These come from the task brief and are not open for review.

- Strategy identity is the integer `0..12,972,959`. It maps directly to a shopping list. There is no traversal permutation, no hash, no display ID, no duplicate removal, and no collision allowance. Ties break by lower integer.
- The Rust mapping must produce the same buy plan as `createOrderedCandidateSpace(orderedGoldfishCardIds(kingdomId)).candidateAt(n)` in `src/sim/orderedGoldfishBenchmark.ts`.
- Ranking order is exactly the HTML "How we rank strategies" list.
- Result rows are 64 bytes; top-500000 is header + 500,000 × 64-byte rows, best first; reservoir is header + 20,000 × 124-byte rows, best first. Result files hold no timings.
- Seeds are `4,100,000..4,100,003`; turn limit 30; action cap 200; dummy opponents stationary, chaser, kiter.
- Local and Modal runs produce byte-identical `top-500000` and `reservoir` files.
- Downstream Matrix and PSRO start from the reservoir. Only their readers change.

## Bounded decisions made in this plan

- Checksum: CRC-32 (IEEE 802.3, the `zlib` polynomial) over the row bytes only. Rust implements it with a 256-entry table (no new crate). TypeScript verifies with `node:zlib.crc32` (Node 22.2+; the project runs Node 22.23).
- Byte order: little-endian for every integer field.
- Header identity: the header carries the kingdom rule fingerprint and the shuffle seeds, not an evidence ID. The Rust binary cannot know a campaign evidence ID, and an evidence ID in the bytes would break local-versus-Modal byte identity. Evidence identity stays in publication receipts and paths, as today.
- Kingdom data: one generated file `rust/goldfish/kingdoms.json` holds the native kingdom input, the sorted purchase card IDs, and the rule fingerprint for every registered strategy-search kingdom (260 kingdoms, about 1.2 MB). The binary embeds it at build time with `include_str!`. A test checks the committed file is current. This replaces `rust/goldfish/kingdom009.json` and `src/sim/nativeKingdom009.ts`.
- Test knobs: the reducers accept an explicit universe (`--start/--end`) and keep count (`--keep`) so a small local run can exercise the full pipeline. Production callers pass none of these; the defaults are the full space, 500,000, and 20,000. `verify` enforces the production shape unless the caller passes the same knobs.
- Runtime file names stay `tasks/<stage>/<start>-<end>.hgs`, `goldfish/top-500000.hgf`, and `goldfish/reservoir.hgf`. Names are runtime paths, not evidence; keeping them avoids churn in the operator, runtime, and status code.
- The Rust JSON line protocol (`--threads N --cpu-request N`, stdin requests: `hello`, `shuffle`, `compare_utf16`, `stable_hash`, `score_batch`, and the `*_competitive` requests) stays because the Rust-versus-TypeScript Goldfish conformance tests need `score_batch` with arbitrary strategies, turn limits, and action caps, and the competitive kernel serves PSRO through the same process. The `--stream-score-batch` NDJSON file mode, `write_score_stream`, its test, and `src/sim/nativeScoreStream.ts` are deleted together with every caller. Nothing in the campaign uses the JSON protocol for Goldfish after this change.
- Legacy Goldfish experiment paths are deleted, not kept behind flags. The "Legacy path deletions" section lists the seed set and the rule for dependent modules.
- Job sizing policy in `src/sim/strategySearchScheduler.ts` does not change. It is runtime policy, not evidence.

## File formats

All files start with one 64-byte header. All integers are little-endian `u32`.

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 4 | magic `HGR1` |
| 4 | 4 | kind: 1 stage-one rows, 2 stage-two rows, 3 top-500000, 4 reservoir |
| 8 | 4 | row bytes: 64 or 124 |
| 12 | 4 | range start |
| 16 | 4 | range end (exclusive) |
| 20 | 4 | row count |
| 24 | 4 | CRC-32 of all row bytes |
| 28 | 4 | seed count |
| 32 | 16 | four seeds; unused slots are 0 |
| 48 | 16 | rule fingerprint, ASCII, NUL padded |

Range semantics by kind:

- Stage-one rows: range over strategy numbers. Rows are in ascending strategy number; row count equals `end - start`; row `i` has number `start + i`. Seeds: `[4100000]`.
- Stage-two rows: range over top-500000 row indexes (ranks). Row `i` holds the strategy number from top row `start + i` and the totals from the nine games. Seeds: `[4100001, 4100002, 4100003]`.
- Top-500000: range `[0, 12972960)`, 500,000 rows, best first. Seeds: `[4100000]`.
- Reservoir: range `[0, 500000)` over top rows, 20,000 rows, best first. Seeds: all four.

Result row (64 bytes): strategy number, then for each dummy opponent in the order stationary, chaser, kiter: games played, games that reached 50 damage, penalized turns to 50 (31 per unfinished game), damage total across 30 turns, money spent. Same metric order as the Rust `Metrics` struct today.

Reservoir row (124 bytes): strategy number, the 15 shuffle-1 numbers, the 15 shuffle-2-to-4 numbers.

A writer creates the file with a zero header, streams rows while updating the CRC, then seeks to 0 and writes the final header. A reader recomputes the CRC and rejects any mismatch.

Run reports are separate small JSON files written by `--report <file>`:
`{ "command", "kingdomId", "rangeStart", "rangeEnd", "rowCount", "threads", "bytesRead", "bytesWritten", "elapsedMs", "scoringMs", "readMs", "writeMs", "reduceMs" }`. Result files never contain timings.

## Ranking

Best first. Compare in this order; the first difference decides:

1. more completions against the weakest dummy (minimum over the three profiles);
2. more total completions;
3. fewer penalized turns against the slowest dummy (maximum over profiles);
4. fewer total penalized turns;
5. more damage total against the weakest dummy (minimum over profiles);
6. more total damage;
7. more total money spent;
8. lower strategy number.

The reservoir ranks by the per-profile sums of the shuffle-1 and shuffle-2-to-4 numbers, then the same rules. This matches `compareEvidence` in `src/sim/orderedGoldfishProduct.ts` plus the number tiebreak.

## Strategy number mapping

Given the kingdom's purchase card IDs sorted by UTF-16 code units (`orderedGoldfishCardIds`), with `n` cards (14 for every registered kingdom) and the 54 quantity vectors from `orderedGoldfishQuantityVectors()` (`[a, b, c, 3, 3]` for `a, b, c` in `1..4` with sum at most 15, generated in that nested order):

- `permutationIndex = number / 54`, `quantityIndex = number % 54`;
- the permutation is decoded exactly as `orderedPermutationAt`: for each of the five positions, `blockSize = P(remaining - 1, slotsLeft)` (1 for the last slot), pick `available[remainder / blockSize]`, remove it, `remainder %= blockSize`;
- the strategy has an empty starting build and a ten-slot plan: five `buy` slots `(cardId, quantities[position])` followed by five inactive slots, which is what `fixedBuyPlan` produces.

The binary refuses a kingdom whose count is not `12,972,960`.

## Rust binary

Extend `rust/goldfish`. Keep the simulation in `kernel.rs`; expose what the new module needs (`Kingdom::compile`, a constructor for a `Strategy` from card indexes and counts, and `metrics`). Put the new code in `rust/goldfish/src/reservoir.rs` (mapping, formats, CRC, ranking, top-K, reducers, verify, reports) and the subcommand parsing in `main.rs`. Keep the JSON line protocol as the no-subcommand mode.

Subcommands:

```text
hexdeck-goldfish kingdom    --kingdom <id>
hexdeck-goldfish strategies --kingdom <id> --numbers <n,n,...>
hexdeck-goldfish score-one  --kingdom <id> --start S --end E --threads T --out FILE [--report FILE]
hexdeck-goldfish reduce-one --kingdom <id> --inputs LIST.json --out FILE [--start S --end E] [--keep N] [--report FILE]
hexdeck-goldfish score-two  --kingdom <id> --top FILE --start S --end E --threads T --out FILE [--report FILE]
hexdeck-goldfish reduce-two --kingdom <id> --top FILE --inputs LIST.json --out FILE [--keep N] [--report FILE]
hexdeck-goldfish verify     --kingdom <id> --kind stage-one|stage-two|top|reservoir --file FILE [--start S --end E] [--keep N] [--top FILE]
```

- `kingdom` prints `{ kingdomId, candidateCount, ruleFingerprint, cardIds }`. `strategies` prints one JSON shopping list per number. Tests and readiness use these.
- `score-one` splits the range into fixed blocks (1,024 numbers), scores blocks on a rayon pool of `T` threads in groups of `T × 8` blocks, and writes each group's rows in strategy-number order. Memory stays bounded to one group. Each strategy plays three games with seed `4100000`.
- `reduce-one` reads every input header, sorts inputs by range start, requires exact contiguous coverage of `[start, end)` with no overlap, checks each file's kind, seeds, fingerprint, row count, row order, and CRC while streaming, keeps the best `keep` rows in a bounded heap (about 32 MB at 500,000), sorts best first, and writes the top file.
- `score-two` verifies the top file header and CRC, reads rows `[start, end)`, plays nine games per strategy (seeds `4100001..4100003` × three profiles), and writes stage-two rows in rank order.
- `reduce-two` reads the top file and the stage-two inputs, requires exact coverage of every top row exactly once, adds the per-profile numbers, ranks, keeps the best `keep`, and writes the reservoir with both metric sets per row.
- `verify` checks header fields, CRC, row count, and for `stage-one` the expected range and row numbers; for `stage-two` the expected range; for `top` unique numbers inside the range and best-first order; for `reservoir` best-first combined order, unique numbers, and (with `--top`) that each row's shuffle-1 numbers equal the top file's row for that strategy. It exits non-zero with a message on any difference and prints a JSON summary on success.
- `LIST.json` is a JSON array of file paths, which is what the Python controller already writes.

Local run: `scripts/goldfish_reservoir.sh <kingdom-id> <threads> <out-dir>` runs `score-one` over the full range in one process, `reduce-one`, `score-two` over all 500,000 rows, `reduce-two`, and `verify` for both finals, writing reports to `<out-dir>/reports/`. Add npm script `goldfish:reservoir` that calls it. No Python, no TypeScript.

## TypeScript changes

- Add `src/sim/goldfishReservoir.ts`: header constants, header decode, CRC check via `node:zlib.crc32`, `readGoldfishTop(file, kingdomId)` and `readGoldfishReservoir(file, kingdomId, { top? })`. Records carry `rank`, `strategyNumber`, `strategy` (from `candidateAt(number)`), `displayId` (`strategy.id`), `canonicalStrategy`, `stageOne`, `additional`, `combined` (as `OrderedProductScoreEvidence`), and `stageOneRank` when the top file is given. Readers validate the fingerprint against `nativeRuleFingerprint(kingdomId, 30, 200)`, seeds, kind, CRC, unique numbers, and best-first order using `compareEvidence` plus the number tiebreak.
- Add `src/sim/nativeKingdoms.ts` with `nativeKingdomsJson()` for every registered strategy-search kingdom. Rewrite `scripts/write_native_kingdom.ts` to write and check `rust/goldfish/kingdoms.json`. Keep the npm script names `goldfish:native-kingdom-write` and `goldfish:native-kingdom-check`.
- Update readers: `scripts/strategy_search_campaign_matrix_manifest.ts` (`reservoirIdentityHash` and `reservoirContentHash` both become the reservoir file SHA-256; strategies are the first 50 records), `scripts/strategy_search_campaign_parallel_psro.ts` init mode (`goldfishRank: rank`, `seedSourceHash` and `sourceIdentityHash` from file SHA-256 values), `scripts/strategy_search_campaign_psro.ts` (`rankedSha256` becomes the top file SHA-256; `entries` are the new records), and `scripts/strategy_search_validate_artifact.ts` (`goldfish-one-reduce` reads and validates the top file; `goldfish-two-reduce` reads the reservoir with the top cross-check; `psro` candidate IDs come from the reservoir records). Drop the evidence-ID header checks; the fingerprint check replaces them.
- `src/sim/strategySearchCampaign.ts`: replace `orderedProduct` in `KingdomEvidenceIdentity` with `goldfish: { generator: 'ordered-five-rung-v1', rowFormat: 'goldfish-rows-v1', scorerVersion, candidateCount, retainedCount, reservoirCount, profiles, seeds, cardIds }`. No traversal, no collision allowance. Evidence IDs change; there is no compatibility requirement.
- Delete `scripts/strategy_search_goldfish.ts`, `src/sim/strategySearchCompact.ts`, `src/sim/nativeKingdom009.ts`, `rust/goldfish/kingdom009.json`, and `test/sim/strategySearchCompact.test.ts`. Remove the `goldfish` entry from `scripts/strategy_search_subprocess.ts` and the matching subprocess test case. The legacy experiment deletions are listed in their own section below.
- Update `strategy-search-image-files.json` and `strategy-search-scientific-files.json`: remove the deleted files, add `rust/goldfish/kingdoms.json` and `src/sim/goldfishReservoir.ts`. The image build already compiles everything under `rust/`.

## Python changes (`modal/`)

- `strategy_search_goldfish_job` launches the Rust binary directly through `_strategy_search_run_subprocess`: `score-one`/`score-two` with `--start --end --threads <cpu> --out --report`, `reduce-one`/`reduce-two` with `--inputs` (the JSON list Python already writes) and `--top` where needed. It maps the Rust report into the existing phase keys (`scoringMs`, `intermediateSerializationAndReadMs` = read + write, `reductionComputeMs`, `finalTop500000WriteMs`, `finalTop20000WriteMs`, `elapsedMs`; the remainder goes to `orchestrationQueueMs` as today). No `--evidence-id`.
- `_strategy_search_validate_publication` for `goldfish-one`, `goldfish-two`, `goldfish-one-reduce`, and `goldfish-two-reduce` runs `hexdeck-goldfish verify` with the expected kind, range, and (for the reservoir) the published top file. `_strategy_search_validate_compact` and its `struct` parsing are removed.
- `_strategy_search_verify_goldfish_startup` runs `hexdeck-goldfish kingdom --kingdom deep-beam-tuning-007` and requires `candidateCount == 12972960`. The binary path comes from `HEXDECK_GOLDFISH_BIN` with the image default `/workspace/rust/target/release/hexdeck-goldfish` so tests can point at the local build.
- The remote canary keeps its shape (`score-one`, range `0..1`).
- The legacy ordered-product launcher is deleted from `modal/native_strategy_search.py`: `score_shard`, `product_search`, `ordered_product_stage_one`, `ordered_product_stage_two`, `_run_product_stage`, `ordered_product_controller`, `controller`, the `launch` local entrypoint, `validate_launch_limits`, `reserve_cost` and the cost ledger constants, the ordered-product authorization tables, `_native_shard`, `_run_rust`, `_ordered_product_cli`, `_valid_ordered_product_checkpoint`, `_preserve_corrupt_file`, `_campaign_stage_one_ranges`, `_remaining_stage_seconds`, `_valid_stage_one_chunk_metadata`, `projected_cost_usd`, `projected_product_cost_usd`, `projected_ordered_product_cost_usd`, `claim_controller`, `update_run_status`, `record_controller_call`, `_result_hash`, `valid_result`, `_result_path`, `_stable_hash`, `ordered_subprocess_timeouts`, and every test that exists only for them. Keep `_run_checked`, `_called_process_details`, `_atomic_json`, the image definition, the competitive functions and entrypoints (`competitive_*`, `stage_competitive_input`, `launch_competitive`, `run_competitive`, and their helpers), and every `strategy_search_*` function.
- The controller's phase invariant, I/O ratio check, byte accounting, and report shape stay.

## Legacy path deletions

Delete these files and the npm scripts, README sections, and tests that exist only for them. The seed set is every script that only drives the old Goldfish path (ordered-product shards, staged Goldfish pools, random and enrichment pilots, Goldfish benchmarks):

- `scripts/ordered_goldfish_product.ts` (`goldfish:ordered-product`);
- `scripts/native_staged_product_search.ts` (`staged-goldfish:native-pool`);
- `scripts/native_ordered_shard_input.ts` and `test/sim/nativeOrderedShardInput.test.ts`;
- `scripts/ordered_goldfish_benchmark.ts` (`goldfish:ordered-benchmark`, `build:goldfish-worker`);
- `scripts/benchmark_strategy_search_compact.ts` (`strategy-search:compact-benchmark`);
- `scripts/native_goldfish_metadata.ts` (`goldfish:native-metadata`);
- `scripts/staged_goldfish_ab.ts` (all `staged-goldfish:*` scripts), `src/sim/stagedGoldfishSuite.ts`, `test/sim/stagedGoldfishSuite.test.ts`;
- `scripts/goldfish_random_pilot.ts` (`goldfish:pilot`) and `scripts/goldfish_enrichment_pilot.ts` (`goldfish:enrichment`);
- `src/sim/nativeScoreStream.ts` and `test/sim/nativeScoreStream.test.ts`;
- `src/sim/orderedGoldfishSplitArtifact.ts` and its test block in `test/sim/orderedGoldfishProduct.test.ts`;
- the Rust `--stream-score-batch` mode.

Rule for dependents: after the seed set is gone, delete any `src/sim` module, worker, or test whose only importers were deleted (for example `src/sim/stagedGoldfish.ts` and `test/sim/stagedGoldfish.test.ts` if nothing else imports them). Keep a module when a retained script or test still imports it (for example `src/sim/nativeStrategySearch.ts` while the fixed-reservoir PSRO scripts import it, and `src/server/goldfishWorker.ts` while those scripts spawn it). Keep `src/sim/goldfish.ts`, `src/sim/orderedGoldfishBenchmark.ts`, `src/sim/orderedGoldfishProduct.ts`, `src/sim/rustGoldfishScorer.ts`, and `src/sim/nativeGoldfishProtocol.ts`: they are the TypeScript reference, the mapping, the ranking evidence types, and the conformance and competitive clients. Do not delete fixed-reservoir, ordered-reservoir, response-oracle, or PSRO experiment scripts; they are not the Goldfish path.

Remove the deleted files from `strategy-search-image-files.json` and `strategy-search-scientific-files.json`. `npm run typecheck`, `npm run lint`, and `npm test` prove nothing dangling remains. The README loses the ordered-product, staged-Goldfish, benchmark, pilot, and `native-metadata` command sections.

## Documentation

- `README.md`: describe the Goldfish reservoir step, the local command, the three output files, and the verify command. Replace the `kingdom009.json` mentions.
- `docs/strategy-search-process.md`: rewrite section 1 to match the HTML: strategy numbers, five steps, ranking, files, checksums, cleanup, and run report.
- `docs/strategy-search-campaign-operator.md`: update the readiness and output sentences that name the TypeScript Goldfish worker.
- Move `.plans/74-scalable-strategy-search-runtime.md`, `.plans/75-scalable-strategy-search-runtime-results.md`, `.plans/59-ordered-goldfish-product-correction.md`, and `.plans/60-ordered-goldfish-product-correction-results.md` to `.plans/archive/` with the banner `> Archived: Goldfish process replaced by .plans/77-rust-goldfish-reservoir.md; Matrix and PSRO runtime rules live in .plans/76-global-matrix-psro-runtime.md.` Add rows to `.plans/archive/README.md`.

## Tests

Rust (`cargo test`):

- permutation decode for small card lists against hand-computed results, first and last number, and the 54 quantity vectors in order;
- CRC-32 of `123456789` is `0xCBF43926`;
- comparator order on crafted rows and the number tiebreak;
- bounded top-K equals full sort on random rows;
- header round trip; `verify` rejects a flipped row byte and a wrong range.

TypeScript (vitest, `test/sim/goldfishReservoir.test.ts`, skipped when the binary is absent, and included in `test:native`):

- mapping parity: sample numbers across the full range (0, last, every quantity index for several permutations, a stride sweep of a few thousand numbers); `hexdeck-goldfish strategies` output equals `canonicalStrategy(candidateAt(n))` for each;
- small pipeline: `score-one` for `[0, 600)` as one range, as `[0,200)+[200,600)`, and as `[0,300)+[300,600)`; `reduce-one --keep 120`; `score-two` split two ways; `reduce-two --keep 40`; `verify` passes; `top` and `reservoir` bytes are identical across the three layouts and across two runs; the TypeScript readers decode the files, check order, and reconstruct strategies that match `candidateAt`;
- `kingdoms.json` is current;
- existing conformance tests keep passing.

Python (`npm run modal:test`): goldfish job command shape and report mapping (patched subprocess), validation calls `verify` with the expected arguments, readiness uses the Rust `kingdom` command and fails when the binary is missing, controller materialization tests unchanged, and the ordered-product launcher tests are removed with the launcher.

## Validation before completion

1. `npm run goldfish:native-verify` (cargo test, fmt, clippy with `-D warnings`).
2. `npm run goldfish:native-kingdom-check`, `npm run test:native`.
3. `npm test`, `npm run typecheck`, `npm run lint`.
4. `npm run modal:test`.
5. Full local run on `deep-beam-tuning-009` with 10 threads through `scripts/goldfish_reservoir.sh`, run as a durable terminal job. Report wall time per stage from the reports. Expectation: about 6 minutes for stage one and under 10 minutes total. Report the measured numbers whatever they are.

No Modal deployment and no paid run. Report the final diff summary, validation output, local timings, and residual risks.

## Implementation order

1. `kingdoms.json` generator and check; Rust mapping, `kingdom`, and `strategies` subcommands; TypeScript mapping parity test.
2. Row and header formats, CRC, writer and reader, `score-one`, `verify` for stage-one.
3. `reduce-one`, `score-two`, `reduce-two`, `verify` for the other kinds, reports, local shell script.
4. TypeScript readers and downstream script updates; delete the old TypeScript path; allowlists; evidence identity.
5. Python job, validation, readiness; delete the streaming mode; tests.
6. Docs, plan archive, full local run, validation.
