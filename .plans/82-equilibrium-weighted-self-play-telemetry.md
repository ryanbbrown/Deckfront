# Equilibrium-weighted self-play telemetry

Status: implemented. All 30 kingdoms have source-linked HST v1 evidence. Ordinary backfill and report generation trust the completed scientific evidence and use structural verification only; deep native replay remains an explicit audit command.

This plan adds the missing same-strategy purchase and family-damage evidence to the completed Rust strategy-search results. It then replaces the current off-diagonal report headlines with exact telemetry for the stored equilibrium lottery playing against itself.

This plan supersedes the telemetry limits, report schema, calculations, output names, and related tests in `.plans/81-rust-strategy-search-balance-analysis.md`. It does not change plans 77 through 79 or any completed Goldfish, Matrix, or PSRO decision.

## Goal

For every strategy in each final Matrix:

- play deterministic same-strategy games with the existing 125 Matrix seeds;
- include both player positions;
- store verified, source-linked binary telemetry;
- combine diagonal and existing off-diagonal telemetry with the stored equilibrium weights on both the acting strategy and its opponent;
- use the resulting acquisition rates for strategy classification and headline card usage;
- keep unweighted all-Matrix telemetry only as labeled audit evidence.

Backfill all 30 completed `balance-smoke-v1` kingdoms locally. Do not rerun Goldfish, any off-diagonal Matrix pair, PSRO screening, PSRO confirmation, PSRO queue retests, or PSRO admission pairs.

## Frozen scientific behavior

The implementation must preserve these rules and bytes:

- Goldfish candidate generation, seeds, scoring, ranking, `top-500000.hgf`, and `reservoir.hgf`;
- all existing off-diagonal Matrix games, pair bytes, purchases, family damage, 75-seed payoff cells, and fixed 50% payoff diagonal;
- the Matrix seed range `4,200,001..4,200,125` and two-game seat-swap protocol;
- the Rust maximum-support solver, selected equilibrium weights, matrix order, support tolerance, payoff constraints, and every existing `pairs.hgm`, `purchases.hgm`, and `matrix.hgm` byte;
- all PSRO schedules, seeds, confidence bounds, decisions, admissions, checkpoints, expanded HGM bytes, and final equilibrium bytes;
- the game kernel, turn limit 30, action cap 200, first-player health rule, draft-off rule, and side-swap rule;
- the meaning of paired point bytes and the absence of exact W/D/L, card-play, per-card damage, and turn evidence.

Same-strategy games are telemetry only. They never enter a payoff, solver, response decision, clean-search count, or strategy order. The Matrix diagonal stays exactly 50% and is not estimated from these games.

Before implementation, record SHA-256 for every existing HGF, HGM, HPL, HPA, HPC, and HPD file under `.data/strategy-search-30`. Compare the manifest after backfill. Any changed pre-existing byte is a hard failure.

## Same-strategy protocol

For each final Matrix strategy `i` and each seed `4,200,001..4,200,125`:

1. Play `i` against `i` with `first_indigo = false`.
2. Play `i` against `i` with `first_indigo = true`.
3. Record purchases and the five existing played-card family-damage totals for both player sides in both games.
4. Attribute each player side to its game position: first player or second player.

Each strategy therefore has:

- 250 games;
- 250 first-player-side observations;
- 250 second-player-side observations;
- 500 player-side observations in total.

The diagonal rate for a card or damage family is:

```text
(first-player total + second-player total) / 500 player sides
```

Do not divide by 250 after adding both sides. Do not count one game as one telemetry observation. This normalization prevents the same strategy on both sides from doubling its reported per-player rate.

Existing off-diagonal ordered telemetry cell `i,j` remains:

```text
recorded total for acting strategy i against opponent j / 250 player games
```

The same-strategy runner reuses `competitive_game`. It must not add another game loop or strategy decoder.

## Versioned evidence file

Add `self-play-v1.hst`. Initial Matrix output stores it beside the three HGM files. Expanded PSRO output stores it beside the expanded HGM files. As with the HGM selection rule:

- zero PSRO admissions use `matrix/self-play-v1.hst`;
- one or more admissions use `psro/self-play-v1.hst`.

All integers are little-endian. The 128-byte header is:

| Offset | Bytes | Field |
| ---: | ---: | --- |
| 0 | 4 | magic `HST1` |
| 4 | 4 | format version `1` |
| 8 | 4 | header bytes `128` |
| 12 | 4 | payload bytes |
| 16 | 4 | CRC-32 of the payload |
| 20 | 4 | row count, equal to final Matrix size |
| 24 | 4 | row bytes, derived from card count |
| 28 | 4 | kingdom card count |
| 32 | 4 | reservoir row CRC |
| 36 | 4 | selected `pairs.hgm` row CRC |
| 40 | 4 | selected `purchases.hgm` row CRC |
| 44 | 4 | selected `matrix.hgm` row CRC |
| 48 | 4 | first seed `4,200,001` |
| 52 | 4 | last seed `4,200,125` |
| 56 | 4 | seed count `125` |
| 60 | 4 | games per seed `2` |
| 64 | 4 | player positions `2` |
| 68 | 4 | total player sides per strategy `500` |
| 72 | 4 | Matrix generation, equal to PSRO admission count |
| 76 | 4 | reserved zero |
| 80 | 16 | rule fingerprint, ASCII and NUL padded |
| 96 | 32 | protocol tag `equilibrium-self-play-v1`, ASCII and NUL padded |

Rows follow final Matrix order. One row is:

```text
strategy number u32
first-player player-side count u32 (= 250)
first-player purchases: card count × u32
first-player family damage: treasure, mana, melee, ranged, engine × u32
second-player player-side count u32 (= 250)
second-player purchases: card count × u32
second-player family damage: treasure, mana, melee, ranged, engine × u32
```

The file stores counts, not normalized floats. This keeps exact evidence and lets readers apply the recorded denominators. It stores no result score because same-strategy results do not define the Matrix diagonal.

The source HGM CRCs bind the telemetry to the exact strategy order and equilibrium witness. The reservoir CRC and rule fingerprint bind the strategy definitions and game rules. The verifier rejects an unknown version or protocol instead of adding a fallback.

## Rust generation and verification

Add one owner for the format, same-strategy scoring, reading, and checking. `matrix.rs` can expose existing HGM header and Matrix-evidence details, but its old encoding and scoring functions must not change behavior.

Generation must be deterministic across thread counts and machines:

- build jobs in final Matrix order;
- score strategies in parallel on the existing Rayon pool;
- restore Matrix order before encoding;
- aggregate integer counters only;
- write a temporary file, sync it, verify it, rename it, and sync the directory.

Verification checks:

- magic, version, header size, protocol, zero reserved bytes, exact length, and CRC;
- fingerprint, reservoir CRC, and all three selected HGM CRCs;
- exact Matrix generation, strategy count, Matrix order, seeds, game count, position count, and player-side counts;
- one unique in-reservoir strategy number per Matrix row;
- exact kingdom card order through the bound kingdom definition;
- nonnegative `u32` counts and the existing purchase and family-damage game bounds;
- no trailing bytes, `.tmp` source, or source mismatch.

Structural verification does not replay games. Determinism tests and two independent local generations prove reproducibility.

### Future Matrix output

The `matrix` command scores same-strategy telemetry after it has produced the unchanged off-diagonal results and unchanged solved Matrix bytes. It writes and verifies `self-play-v1.hst` before renaming the unchanged `matrix.hgm` completion marker.

`matrix-verify` requires and verifies `self-play-v1.hst`. There is no steady-state option to accept missing diagonal telemetry.

### Future PSRO output

PSRO loads the verified initial self-play file without changing any PSRO source identity, seed set, checkpoint, admission, or decision format. On an admission, it scores same-strategy telemetry only for the admitted strategy, combines that row with the retained prior rows, and writes the current expanded `self-play-v1.hst` beside the unchanged expanded HGM set. The HST file is published before the unchanged expanded `matrix.hgm` completion marker.

A restart may regenerate only a missing HST row because HST is not decision evidence. It must not replay an admitted off-diagonal pair or any PSRO race. A valid HST row is retained and not rescored.

`psro-verify` checks the selected initial or expanded HST file after it completes the existing independent PSRO replay. HST does not enter the checkpoint reference list or `decisions.hpd`, so every existing HPS byte remains unchanged.

## Local backfill

Add one command:

```sh
npm run strategy-search:self-play-backfill -- \
  --root .data/strategy-search-30 \
  --binary rust/target/release/hexdeck-goldfish \
  --threads 10 \
  --report .data/strategy-search-30/self-play-backfill-v1.json
```

The TypeScript wrapper reads the 30 kingdom IDs from `balance-smoke-suite-manifest.json`. It has no paid or Modal path. For each kingdom in manifest order it calls a dedicated Rust command:

```text
hexdeck-goldfish self-play-backfill \
  --kingdom K \
  --top-file TOP \
  --reservoir RESERVOIR \
  --matrix-dir INITIAL_MATRIX_DIR \
  --psro-dir PSRO_DIR \
  --threads T
```

The Rust command:

1. checks only existing file headers, lengths, CRCs, source identities, final checkpoint completion, and selected Matrix strategy order;
2. writes and verifies `matrix/self-play-v1.hst` for the initial 50 strategies;
3. when PSRO admitted strategies, reuses the initial 50 rows, scores only admitted final strategies, and writes and verifies `psro/self-play-v1.hst` bound to the expanded HGM CRCs;
4. prints a JSON summary with kingdom ID, initial and final strategy counts, newly scored strategies, game count, and bytes.

The backfill command does not independently replay Goldfish ranking, Matrix solving, PSRO transitions, screening, decisions, or race evidence. The completed scientific evidence is trusted from its prior deep verification. `verify`, `matrix-verify`, and `psro-verify` remain available for a deliberate audit, but ordinary backfill does not call them.

A valid source-linked HST is skipped. A partial, stale, corrupt, wrong-version, or wrong-source HST stops the command; the operator must remove that new HST explicitly before retrying. The command never overwrites or repairs HGF, HGM, or HPS evidence.

The wrapper stops on the first failure and writes its deterministic report only after all 30 pass. The report records manifest-order kingdom summaries, source and output hashes, verifier binary hash, Git SHA, and total new same-strategy games. It contains no timestamp or host path.

## Exact equilibrium telemetry

Let `p_i` be the stored selected equilibrium weight for acting strategy `i`. Use the same stored weight `p_j` for opponent strategy `j`.

For card `c`, define normalized cell rate `A[i,j,c]`:

```text
i != j: purchases in existing ordered HGM row i,j / 250 player games
i == j: both HST position totals / 500 player sides
```

For family `f`, define `D[i,j,f]` the same way from actual played-card family damage.

Calculate each strategy's acquisition rates against the equilibrium opponent:

```text
strategyAcquisitionRate[i,c] = sum over j of p_j × A[i,j,c]
```

Classify strategy `i` with the existing `classifyStrategyDamage` call:

```text
classifyStrategyDamage({
  startingBuild: strategy[i].startingBuild,
  acquisitionRates: strategyAcquisitionRate[i]
})
```

Fix these labels before any feasible-range linear program. Archetype selected shares and ranges keep the existing `strategy:report` meaning.

Calculate exact selected-lottery self-play headlines:

```text
expectedAcquiredCopies[c] = sum over i of p_i × strategyAcquisitionRate[i,c]
expectedFamilyDamage[f] = sum over i of p_i × sum over j of p_j × D[i,j,f]
familyDamageShare[f] = expectedFamilyDamage[f] / sum over all families of expectedFamilyDamage
```

These are ordered draws from the equilibrium lottery: one weight selects the acting strategy and one independently selects its opponent. Do not use a uniform opponent, condition on `i != j`, renormalize after removing zero weights, or pool raw Matrix rows.

Match the strategy report's card meanings:

- `equilibriumAcquisitionRate`: `sum_i p_i × 1[strategyAcquisitionRate[i,c] > 0]`;
- `equilibriumSelectionRate`: the same acquisition presence plus starting-deck presence, counted once per acting strategy;
- `equilibriumMeanOwnedCopies`: `sum_i p_i × (starting copies + strategyAcquisitionRate[i,c])`;
- ordered Goldfish strategies have empty starting builds, so expected acquired copies and mean owned copies are equal for this corpus.

Each kingdom has equal weight in cross-kingdom headlines. Offering-conditioned card means include every kingdom where the card is offered, including zero use. The implementation should extract or reuse one pure weighted-cell helper so `summarizeLotteryAcquisitions`, initial-Matrix analysis, and the Rust report cannot silently use different acting/opponent formulas. Existing callers must keep their current outputs.

## Singleton equilibria

A singleton equilibrium has one strategy with weight 1 and every other strategy at weight 0. Its headline acquisitions, family damage, and classifier inputs must come only from that strategy's diagonal HST row.

Do not divide by support size, `support size - 1`, or the number of positive off-diagonal opponents. The full final Matrix can still contain many zero-weight strategies. Feasible singleton strategy-weight ranges continue to use the full payoff matrix.

## Report schema and migration

Replace report schema version 1 with version 2:

```text
protocol: rust-strategy-search-balance-v2
JSON: .data/strategy-search-30/rust-balance-analysis-v2.json
HTML: .html/strategy-search-30-rust-balance-v2.html
```

Delete the tracked v1 HTML and remove a local v1 JSON during the production migration. Do not emit both schemas or add a reader fallback.

Update `src/sim/rustStrategySearchEvidence.ts` to decode the selected HST after adapter checks for structure, CRCs, source links, checkpoint completion, and selected Matrix order. Include its path, bytes, CRC, and SHA-256 in the ordered source list and `evidenceSetSha256`. Report generation must not call the deep native verifiers.

Update `src/sim/rustStrategySearchBalance.ts` and the report CLI so the primary per-kingdom and cross-kingdom sections contain:

- equilibrium-opponent acquisition rates for every strategy;
- classifier labels derived from those rates;
- exact equilibrium self-play card acquisition, acquisition presence, selection presence, and mean owned copies;
- exact equilibrium self-play family damage per player-game and family shares;
- explicit basis text: `stored equilibrium lottery versus itself; diagonal included; rates are per player side`.

Keep raw counts only under a section and JSON object named `auditTelemetry`. Label it `unweighted full-Matrix observed counts`. It may contain off-diagonal HGM counts, diagonal HST counts, player-side denominators, and pooled rates. It must not supply a headline chart, sort order, outlier queue, classifier, balance finding, or top-level card/family measure.

Remove these misleading version-1 fields and phrases instead of retaining aliases:

- `selectedStrategyUniformOffDiagonalOpponentCopiesPerPlayerGame`;
- `selectedStrategyUniformOffDiagonalOpponentDamagePerPlayerGame`;
- top-level pooled `totalCopies`, `totalDamage`, and `playerGames` as balance measures;
- `off-diagonal-full-matrix-acquisitions` as a headline evidence basis;
- `diagonalSelfPlay.available: false` and all prose that says diagonal purchases or family damage are absent;
- the telemetry-weighting-difference outlier based on uniform opponents;
- v1 default paths, protocol constants, fixtures, goldens, README examples, and HTML text.

Keep the fixed-50 payoff-diagonal warning separate from telemetry availability. Keep all limits about paired byte `2`, exact W/D/L, first-player outcomes, card plays, per-card damage, and turns.

Update source provenance to version 2. Preserve historical Goldfish, Matrix, and PSRO execution facts and hashes. Add:

- `scientificImplementationCommits.selfPlayTelemetry`;
- a local `self-play-telemetry` execution covering all 30 kingdoms exactly once;
- the backfill report path and SHA-256;
- the backfill/verifier binary SHA-256;
- explicit distinction between historical execution binaries and the current verifier/backfill binary.

Do not claim that the new binary ran the old Matrix or PSRO work. Remove the v1 rule that requires historical Matrix and PSRO execution hashes to equal the current verifier binary; require each execution's recorded hash or explicit unavailable reason instead.

After this plan is implemented, move plan 81 to `.plans/archive/81-rust-strategy-search-balance-analysis.md` with a banner naming plan 82 as its replacement, and add the archive index row.

## Tests

### Rust format and scoring

- format encode/decode round trip and a pinned complete row;
- reject bad magic, version, header size, protocol, reserved bytes, row size, count, length, CRC, fingerprint, seed fields, source CRCs, generation, Matrix order, player-side counts, bounds, and trailing bytes;
- same-strategy scoring uses every seed exactly twice and records both player positions;
- first- and second-player counters each equal 250 and the normalized total denominator is 500;
- telemetry totals equal a direct `competitive_game` reference loop;
- bytes match at 1, 4, and 10 threads and across repeated runs;
- Matrix HGM bytes match frozen fixture hashes before and after HST generation;
- PSRO HPS and expanded HGM bytes match frozen fixture hashes before and after HST generation;
- Matrix and PSRO verification reject a missing, stale, corrupt, or wrong-source HST;
- PSRO restart retains valid rows, regenerates only a missing admitted row, and never replays off-diagonal admission or race games.

### Adapter and binary gate

- zero admissions select the initial HST; admissions select the expanded HST;
- structural Goldfish, HGM, checkpoint, and source-link checks complete before TypeScript reads HST, without a native command;
- HST source CRCs and strategy order must equal the selected HGM set and checkpoint;
- corrupt headers, counts, row order, CRC, source links, symlinks, and `.tmp` files fail;
- every consumed HST appears in source hashes and changes `evidenceSetSha256`;
- the dedicated backfill path can validate legacy core evidence only while creating HST; normal Matrix, PSRO, adapter, and report paths cannot bypass HST.

### Weighting and classification

- a small asymmetric matrix pins every `A[i,j,c]` and `D[i,j,f]` cell denominator;
- diagonal totals use 500 player sides, not 250 games;
- opponent weights produce each strategy's acquisition rates;
- acting-strategy weights produce exact metagame card and family headlines;
- a fixture where uniform and equilibrium opponents give different purchases proves classification uses the equilibrium opponent;
- a fixture where acting weights differ proves headline card usage uses the acting weight too;
- parity fixtures match `summarizeLotteryAcquisitions` and the strategy-report acquisition, selection, and mean-owned-copy meanings;
- selected archetype shares and full feasible ranges use the new fixed labels;
- a singleton equilibrium uses only diagonal telemetry and produces finite card, family, classifier, and range output;
- offered but unused cards remain at zero;
- family shares sum to 1 when recorded damage is positive and remain defined when total damage is zero.

### Schema, audit, provenance, and HTML

- a two-kingdom v2 golden is byte-identical across input enumeration and absolute roots;
- v2 JSON and HTML contain equilibrium self-play basis text and all HST hashes;
- raw all-Matrix data exists only under `auditTelemetry` with the required label;
- no headline, classifier input, outlier, or card/family sort reads audit telemetry;
- removed v1 field names and uniform-opponent prose are absent from JSON, HTML, TypeScript types, tests, README, and docs;
- fixed-50 payoff diagonal and remaining evidence limits are still visible;
- provenance assigns all 30 kingdoms exactly once to the local telemetry execution and does not rewrite historical execution identity;
- default CLI paths are exactly the v2 paths;
- generation remains atomic and deterministic.

## Documentation

Update:

- `README.md`: local backfill command, structural verification policy, explicit deep audit commands, v2 report command and outputs, exact equilibrium weighting, and remaining evidence limits;
- `docs/strategy-search-process.md`: Matrix same-strategy telemetry, fixed payoff diagonal, HST format, PSRO retention, and local backfill;
- `docs/strategy-search-evidence.md`: define the selected-lottery self-play telemetry basis, both-weight formula, classifier input, singleton behavior, and the audit-only status of raw Matrix telemetry;
- `.html/strategy-search-30-rust-balance-v2.html`: committed final report.

Do not change historical result claims in `docs/strategy-search-evidence.md`.

## Implementation order

1. Record the pre-implementation SHA and the SHA-256 manifest of every existing scientific evidence file. Freeze the current Matrix, PSRO, solver, and equilibrium fixture bytes.
2. Add the HST v1 codec, same-strategy scorer, structural verifier, and Rust tests without changing old writers.
3. Add HST generation and strict verification to Matrix. Prove the three old HGM files stay byte-identical.
4. Add HST retention to PSRO admission finalization and strict final verification. Prove all old HPS and expanded HGM files stay byte-identical and restart does not replay scientific work.
5. Add the dedicated one-kingdom Rust backfill command and the manifest-driven local 30-kingdom wrapper. Test fail-closed resume and deterministic reporting.
6. Extend the TypeScript adapter and fixtures to require and decode selected HST evidence after structural CRC and source-link checks, without invoking deep native verification.
7. Add the shared exact weighted-cell calculation. Change classification, archetype ranges, card headlines, and family headlines to use both equilibrium weights. Add singleton and semantic-parity tests.
8. Replace analysis/report/provenance v1 with v2. Move raw counts under `auditTelemetry`; delete misleading fields, v1 output paths, fixtures, and generated artifacts.
9. Update README and strategy-search docs. Archive plan 81 with the required replacement banner and index row.
10. Run focused and repository validation before touching completed evidence.
11. Run the local backfill command once for all 30 kingdoms. Compare the pre-existing-file hash manifest immediately and stop on any difference.
12. Run the structural adapter and selected-HST verification for all 30 kingdoms through report generation. Add the local telemetry execution to source provenance v2. Keep deep native verifier commands available for a separate deliberate audit, but do not run them in this workflow.
13. Generate v2 JSON and HTML twice without native replay and require byte identity. Inspect invariants and open the final HTML once in normal local Google Chrome.
14. Review the implementation against the recorded pre-implementation SHA before parent acceptance.

Every implementation step ends with its focused tests passing. Do not begin the next step after a byte-preservation or scientific-rule failure.

## Exact validation

Run these checks before completion:

1. `cd rust && cargo test && cargo fmt --check && cargo clippy --all-targets -- -D warnings`.
2. Native competitive and Goldfish conformance tests with the release binary present.
3. Focused Vitest for HST adapter corruption, weighting, classification, singleton equilibria, v2 golden JSON, provenance, backfill CLI, and HTML.
4. `npm run test:native` with the HST native fixture added.
5. `npm test`.
6. `npm run typecheck`.
7. `npm run lint`.
8. `npm run modal:test` to prove uncalled wrappers and image construction still work; do not deploy or call Modal.
9. `git diff --check`.
10. Compare the frozen pre-implementation fixture hashes for old Matrix and PSRO outputs.
11. Run the local 30-kingdom backfill command. Report elapsed time, same-strategy game count, scored and reused rows, bytes, and every output hash.
12. Compare the before/after SHA-256 manifest for every pre-existing HGF, HGM, HPL, HPA, HPC, and HPD file. Require exact equality.
13. For every manifest kingdom, require adapter checks for Goldfish/HGM structure and CRC, source identity, checkpoint completion, selected Matrix order, and selected HST structure, bounds, CRC, and source links. Require 30 of 30 without invoking a deep native verifier.
14. Run the production v2 report command twice without native replay. Require byte-identical JSON and HTML.
15. Inspect JSON invariants: 30 ordered kingdoms; finite values; exact stored weights; strategy and archetype range containment; both-weight sums; singleton fixture result; family-share sums; HST source links; audit-only raw fields; complete provenance coverage.
16. Search the repository and generated outputs for removed v1 field names, v1 output names, missing-diagonal prose, and uniform-opponent headline prose. Require no current reference.
17. Open `.html/strategy-search-30-rust-balance-v2.html` once in normal local Google Chrome after all validation passes.

No Goldfish, off-diagonal Matrix, PSRO, deployment, Modal, or paid run is part of validation.

## Stop conditions

Stop and report the blocker if:

- any pre-existing scientific evidence byte changes;
- implementation needs a change to the game kernel, Matrix payoff, fixed diagonal, solver, equilibrium witness, PSRO source identity, checkpoint, decision, seed, schedule, or admission format;
- a backfill path replays Goldfish, Matrix, PSRO screening, decisions, or races, or overwrites old evidence;
- same-strategy bytes differ by thread count, repeated run, or supported architecture;
- first- plus second-player totals are divided by 250 instead of 500;
- the weighted result differs from the two-weight formula or the strategy-report meaning;
- a singleton equilibrium reads any positive-weight off-diagonal telemetry;
- the selected HST source CRCs, Matrix order, generation, or checkpoint disagree;
- any of the exact 30 kingdoms is missing, duplicated, structurally incomplete, or fails CRC, source-link, checkpoint, Matrix-order, or HST verification;
- provenance would require inventing or replacing a historical execution fact;
- v2 JSON or HTML differs across two unchanged runs;
- validation requires replaying Goldfish, an off-diagonal Matrix pair, PSRO work, a deployment, or paid service.
