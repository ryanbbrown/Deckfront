# Health 50 and deep-beam removal

Status: implemented (commits `638f397`, `ea3859e`, `9f9c20d`, `3bad6d7`, `7b51af4`, `a3580ca`); this record anchors the implementation review.

## Scope

1. Starting health 40 to 50 for the playable game and the active suites: all 5 kingdoms in `src/game-data/kingdoms.json`, the random-kingdom default in `src/game/kingdom.ts`, the generated-kingdom value and its validation in `src/sim/balanceSuiteDesign.ts`, both regenerated balance manifests, and README prose.
2. Full deletion of the legacy deep-beam suite and every module, script, test, and fixture that existed only for it or for the pre-Rust experiment paths that imported it (43 files).
3. Readiness canary kingdom moved from `deep-beam-tuning-007` to `balance-tuning-001` in `modal/native_strategy_search.py`, its tests, and the operator docs; candidate count stays 12,972,960.
4. `rust/goldfish/kingdoms.json` regenerated: 160 kingdoms, all at 50 health. Both strategy-search allowlists updated; no missing paths.
5. Gate repairs that the rule change flipped: the Rust turn-count behavior fixture (38 to 46), two active `strategySearchPsroModal` identity tests, and regenerable balance-suite artifacts. Stale 40-health gameplay fixtures were deliberately not updated; fresh fixtures come after the rules settle (plan 91 deletes the stale ones).

## Identity consequences

Health is part of the rule fingerprint, so every fingerprint, the scientific digest, and every evidence ID changed. All pre-existing Modal balance evidence measured the 40-health game and is superseded. The frozen deep-beam suite was historical fixture data with no current consumer; the active pipeline uses `balance-tuning-*` kingdoms only.

## Validation (recorded)

`npm run verify:native` fully passed (31 Vitest, 37 Rust unit, 3 Matrix, 2 PSRO tests, fmt, clippy); `npm run modal:test` 106 passed; `npm run test:native` 31 passed; typecheck, lint, focused `strategySearchPsroModal` 15/15, and `git diff --check` passed. `npm test` carries 57 failures in 14 files, all stale 40-health gameplay fixtures scheduled for deletion in `.plans/91-simulation-legacy-cleanup.md`.
