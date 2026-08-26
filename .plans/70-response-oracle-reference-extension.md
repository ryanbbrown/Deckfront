# Response-oracle 200-seed reference extension

## Goal

Add a separate, user-invoked extension that evaluates reference seed ordinals 101–200 without changing existing calibration artifacts. For each kingdom, the extension must:

- reuse the saved candidates, search results, Successive Halving results, P75 lottery, and reference ordinals 1–100;
- evaluate all 19,950 candidates on only reference ordinals 101–200;
- build the full 200-seed opponent schedule, then use its second half;
- add exactly 1,995,000 candidate-seed evaluations and 3,990,000 games;
- compare two folds: ordinals 1–100 and ordinals 101–200;
- report raw metrics and exact accounting;
- not apply a tolerance, admit a response, test closure, rerun search, or start another extension.

Each kingdom writes to a sibling output root. The extension has no pooled schema, root report, or `--pool` mode. A parent process will read and pool the three per-kingdom reports without changing them.

## Output layout

```text
.experiments/response-oracle-calibration-200/
  deep-beam-tuning-001/
    manifest.json
    reference-101-200/
      chunk-000.json
      ...
      chunk-079.json
    report.json
```

The extension never writes under `.experiments/response-oracle-calibration/`.

## Files

- `src/sim/responseOracleCalibration.ts`: expose continuation seed derivation and add generic fold metrics while preserving the existing 50/50 wrapper.
- `src/sim/responseOracleReferenceExtension.ts`: define and validate extension manifests, chunks, reports, schedules, metrics, accounting, and Pareto diagnostics.
- `scripts/response_oracle_calibration.ts`: export a strict read-only loader for a complete original calibration bundle.
- `scripts/response_oracle_reference_extension.ts`: implement `--run`, `--status`, and `--report`.
- `test/sim/responseOracleCalibration.test.ts`: prove generic fold support leaves current results unchanged.
- `test/sim/responseOracleReferenceExtension.test.ts`: cover extension behavior and validation.
- `package.json`: add `response-oracle:extend-reference`.
- `README.md`: document commands, exact costs, layout, and scope limits.

Do not edit `docs/strategy-search-process.md`.

## 1. Strict original-bundle loader

Add `loadValidatedResponseOracleCalibration(root)`. Return the manifest, all search A and search B chunks, both complete Successive Halving artifacts, all original reference chunks, and the report only after all checks pass.

The loader must:

1. reject every unexpected file under the original root;
2. validate the manifest and evidence hash;
3. hash the ranked, reservoir, P75 manifest, and P75 report sources and compare them with the manifest;
4. validate the P75 manifest evidence hash;
5. validate all 80 search A chunks and all 80 search B chunks;
6. validate both complete Successive Halving artifacts;
7. validate all 80 original reference chunks;
8. rebuild and exactly validate the original report.

The extension must not call the current run, chunk-fill, or halving paths.

## 2. Continuation seeds and schedule

Use version `response-oracle-reference-extension-200-v1`.

Derive game seeds with the current calibration formula and `reference:game` label. Use zero-based indexes 100–199 for ordinals 101–200. Build a 200-seed list from original indexes 0–99 and continuation indexes 100–199. Call `mixtureSchedule` once with all 200 seeds and the original reference opponent-sampling seed.

Require blocks 0–99 to equal the saved original reference schedule. Use blocks 100–199 as the extension schedule. Require new game seeds to be unique and not collide with original search A, search B, reference, or opponent-sampling seeds.

## 3. Extension manifest

The versioned manifest records:

- original root, kingdom, calibration version, manifest hash, report hash, and report source hashes;
- fixed rank range 51–20,000 and count 19,950;
- original ordinals 1–100, extension ordinals 101–200, and the two 100-seed folds;
- chunk size 250, two games per seed evaluation, and the saved simulation limits;
- false values for search reruns, admissions, closure, tolerance, and automatic further extension;
- continuation indexes 100–199, game seeds, and the original opponent-sampling seed;
- hashes of the original and combined schedules;
- the exact 100-block extension schedule;
- an evidence hash.

Validation rebuilds every deterministic field from the validated original bundle and requires exact equality. Reject an output root equal to or inside the base root. The manifest must not copy search result rows.

## 4. Atomic extension chunks

Write 80 chunks under `reference-101-200/` with the original rank bounds. Chunks 0–78 contain 250 candidates. Chunk 79 contains ranks 19,801–20,000 and 200 candidates.

Each row records the exact original rank, strategy ID, canonical strategy, 100 block scores, 100 candidate-seed evaluations, and 200 games. Scores must be finite and between 0 and 1.

A full chunk has 25,000 candidate-seed evaluations and 50,000 games. The final chunk has 20,000 evaluations and 40,000 games. All chunks total 1,995,000 evaluations and 3,990,000 games.

Write to `chunk-NNN.json.tmp-PID`, then rename. Validate and reuse an existing destination. Never replace stale or invalid evidence. The output allowlist contains only `manifest.json`, `report.json`, and the 80 expected chunks. Reject unexpected files, including temporary files, for run, status, and report.

## 5. Simulation boundary

The run path must:

1. validate the complete original bundle;
2. validate or create the extension manifest;
3. load candidates from the pinned reservoir source;
4. compare every candidate identity and canonical strategy with the original manifest;
5. create one worker pairing runner;
6. evaluate only missing extension chunks against the extension schedule and original P75 strategy map;
7. use the original kingdom and saved simulation settings;
8. assert 100 schedule blocks, 200 matches per candidate, and ranks 51–20,000;
9. close the runner before report generation.

No reachable run function accepts a search lane or Successive Halving depth.

## 6. Fold metrics

Add `crossFitCalibrationMetricsForFolds` with explicit half-open fold ranges. Keep `crossFitCalibrationMetrics` as a wrapper over `[0, 50)` and `[50, 100)` so existing reports remain byte-for-byte identical.

For the extension, concatenate each original 100-score row with its extension 100-score row. Use fold 1 indexes 0–99 and fold 2 indexes 100–199. On each fold, select the empirical reference leader, preserve the full top-score tie, order ties with the original opponent-sampling seed, and score the selected leader on the opposite fold. Score each unchanged method top one and top four on that same held-out fold. Recalculate A/B score differences on each 100-seed fold.

Report raw regret as reference held-out score minus response held-out score. Use ordinary sorted medians, maximum regret, and minimum response score. Do not attach acceptance or closure labels.

## 7. Per-kingdom report

The versioned report contains:

- extension and base hashes;
- status `raw-metrics-require-user-tolerance`;
- false values for search reruns, admissions, closure, and tolerance;
- the original validated method outputs unchanged;
- reference leaders, cross-fit metrics, and lane-agreement diagnostics for the two 100-seed folds;
- per-method raw worst and median top-one regret, top-four regret, top-one score, and top-four score;
- deterministic top-one, top-four, and joint Pareto diagnostics based on games per lane and raw regret;
- original reference, extension reference, combined reference, and added-game accounting;
- source artifact hashes and an evidence hash.

A method dominates another measure when it uses no more games, has no worse regret, and at least one comparison is strict. Joint domination also requires no worse top-one and top-four regret.

The extension reference accounting is 1,995,000 candidate-seed evaluations and 3,990,000 games. Combined reference accounting is 3,990,000 evaluations and 7,980,000 games. `addedGames` is exactly 3,990,000.

## 8. CLI

Add:

```json
"response-oracle:extend-reference": "tsx scripts/response_oracle_reference_extension.ts"
```

Support exactly one of:

```sh
npm run response-oracle:extend-reference -- --run --base ORIGINAL_ROOT --out EXTENSION_ROOT --workers 4
npm run response-oracle:extend-reference -- --status --base ORIGINAL_ROOT --out EXTENSION_ROOT
npm run response-oracle:extend-reference -- --report --base ORIGINAL_ROOT --out EXTENSION_ROOT
```

Reject unknown flags. Allow `--workers` only with `--run`. Require distinct roots and reject an output root inside the base root. Status and report must not create a runner. Report may atomically create only the derived report after all source evidence is complete and valid.

## 9. Tests

Add focused tests for:

- deterministic indexes 100–199 and unchanged indexes 0–99;
- the exact saved 100-block prefix and exact second half of the 200-block schedule;
- seed collision rejection and rejection of restarted second-half opponent sampling;
- exact manifest construction and rejection after any source, protocol, seed, schedule, fold, or base-report change;
- first and final chunk bounds, exact row and total costs, resume reuse, corruption rejection, and output allowlisting;
- different leaders in the original and extension folds, opposite-fold scoring, best-of-four regret, and lane differences;
- unchanged current 50/50 wrapper output;
- deterministic Pareto domination and ordering;
- unchanged report outputs, exact accounting, no tolerance or acceptance decision, and false scope flags;
- status and report paths that never create a runner.

## 10. Verification

Do not run real games. Run:

```sh
npx vitest run \
  test/sim/responseOracleCalibration.test.ts \
  test/sim/responseOracleReferenceExtension.test.ts \
  test/sim/psroSearch.test.ts \
  test/sim/orderedReservoirRaceBenchmark.test.ts
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
```

Inspect the complete diff against frozen SHA `e2788c18a9cebdfb0b84f0ee6751ddc053cab7c3`. Confirm existing tracked artifacts are byte-for-byte unchanged. Commit the plan before implementation, then commit the implementation.
