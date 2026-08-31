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

After those requirements, prefer broader pair coverage, then broader triple coverage, lower maximum card exposure, lower squared card exposure, and lower squared pair exposure. Source order breaks final ties. The search uses YALPS 0.6.4 binary feasibility with a kingdom-index objective, followed by deterministic one-row exchange ascent. The selected IDs are pinned. This is a one-exchange local optimum from the deterministic feasible seed, not proof of the global subset optimum.

## Result

Select 30 tuning kingdoms. They give:

- 6–10 appearances per card;
- 710 of 780 broad pairs, or 91.03%;
- all 96 priority pairs;
- 3,221 of 9,880 broad triples, or 32.60%;
- all 60 required triples;
- all 14 route labels;
- maximum row overlap 5.

No validation kingdom is needed. The machine-readable IDs and candidate curve are in `src/sim/balance-smoke-suite-manifest.json`. Its digest is `d88c6160c248ed0d5b56f2496a2c268936c2a43747a8cb4cfe7d14a6908cb6eb`.

## Reproduction

```sh
npm run balance:smoke:search
npm run balance:smoke:search-check
npm run balance:smoke:manifest
npm run balance:smoke:manifest -- --check
npm test -- --run test/sim/balanceSmokeSuite.test.ts
```

`balance:smoke:search` reruns YALPS and the one-row exchange search for the selected 30 and prints the kingdom IDs. `balance:smoke:search-check` compares those IDs with `src/sim/balance-smoke-suite-manifest.json`. The manifest is the only committed smoke-suite data artifact. Normal manifest generation remeasures its recorded IDs without rerunning the selector.
