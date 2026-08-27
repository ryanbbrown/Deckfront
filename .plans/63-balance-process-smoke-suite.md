# Balance process-smoke suite

## Purpose

Use one small deterministic kingdom set to test the future balance campaign process before running the 160-kingdom suite. This is a user-requested extension after the comprehensive suite plan was reviewed.

The smoke set tests orchestration, artifacts, search behavior, and report flow. It is not final card-balance evidence and has no tuning or validation split of its own.

## Source and selection

Compare 25 through 30 subsets of the 128 `balance-suite-v4` tuning kingdoms. Do not consume held-back validation kingdoms unless they give a material improvement.

Each candidate must contain:

- all 40 variable cards;
- all 96 named priority pairs at least once;
- all 60 named required triples at least once;
- all 14 route labels at least once.

After those requirements, prefer broader pair coverage, then broader triple coverage, then UTF-16 kingdom ID order. The offline search uses YALPS 0.6.4 binary feasibility with a kingdom-index objective, followed by deterministic one-row exchange ascent. The selected IDs are pinned, and manifest regeneration remeasures them. This is a practical fixed result, not proof of the global subset optimum.

## Result

Select 30 tuning kingdoms. They give:

- 6–10 appearances per card;
- 710 of 780 broad pairs, or 91.03%;
- all 96 priority pairs;
- 3,221 of 9,880 broad triples, or 32.60%;
- all 60 required triples;
- all 14 route labels;
- maximum row overlap 5.

No validation kingdom is needed. The machine-readable IDs and candidate curve are in `src/sim/balance-smoke-suite-manifest.json`. Its digest is `239c9df06094195f125b594116b0e43aad3155408c10eff5fa5c3aeed5aa7b3e`.

## Reproduction

```sh
npm run balance:smoke:manifest
npm run balance:smoke:manifest -- --check
npm test -- --run test/sim/balanceSmokeSuite.test.ts
```
