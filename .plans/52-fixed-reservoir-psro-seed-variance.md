# Fixed-reservoir PSRO seed variance

## Goal

Separate fixed-reservoir variation from competitive-evaluation variation without repeating generation or goldfish scoring.

## Run

- Use saved Kingdom 009 reservoirs for pool seeds 1, 3, and 4.
- Run each reservoir with PSRO evaluation seeds 7,100,009, 7,200,009, and 7,300,009.
- Reuse the existing valid 7,100,009 runs and run the six missing combinations sequentially with 10 workers.
- Store validated, resumable artifacts under `.experiments/fixed-reservoir-psro-evaluation-variance-v1/`.
- Compare support, family/card usage, cross-play, and within-reservoir versus between-reservoir variance after all nine runs complete.
