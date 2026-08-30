# Staged goldfish A/B

## Goal

Test whether a one-seed prefilter reduces fixed-reservoir pool cost without changing the four-seed scores used for the selected goldfish cohort.

## Run

- Recreate the 500,000 deterministic Kingdom 009 strategies for pool seed 5.
- Score all strategies on goldfish seed 5,200,000 across all three movement profiles, retain the best 50,000, and score only those strategies on seeds 5,200,001–5,200,003.
- Merge the disjoint score evidence, select 18,000 goldfish strategies, and add a deterministic 2,000-strategy unrestricted tail with explicit one-seed provenance.
- Run fixed-reservoir PSRO with evaluation seed 7,100,009. Write each completed stage atomically and resume from valid artifacts.
- Compare the staged artifacts with the existing seed-5 baseline. Report runtime, retention, reservoir overlap, PSRO structure, acquisition-based family and card usage, and held-out lottery cross-play.
- In each direction, scan every reservoir candidate that is not active in the target matrix with the fixed-reservoir 1/2/4/8-block race. Confirm up to eight global finalists on 400 fresh blocks, bootstrap 95% intervals, use independent deterministic seed namespaces, and persist the evidence for resume. Report the strongest confirmed finalist and its interval.

## Verification

- Test exact score merging, deterministic staged selection, unrestricted tail selection, and provenance validation through public pure functions.
- Run focused tests, typecheck, and lint before the real experiment.
