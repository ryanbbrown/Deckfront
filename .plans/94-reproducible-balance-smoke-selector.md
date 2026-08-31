# Reproducible balance-smoke selector

## Purpose

Reproduce the recorded 30-kingdom smoke suite from the committed 160-kingdom manifest. Keep `src/sim/balance-smoke-suite-manifest.json` as the only smoke-suite data artifact.

This work does not change card balance, run strategy search campaigns, deploy code, or spend money.

## Selection

Search only the 128 tuning kingdoms for exactly 30 rows. Require:

- 6 to 11 appearances for every variable card;
- every priority pair at least once;
- every required triple at least once;
- every route label at least once.

Use YALPS 0.6.4 to find a binary feasible seed. Minimize the sum of the selected kingdoms' one-based source indexes. Use 100,000 iterations, tolerance 0.01, and no wall-clock timeout.

From that seed, test every selected-to-unselected one-row exchange in source order. Compare feasible results in this order:

1. more covered broad pairs;
2. more covered broad triples;
3. lower maximum card exposure;
4. lower sum of squared card exposures;
5. lower sum of squared pair exposures.

Take the first best strict improvement and repeat. This gives a deterministic one-exchange local optimum, not proof of the global optimum.

## Interface

- `src/sim/balanceSmokeSuiteSearch.ts` contains the search.
- `scripts/search_balance_smoke_suite.ts` prints the reproduced IDs.
- `npm run balance:smoke:search-check` compares those IDs with the smoke manifest.
- Normal manifest checks remeasure the IDs already recorded in the manifest without running the search.
- Do not commit a second generated search-result file.

## Tests

Tests must prove:

- the search reproduces the literal 30 kingdom IDs in independent processes;
- the selected set keeps all 40 cards, all 96 priority pairs, all 60 required triples, all 14 routes, 710 broad pairs, 3,221 broad triples, and maximum overlap 5;
- the YALPS model enforces the 6-to-11 card bounds;
- no valid one-row exchange strictly improves the selected set;
- manifest regeneration stays byte-stable and rejects stale data.

## Verification

Run:

```sh
npm run balance:smoke:search-check
npm run balance:smoke:search-check
npm run balance:smoke:manifest -- --check
npm run balance:suite:manifest -- --check
npm run balance:suite:validate
npm run balance:suite:design-report -- --check
npm test -- --run test/sim/balanceSmokeSuite.test.ts
npm test
npm run typecheck
npm run lint
npm run build
npm run goldfish:native-kingdom-check
git diff --check
```
