> Archived: equilibrium-weighted self-play telemetry and report rules replaced by `.plans/82-equilibrium-weighted-self-play-telemetry.md`.

# Rust strategy-search balance analysis

Status: proposed. Implementation needs parent approval.

This plan adds one read-only TypeScript adapter for the completed Rust Goldfish, Matrix, and policy-space response oracle (PSRO) evidence in `.data/strategy-search-30`. It then builds one deterministic JSON analysis and one committed HTML report. It does not change game rules, search rules, classification rules, equilibrium selection, or stored scientific evidence.

## Goal

Use the verified 30-kingdom Rust evidence to answer balance questions without converting it to the legacy JSON `ArtifactSet`, `MatrixSnapshot`, or `TelemetryAggregate` shapes.

The report must show:

- the final stored Rust strategy mix for every kingdom;
- selected archetype shares and the minimum and maximum share over the full equilibrium set;
- every final matrix strategy definition;
- off-diagonal card purchases per player-game;
- family damage per player-game and damage share;
- paired-game score evidence without claiming exact wins, draws, or losses;
- support size and effective size;
- card offering and acquisition-usage summaries across all 30 kingdoms;
- deterministic outlier lists;
- source file, execution-report, Git, and release-binary hashes;
- explicit flags for missing diagonal self-play and the ambiguous paired point byte `2`.

## Fixed interpretation rules

These rules come from `docs/strategy-search-evidence.md`, plans 77 through 79, and the read-only evidence audit.

- Call `readGoldfishReservoir(reservoir, kingdomId, { top })` to validate the HGF source link and reconstruct each `gf-<strategyNumber>` strategy. Do not add another strategy-number decoder.
- Call `classifyStrategyDamage` from `src/sim/strategyDamage.ts`. Ordered strategies have an empty starting build, so classification uses recorded off-diagonal acquisition rates. A family-presence check on the buy plan is not an archetype classifier.
- Call `equilibriumGroupWeightRange` with centered payoff `(percentage - 50) / 50` and game value `0`. Calculate a range for each fixed archetype partition. Do not reclassify a strategy inside an LP.
- Preserve the weights stored by Rust in the selected final `matrix.hgm`. These weights are the selected witness. TypeScript can validate the witness but must not call `solveEquilibrium` and replace it.
- Matrix purchase and family-damage rows are off-diagonal only. Each strategy/opponent row covers `125 shuffles × 2 games = 250 player-games` for that strategy.
- The first 75 pair bytes define the matrix percentage. All 125 bytes are available as paired-game score evidence.
- One pair byte is the first strategy's points over two seat-swapped games. Values `0` and `4` are unambiguous double losses and double wins. Value `2` can be one win plus one loss or two draws. The report must call this a paired-game score, not a win rate.
- Weight the 30 kingdoms equally in cross-kingdom summaries. Apply the stored selected strategy weights only inside each kingdom.
- Call the scope the `balance-smoke-v1` 30-kingdom tuning set. Do not describe it as final proof of global card balance.

## Evidence limits

The JSON and HTML must show these flags at the top and on every kingdom:

```ts
interface RustBalanceEvidenceLimits {
  diagonalSelfPlay: {
    available: false;
    matrixPayoff: 'fixed-50-percent';
    purchases: 'absent';
    familyDamage: 'absent';
  };
  pairedPointByteTwo: {
    exactWinDrawLossAvailable: false;
    meaning: 'one-win-one-loss-or-two-draws';
  };
  exactFirstPlayerWinRateAvailable: false;
  cardPlayCountsAvailable: false;
  perCardDamageAvailable: false;
  turnsToWinAvailable: false;
}
```

The report must not calculate selected-lottery-versus-itself card acquisition or family damage. It may calculate a clearly named `selectedStrategyUniformOffDiagonalOpponent` measure: select the row strategy with the stored witness, then weight that strategy's telemetry equally over every other final matrix strategy. This is a descriptive off-diagonal measure, not equilibrium self-play.

In card tables, `usage` means observed acquisition copies. The report must use the labels `acquisition usage`, `purchase copies`, and `copies per player-game`. It must not imply that HGM stores card-play counts.

## Inputs and outputs

The command is:

```text
npm run strategy-search:rust-balance-report -- \
  --root .data/strategy-search-30 \
  --binary rust/target/release/hexdeck-goldfish \
  --provenance .data/strategy-search-30/source-provenance-v1.json
```

Defaults and exact outputs:

```text
.data/strategy-search-30/source-provenance-v1.json       required input metadata
.data/strategy-search-30/rust-balance-analysis-v1.json   deterministic JSON output
.html/strategy-search-30-rust-balance-v1.html            standalone committed HTML output
```

The script may accept `--json` and `--html` overrides for tests. Production generation uses the exact default paths. It creates parent directories, writes temporary files, and renames JSON before HTML. A failure leaves existing final outputs unchanged.

The command reads evidence in place and never copies the HGF, HGM, or HPS trees. Before verification, use `fs.statfsSync` to print available disk space and the source-tree size. Print progress and available space after every five kingdoms. After JSON and HTML are built in memory, require enough free space for both temporary outputs, both replacements, and a 64 MiB safety margin before writing either file. This is the analysis disk preflight; it does not manage or resume the separate Matrix or PSRO batch.

The report does not include a generation timestamp, absolute path, elapsed analysis time, host name, or thread count. Paths in JSON are repository-relative POSIX paths. Arrays and object keys use the fixed orders in this plan. JSON uses two-space indentation and one final newline. The HTML embeds the exact JSON artifact so the committed report is standalone.

### Provenance input

`source-provenance-v1.json` supplies source facts that HGF headers do not contain:

```ts
interface RustStrategySearchSourceProvenanceV1 {
  schemaVersion: 1;
  protocol: 'rust-strategy-search-source-provenance-v1';
  kingdomIds: string[];
  scientificImplementationCommits: {
    goldfish: string;
    matrix: string;
    psro: string;
  };
  currentReleaseBinaries: {
    matrixSha256: string;
    psroSha256: string;
  };
  executions: Array<{
    ordinal: number;
    stage: 'goldfish' | 'matrix' | 'psro';
    coveredKingdomIds: string[];
    gitCommit?: string;
    sourceDigest?: string;
    deploymentDigest?: string;
    report: { path: string; sha256: string };
    binarySha256?: string;
    binarySha256UnavailableReason?: string;
  }>;
}
```

The three `scientificImplementationCommits` identify the reviewed code that defines each scientific protocol. They do not claim that one build executed every kingdom. The ordered `executions` list records the actual local and Modal execution groups, including local Kingdom 005 and each pinned Goldfish operational commit or deployment. For each execution, require at least one of `gitCommit`, `sourceDigest`, or `deploymentDigest`; preserve every available field; verify the report hash; and require exactly one of `binarySha256` or a nonempty `binarySha256UnavailableReason`. A missing historical Modal worker-binary hash is valid only when its execution gives the explicit unavailable reason. Do not create a fictional shared Goldfish commit or binary.

Require full 40-character lowercase Git hashes and 64-character lowercase SHA-256 hashes where those fields are present. Require the ordered execution coverage for each stage to assign every smoke kingdom exactly once, with no duplicate or unknown kingdom. Require `kingdomIds` to equal the validated smoke list in its recorded order. Require binary hashes for the current Matrix and PSRO executions and require them to equal `currentReleaseBinaries`; these current hashes are available. Do not infer an execution build from the analysis checkout or substitute a scientific implementation commit for an execution fact.

The analysis JSON records the computed SHA-256 of the provenance file, every known execution fact, every explicit unavailable reason, and the computed SHA-256 of the verifier binary. Validation preserves known facts and fails on contradictions between provenance, execution reports, consolidated manifests, evidence coverage, and the verifier binary. It does not fail only because a historical Goldfish binary hash was never preserved.

The campaign owner must prepare this small file from the preserved receipts. The report generator does not invent missing provenance. Missing current Matrix/PSRO hashes or conflicting provenance is a hard error.

## Files to add or change

### `src/sim/rustStrategySearchEvidence.ts`

Add the dedicated native-evidence adapter. It owns native verification, HGM and final-checkpoint decoding, structural checks, source hashing, and final-HGM selection.

Public interfaces:

```ts
export interface RustStrategySearchKingdomPaths {
  kingdomId: string;
  topFile: string;
  reservoirFile: string;
  initialMatrixDir: string;
  psroDir: string;
}

export interface LoadRustStrategySearchEvidenceOptions {
  binary: string;
  runNativeCommand?: (binary: string, args: readonly string[]) => NativeCommandResult;
}

export interface RustStrategySearchKingdomEvidence {
  kingdomId: string;
  goldfish: ReturnType<typeof readGoldfishReservoir>;
  completion: {
    complete: true;
    searchCount: number;
    admissionCount: number;
    matrixGeneration: number;
    cleanSearchCount: 2;
    finalStrategyNumbers: number[];
    finalWeights: number[];
  };
  finalMatrixSource: 'initial-matrix' | 'psro-expanded-matrix';
  pairs: RustPairEvidence[];
  purchases: RustPurchaseEvidence[];
  matrix: RustMatrixEvidence;
  sourceFiles: RustSourceFileHash[];
  nativeVerification: NativeVerificationSummary;
}

export function loadRustStrategySearchKingdomEvidence(
  paths: RustStrategySearchKingdomPaths,
  options: LoadRustStrategySearchEvidenceOptions
): RustStrategySearchKingdomEvidence;
```

The production caller uses fixed paths for each smoke kingdom:

```text
<root>/<kingdom>/goldfish/top-500000.hgf
<root>/<kingdom>/goldfish/reservoir.hgf
<root>/<kingdom>/matrix/{pairs.hgm,purchases.hgm,matrix.hgm}
<root>/<kingdom>/psro/{checkpoint.hpc,decisions.hpd,...}
```

Run these commands in this order before TypeScript decodes any scientific file:

```text
hexdeck-goldfish verify --kingdom K --kind top --file TOP
hexdeck-goldfish verify --kingdom K --kind reservoir --file RESERVOIR --top TOP
hexdeck-goldfish matrix-verify --kingdom K --reservoir RESERVOIR --out INITIAL_MATRIX_DIR
hexdeck-goldfish psro-verify --kingdom K --top-file TOP --reservoir RESERVOIR --matrix-dir INITIAL_MATRIX_DIR --out PSRO_DIR
```

A nonzero exit, signal, malformed success JSON, or kingdom mismatch stops the whole report before output generation. Capture bounded stderr for the error. Do not add a `--top`, `--matrix-size`, or `--candidate-limit` production relaxation.

After native success, decode enough of `checkpoint.hpc` and `decisions.hpd` to require complete status, stop reason `two clean searches`, final clean count 2, consistent search and admission counts, final matrix generation, final strategy-number order, and stored final weights. The adapter is not a second PSRO transition verifier.

Final HGM selection is exact:

- when `admissionCount === 0`, use the three files in `initialMatrixDir` and require no PSRO-expanded HGM set;
- when `admissionCount > 0`, use the three files in `psroDir`, require all three, and require the checkpoint matrix generation and strategy-number/weight entries to match `matrix.hgm` exactly, including each stored `f64` bit.

Decode HGM with the plan-78 formats and the final strategy count `N`:

- kind 5 `pairs.hgm`: `N(N-1)/2` rows of two strategy numbers and 125 point bytes;
- kind 6 `purchases.hgm`: `N(N-1)` rows of strategy number, opponent number, one `u32` per kingdom card, then treasure, mana, melee, ranged, and engine damage totals;
- kind 7 `matrix.hgm`: `N` rows of strategy number, `N` percentages, and one stored weight.

Reuse card and kingdom definitions from `src/game` and `BALANCE_SUITE_MANIFEST`. Do not copy card order or family metadata into another source file.

### `src/sim/rustStrategySearchBalance.ts`

Add pure analysis and JSON types. This module does not read files, run commands, render HTML, or solve a selected equilibrium.

Public interfaces:

```ts
export const RUST_BALANCE_ANALYSIS_SCHEMA_VERSION = 1;
export const RUST_BALANCE_ANALYSIS_PROTOCOL = 'rust-strategy-search-balance-v1';

export interface RustBalanceAnalysisV1 {
  schemaVersion: 1;
  protocol: 'rust-strategy-search-balance-v1';
  scope: RustBalanceScope;
  evidenceLimits: RustBalanceEvidenceLimits;
  provenance: RustBalanceProvenance;
  kingdoms: RustKingdomBalanceAnalysis[];
  crossKingdom: RustCrossKingdomBalanceAnalysis;
  outliers: RustBalanceOutliers;
}

export function buildRustBalanceAnalysis(
  evidence: readonly RustStrategySearchKingdomEvidence[],
  provenance: RustStrategySearchSourceProvenanceV1
): RustBalanceAnalysisV1;

export function stringifyRustBalanceAnalysis(analysis: RustBalanceAnalysisV1): string;
```

### `scripts/generate_rust_strategy_search_balance_report.ts`

Add the CLI, fixed 30-kingdom path assembly, provenance validation, fail-closed output writes, and standalone HTML renderer.

Export these functions for tests:

```ts
export function loadRustBalanceReportInputs(options: CliOptions): RustBalanceAnalysisV1;
export function renderRustBalanceReport(analysis: RustBalanceAnalysisV1): string;
export function generateRustBalanceReport(options: CliOptions): RustBalanceAnalysisV1;
```

Escape all source text before inserting it into HTML. Do not fetch scripts, fonts, styles, or data from a network. Use CSS, semantic tables, `<details>` for large matrices and strategy definitions, print styles, sticky table headings, and horizontal overflow for wide tables.

### Other files

- `test/sim/rustStrategySearchEvidence.test.ts`: adapter, verifier gate, final-HGM selection, and binary corruption tests.
- `test/sim/rustStrategySearchBalance.test.ts`: calculations, ranges, deterministic golden, outliers, and HTML tests.
- `test/fixtures/rust-strategy-search-balance/`: small HGF/HGM/HPS fixtures and the expected two-kingdom `rust-balance-analysis-v1.json` golden. Generate fixture bytes from one test helper, then require byte equality with the committed fixtures.
- `package.json`: add `strategy-search:rust-balance-report` and include the native adapter fixture case in `test:native` if it needs the built Rust binary.
- `README.md`: document the report command, exact outputs, native-verification gate, and evidence limits.
- `docs/strategy-search-process.md`: correct step 2 to say 1,225 off-diagonal pairs for 50 strategies and a fixed 50% diagonal. This is a factual correction to the current Rust process, not a scientific-rule change.
- `.html/strategy-search-30-rust-balance-v1.html`: generate from all 30 completed kingdoms and commit it after validation.

Do not modify `scripts/generate_balance_report.ts`, `scripts/generate_strategy_report.ts`, the legacy artifact schemas, Rust scientific code, kingdom definitions, card definitions, or any HGF/HGM/HPS file.

## Adapter validation

Native verification is authoritative for scientific replay. The TypeScript adapter still fails on unsafe or inconsistent binary input before analysis.

For all inputs:

- require regular files under the selected root, reject symlinks and `.tmp` files, and record relative paths, byte counts, SHA-256 hashes, and row CRC-32 values where present;
- require exactly the 30 unique IDs from `balance-smoke-suite-manifest.json`, in manifest order;
- require each ID and card order to resolve through the validated balance-suite and native kingdom definitions;
- hash every consumed HGF, HGM, HPS checkpoint/decision/look/admission file and every listed execution report;
- build `evidenceSetSha256` from the canonical ordered list of relative path, byte count, and SHA-256 triples.

For HGM:

- require magic `HGR1`, kinds 5 through 7, 64-byte headers, little-endian values, exact file lengths, expected row sizes/counts, seed range `4,200,001..4,200,125`, rule fingerprint, source reservoir CRC, and row CRC;
- require complete upper-triangle pair order and exact A-then-B purchase-row order;
- require every point byte in `0..=4`;
- require every strategy number to be unique in matrix order, to occur in the verified reservoir, and to resolve to the same `gf-<number>` strategy;
- require every purchase vector length to equal the kingdom card order;
- require matrix percentages to be finite and in `0..100`, diagonal exactly `50`, opposite cells to total `100` within `1e-9`, and each off-diagonal cell to equal the first-75 pair-byte total divided by `3`;
- require stored weights to be finite, nonnegative within `1e-9`, sum to 1 within `1e-9`, and satisfy the zero-value equilibrium constraints within the existing project tolerance;
- compare HGM weights with final checkpoint weights by strategy number and `f64` bits. Never normalize, clamp, or rewrite them.

For calculated analysis:

- require all final matrix strategies to receive exactly one classifier label;
- require every selected archetype share and strategy weight to be inside its feasible range within `1e-7`;
- require archetype selected shares to sum to 1;
- require all purchase and damage denominators to be positive and derived from recorded rows;
- require every 30-kingdom aggregate to have an equal `1/30` kingdom contribution;
- reject `NaN`, infinity, negative count data, duplicate object keys after normalization, and nondeterministic input ordering.

## JSON contents and calculations

### Scope and provenance

Record:

- suite ID, source suite ID, the exact 30 kingdom IDs, kingdom count, payoff seed count 75, telemetry seed count 125, games per pair 250, pair policy `off-diagonal-upper-triangle`, and equal kingdom weighting;
- evidence bases named exactly as `off-diagonal-full-matrix-acquisitions`, `played-card-family-damage`, and `paired-game-score-only`;
- scientific implementation commits, ordered per-execution build and deployment facts, explicit historical binary-hash unavailable reasons, current Matrix/PSRO binary hashes, verifier binary hash, execution-report hashes, manifest hashes, every consumed source file hash, and one canonical evidence-set hash per kingdom.

### Per kingdom

Record these sections in smoke-manifest order:

1. `kingdom`: ID, name, starting health, and offered cards in kingdom order. Each card has ID, name, cost, family, and mechanic from `cardDefinition`.
2. `completion`: native verification status, searches, admissions, matrix generation, two clean searches, final matrix source, and final strategy count.
3. `equilibrium`: stored selected witness, support size, effective size, score against the selected witness, and ranges.
4. `strategies`: every final matrix strategy in matrix order. Include strategy number, `gf-` ID, Goldfish rank, selected weight, support membership, selected-lottery score from the 75-seed matrix, singleton feasible weight range, classifier label, five buy steps with card IDs and desired counts, empty starting build, off-diagonal opponent count, player-game count, purchases by card, and family damage.
5. `archetypes`: one row for every classifier label present in that kingdom. Include strategy IDs, selected share, minimum feasible share, maximum feasible share, and range width.
6. `pairedScoreEvidence`: the complete 75-seed percentage matrix, all 125 pair means, byte counts for `0..4`, and ranked most-skewed pairs. Keep strategy numbers on every matrix and pair row.
7. `cards`: every offered card, including zero-purchase cards. Include total off-diagonal copies, copies per player-game, strategies with a positive purchase count, selected-strategy/uniform-off-diagonal-opponent copies per player-game, and its evidence-basis label.
8. `familyDamage`: treasure, mana, melee, ranged, and engine in that order. Include total actual damage, damage per player-game, share of recorded family damage, and selected-strategy/uniform-off-diagonal-opponent values.
9. `evidenceLimits` and `sourceFiles`.

Definitions:

```text
support member = stored weight > SUPPORT_TOLERANCE
support size = count of support members
effective size = 1 / sum(stored weight²)
strategy off-diagonal player-games = (N - 1) × 250
strategy copies/player-game = sum of its N - 1 purchase rows / strategy player-games
selected-lottery score = sum_j storedWeight[j] × matrixPercent[i][j]
all-125 pair percent = sum(point bytes) / (125 × 4) × 100
selected-strategy/uniform-opponent telemetry = sum_i storedWeight[i] × mean telemetry of i over j != i
```

Call `equilibriumGroupWeightRange` for every archetype and every singleton strategy. Empty archetype groups, if needed for cross-kingdom alignment, have selected/minimum/maximum `0` without an LP call.

### Cross-kingdom summary

Record:

- equal-kingdom selected archetype shares and equal-kingdom means of each minimum and maximum endpoint;
- for each archetype, kingdom counts with positive selected share above `SUPPORT_TOLERANCE`, material selected share at or above 20%, and positive feasible maximum above `SUPPORT_TOLERANCE`;
- support-size and effective-size distributions with minimum, median, mean, maximum, and all 30 kingdom values;
- every card in stable card-ID order with offered kingdom count, kingdoms with positive acquisition usage, total recorded copies and player-games, copies per player-game, equal-offering-kingdom mean copies per player-game, and equal-kingdom selected-strategy/uniform-opponent copies per player-game;
- all five family damage totals, shares, damage per player-game, equal-kingdom mean shares, and selected-strategy/uniform-opponent values;
- paired byte counts `0..4`, the point-byte-2 share, first-75 and all-125 skew summaries, and no W/D/L fields.

For a card that is not offered in a kingdom, exclude that kingdom from offering-conditioned means. For an offered card with zero copies, include zero. Do not divide total copies by only positive-use kingdoms.

### Outliers

Use deterministic ranked review queues, not an unstated statistical threshold. Store the top 10 entries for each metric, or all entries when fewer than 10 exist:

- pair score farthest from 50% over all 125 seeds;
- first-75 pair score farthest from 50%;
- kingdom archetype range width;
- lowest and highest equilibrium effective size;
- highest point-byte-2 share;
- highest card copies per player-game among offered cards;
- highest family damage per player-game;
- largest difference between selected-strategy/uniform-opponent telemetry and unweighted full-matrix telemetry.

Sort descending by absolute metric, then kingdom ID, strategy number, opponent number, card ID, and family as applicable. Include the metric definition and evidence basis with every queue. The HTML calls these `Outliers to inspect`, not defects.

## HTML report

The standalone report uses the JSON as its only data source and contains:

1. title, 30-kingdom scope, source hashes, and native-verification status;
2. a prominent evidence-limit panel for missing diagonal self-play and ambiguous point byte `2`;
3. final selected archetype shares with full feasible bands across kingdoms;
4. support-size and effective-size charts and tables;
5. card offering and acquisition-usage cross-kingdom tables, with zero-use offered cards visible;
6. family-damage totals, shares, and per-player-game tables;
7. paired-game score distributions and skewed-pair tables with no exact W/D/L language;
8. deterministic outlier review queues;
9. one kingdom section each, with selected mix, archetype ranges, strategy definitions, card purchases, family damage, score evidence, and source hashes;
10. collapsible complete 75-seed matrices and complete final strategy tables so the HTML stays readable.

Use text and tables as the source of truth. Small inline SVG bars may improve scanning, but the report must remain useful with CSS disabled and must not use a chart dependency.

## Tests

### Admission and HGM selection

- A complete PSRO fixture with zero admissions selects the initial Matrix HGM files and preserves their stored weights.
- A complete fixture with one admission selects the expanded PSRO HGM files and preserves the checkpoint/HGM `f64` weight bits.
- Zero admissions with only a partial PSRO HGM set fails instead of silently selecting it.
- One or more admissions with a missing or stale expanded file fails.

### Native binary gate

- A fake executable records the exact four command vectors and proves native commands finish before the first adapter read.
- A nonzero `verify`, `matrix-verify`, or `psro-verify` result stops later commands and creates no JSON or HTML.
- Malformed verifier JSON, wrong kingdom output, signal termination, and a verifier-binary hash mismatch fail.
- Under `test:native`, the real release binary verifies the committed small fixture before the adapter reads it.

### Binary and corrupt-data validation

- Valid HGM headers and rows decode to the expected numbers, card order, score bytes, purchase copies, damage, percentages, and weights.
- Reject a bad magic, kind, row size, count, file length, CRC, source CRC, seed range, fingerprint, pair order, purchase-row order, strategy number, point byte `5`, card-order mismatch, matrix percentage, diagonal, complement, stored weight, checkpoint mismatch, trailing byte, symlink, and `.tmp` file.
- Point byte `2` remains one ambiguous bucket and never creates win or draw counts.
- A singleton equilibrium fixture keeps diagonal telemetry missing and does not divide by zero or invent self-play.

### Equilibrium and analysis

- Unique and degenerate toy matrices produce expected selected archetype shares and full feasible ranges.
- A mixed archetype fixture pins the existing 20% classifier threshold and Improvise rule.
- Selected witness weights remain byte-identical before and after analysis.
- Support size and inverse-Simpson effective size use the stored witness.
- Purchase and family-damage denominators equal recorded off-diagonal player-games.
- Equal-kingdom aggregation differs from pooling when fixture kingdom sizes differ.
- Offered-but-unused cards remain in card summaries with zero usage.

### Determinism, golden, and HTML

- A two-kingdom fixture matches the committed `rust-balance-analysis-v1.json` byte for byte.
- Reversed filesystem enumeration and different absolute roots produce identical JSON and HTML.
- HTML generation includes all required sections, escapes card and kingdom text, contains both evidence-limit warnings, contains no `win rate`, `draw rate`, or exact W/D/L field, and embeds JSON that parses back to the golden artifact.
- Default CLI paths are exact, disk preflight uses the serialized output sizes plus the safety margin, writes are atomic, and a generation failure leaves prior outputs unchanged.

## Validation before completion

No simulation, Matrix run, PSRO run, deployment, paid service, or scientific evidence rewrite is needed.

Run:

1. focused Vitest tests for the adapter, analysis, ranges, golden JSON, and HTML;
2. `npm run test:native` with the release binary present;
3. `npm test`;
4. `npm run typecheck`;
5. `npm run lint`;
6. `git diff --check`;
7. all four native verification commands for each of the 30 completed kingdoms;
8. the production report command once against `.data/strategy-search-30`; record source size and free disk before and after without copying evidence;
9. the production command a second time and require byte-identical JSON and HTML;
10. inspect the JSON for 30 kingdoms, finite values, weight/range invariants, and both missing-evidence flags;
11. open the final committed HTML in normal local Google Chrome once, after final validation.

Do not rerun Goldfish, Matrix, or PSRO to validate the reporter. If native verification fails, stop and report the kingdom and command. Do not repair or replace evidence in this task.

## Implementation order

1. Freeze the implementation base after the completed 30-kingdom evidence and parent approval. Record the pre-implementation SHA.
2. Add the provenance schema and native-verification gate. Prove fail-fast command order with tests.
3. Add checkpoint/decision and HGM codecs, no-admission/admission HGM selection, structural checks, source hashes, and corrupt-data tests.
4. Add pure per-kingdom analysis: strategy reconstruction, definitions, selected witness validation, off-diagonal purchases, family damage, paired scores, support/effective sizes, classifier labels, and equilibrium ranges.
5. Add equal-kingdom card, family, archetype, score, distribution, and outlier summaries. Pin the two-kingdom golden JSON.
6. Add deterministic JSON serialization, atomic CLI writes, package command, and standalone HTML renderer with tests.
7. Update README and correct the diagonal sentence in `docs/strategy-search-process.md`.
8. Run focused and repository validation. Fix only adapter, analysis, report, test, or documentation defects; do not change scientific rules or Rust evidence.
9. Verify all 30 production evidence sets, generate both artifacts twice, compare bytes, inspect the report, and commit the useful HTML.
10. Review implementation against the pre-implementation SHA before parent acceptance.

## Stop conditions

Stop and ask the parent if:

- fewer or more than the exact 30 smoke kingdoms are present;
- source provenance or an execution report is missing or contradictory, except for a historical Goldfish binary hash with an explicit unavailable reason;
- any native verifier fails;
- checkpoint, decisions, or selected HGM disagree on admission count, strategy order, generation, or stored weights;
- classification would need a rule other than `classifyStrategyDamage`;
- an exact W/D/L, first-player, card-play, per-card-damage, turn, or diagonal-telemetry claim is requested;
- an analysis requires replaying games or changing Rust, kingdom, card, Matrix, PSRO, or equilibrium rules;
- JSON or HTML bytes differ across two runs with unchanged inputs.
