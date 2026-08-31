# Reproducible balance-smoke selector

## Purpose

Make the 25-to-30 kingdom smoke-suite selection executable from the committed 160-kingdom manifest. Preserve the current 30 kingdom IDs and measured coverage. This work does not change card balance, run strategy search, deploy code, or spend money.

## Current state

`src/sim/balanceSmokeSuite.ts` pins the selected IDs and remeasures them. The repository records that YALPS 0.6.4 feasibility and deterministic one-row exchange produced those IDs, but it does not contain that selection procedure.

The original procedure is recoverable from the implementation-session record. It used the 128 tuning kingdoms in manifest order, a binary feasibility model, and a full one-row exchange neighborhood. The current 30 came from these five improving exchanges:

1. `balance-tuning-016` to `balance-tuning-089`
2. `balance-tuning-039` to `balance-tuning-053`
3. `balance-tuning-006` to `balance-tuning-097`
4. `balance-tuning-012` to `balance-tuning-067`
5. `balance-tuning-089` to `balance-tuning-116`

The generated provenance must record this exact executable trajectory rather than rely on the prose summary.

## Design

### Search input

Read `src/sim/balance-suite-manifest.json` and use only its 128 tuning kingdoms, ordered by kingdom ID. Candidate sizes are 25 through 30. Their minimum card exposures are, respectively, 5, 5, 5, 6, 6, and 6.

For each size, create one binary variable per tuning kingdom. Require:

- exactly the candidate-size number of kingdoms;
- the candidate's minimum exposure for every variable card;
- every priority pair at least once;
- every required triple at least once;
- every route label at least once.

Minimize the sum of the selected kingdoms' one-based source indexes. Use YALPS 0.6.4 with a fixed iteration bound and no wall-clock timeout. A wall-clock cutoff is not deterministic.

### Exchange ascent

Start with the YALPS result. Evaluate every selected-to-unselected one-row exchange in source order. An exchange must preserve all feasibility constraints. The 30-row search also limits every card to at most 11 appearances; this is the bound that produced the established set, whose final maximum is 10.

Compare feasible states in this order:

1. more covered broad pairs;
2. more covered broad triples;
3. lower maximum card exposure;
4. lower sum of squared card exposures;
5. lower sum of squared pair exposures.

Take the best strict improvement and repeat. Source order is the final tie-break. Do not claim a global optimum: the result is a deterministic one-exchange local optimum from a deterministic feasible seed.

### Generated source

Add a versioned JSON source artifact that records:

- source suite version and digest;
- source kingdom order and its digest;
- YALPS version and fixed options;
- candidate sizes and card bounds;
- feasibility constraints and ascent objective;
- initial IDs, accepted exchanges, final IDs, and measured scores;
- a canonical SHA-256 digest.

Normal smoke-manifest generation reads and validates this source, then remeasures its final IDs. A separate search command regenerates the source from scratch. `--check` requires byte equality.

## Interface and files

- Put the search implementation behind one interface in `src/sim/balanceSmokeSuiteSearch.ts`.
- Add `scripts/generate_balance_smoke_suite_design.ts` as the write/check adapter.
- Add `src/sim/balance-smoke-suite-design-v1.json` as the pinned search result.
- Replace the literal candidate table in `src/sim/balanceSmokeSuite.ts` with the validated generated source.
- Add `balance:smoke:search` and `balance:smoke:search-check` package scripts.
- Keep the selected 30 IDs and all candidate coverage statistics unchanged.

## Validation

Tests must prove:

- from-scratch search reproduces the committed source byte for byte;
- two independent processes produce identical output;
- the generated final IDs for every size match the established 25-to-30 curve;
- the 30-row result retains all 40 cards, all 96 priority pairs, all 60 required triples, all routes, 710 broad pairs, 3,221 broad triples, and maximum overlap 5;
- the generated source rejects changed digests, source order, solver provenance, candidate IDs, or exchange provenance;
- normal manifest regeneration still rejects stale source data;
- no valid one-row exchange strictly improves the selected 30 under the recorded objective.

Use literal expected IDs and statistics as the independent regression oracle. Do not compute expected values with the search implementation itself.

## Documentation

Update the README command list and Plan 63 reproduction section. Correct the stale current manifest digests in Plans 62 and 63. State clearly that normal manifest generation remeasures the pinned source while search-check reruns the selector.

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

No simulation campaign, Modal command, deployment, or paid work is part of this plan.
