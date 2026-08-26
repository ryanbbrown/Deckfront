# Response-oracle screening calibration

## Scope

Implement the approved screening calibration for the three saved P75 lotteries. Do not implement PSRO, response admission, closure confirmation, a tolerance decision, or automatic reference extensions to 200 or 400 seeds. Do not run the real calibration.

The command evaluates ordered-reservoir ranks 51–20,000. Ranks 1–50 are the restricted game and are not candidates.

## Frozen protocol

- Candidate count: 19,950 per kingdom.
- Search lanes: independent lanes A and B.
- Fixed-screen nested depths: 8, 16, 25, 32, and 50 seeds.
- Fixed-screen result: empirical maximum plus the complete top-score tie at each depth. A seeded stable-hash order names one response and the first four diagnostic candidates.
- Successive Halving cumulative depths: 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1,024, 2,048, 4,096, 8,192, and 16,384.
- Successive Halving retention: rank by cumulative mean and seeded stable-hash tie-break, then retain `ceil(n / 2)`. The two-candidate round selects one response. Save every active set, cumulative score, tie, and survivor set.
- Shared schedules: every candidate that is active at a seed index receives the same shuffle seed and sampled P75 opponent in that lane. Build schedules with `mixtureSchedule` from the complete positive P75 weight vector.
- Search reuse: fixed-screen scores supply each candidate's available Successive Halving prefix through 50 seeds. Only surviving candidates receive score-only top-ups after that prefix.
- Reference lane: one independent 100-seed schedule for all 19,950 candidates. Save a complete reusable artifact. Split scores into folds 1–50 and 51–100. Do not extend it automatically.
- One seed evaluation is two games, one for each first-player orientation.

The standalone Successive Halving cost is 169,165 candidate-seed evaluations and 338,330 games per lane. Reusing the fixed-screen prefix makes the combined fixed-plus-halving cost 1,091,212 candidate-seed evaluations and 2,182,424 games per lane. The 100-seed reference costs 1,995,000 candidate-seed evaluations and 3,990,000 games per kingdom.

## Seeds and ordering

Derive each unsigned 32-bit seed from the first eight hexadecimal characters of:

```text
stableHash(
  "response-oracle-calibration-v1:" +
  kingdomId + ":" + reservoirSha256 + ":" +
  p75ManifestHash + ":" + label + ":" + index
)
```

Use `search-a:game`, `search-a:opponent`, `search-b:game`, `search-b:opponent`, `reference:game`, and `reference:opponent`. Reject every collision across the complete seed plan. Use UTF-16 ordering and stable hashes for all deterministic ties. Do not use `raceCandidates`.

## Source and artifacts

Add `src/sim/responseOracleCalibration.ts` for protocol constants, source validation, seed and schedule creation, standard Successive Halving replay, artifact creation and deep validation, cross-fit metrics, exact accounting, and report creation.

Add `scripts/response_oracle_calibration.ts` for source loading, atomic 250-candidate chunks, strict resume, score-only evaluation, Successive Halving top-ups, reference evaluation, and report writing. Add an npm command.

Write under a caller-selected output root:

```text
manifest.json
search-a/chunk-NNN.json
search-a/successive-halving.json
search-b/chunk-NNN.json
search-b/successive-halving.json
reference/chunk-NNN.json
report.json
```

The manifest records the exact ranked, reservoir, and P75 source SHA-256 values; complete P75 strategies and weights, including tiny positive weights; candidate IDs, canonical strategies, and ranks; protocol; schedules; source paths; and its evidence hash.

Each search chunk contains exactly its rank-bounded candidate rows, canonical strategies, 50 fixed-screen scores, matches, candidate-seed count, measured wall time, schedule identity, manifest identity, and evidence hash. Each reference chunk contains the same identities and exactly 100 scores. Successive Halving evidence records every replayed round and top-up, cumulative means, complete top-score ties, deterministic order, survivors, selected top one and final four, exact candidate-seed and game counts, top-up wall time, and an evidence hash.

Write every artifact to a temporary file and rename it atomically. A valid existing artifact is reused. A missing artifact is generated. An invalid, stale, partial, unexpected, or corrupt artifact stops the command and is never replaced.

## Metrics

For each reference fold, choose its empirical leader and complete top-score tie on that fold. Score that leader on the opposite fold. Score every fixed-screen and Successive Halving top-one and top-four output on both opposite folds.

Report raw values only:

- reference-leader and oracle-response held-out scores;
- held-out regret, defined as reference-leader score minus oracle-response score;
- top-one and held-out best-of-four diagnostics;
- fixed-screen complete tie widths at 8, 16, 25, 32, and 50;
- A/B exact-ID agreement and held-out score differences;
- candidate-seed evaluations, games, measured wall time, and games saved against a standalone fixed 50-screen;
- goldfish rank as a diagnostic.

Do not apply `delta = 0.005`, recall labels, qualification, protocol selection, or any other user tolerance. The report states that calibration selection needs a separate user decision.

## Tests

Add `test/sim/responseOracleCalibration.test.ts` with small fixtures that prove:

- deterministic independent seed namespaces and shared per-lane schedules;
- exact fixed, standalone halving, reused-prefix, reference, and total costs;
- standard cumulative Successive Halving survivor counts, cumulative reranking, and stable tie handling;
- fixed-screen full ties and top-one/top-four output;
- two-fold reference leader selection, opposite-fold scoring, top-one regret, and best-of-four regret;
- exact source, schedule, candidate, rank, canonical strategy, score, match, wall-time, and evidence-hash validation;
- valid atomic resume evidence is reusable; corrupt or stale resume evidence is rejected.

## Documentation and verification

Update `README.md` with the command, artifact location, protocol boundary, and a warning that the command does not run PSRO, admit a response, choose a tolerance, or extend reference evidence.

Run:

```text
npx vitest run test/sim/responseOracleCalibration.test.ts test/sim/psroSearch.test.ts test/sim/orderedReservoirRaceBenchmark.test.ts
npm test
npm run typecheck
npm run lint
npm run build
git diff --check
git diff 308f1667308a8c74cc3c929f239c1244a612fe24 --
```

Do not edit `docs/strategy-search-process.md` or full-PSRO files. Commit the implementation only after all checks pass.
