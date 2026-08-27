# Ordered reservoir lottery challenge

## Goal

Test whether the deterministic Kingdom 009 ordered strategy space produces a final lottery that is competitive with the five previous lotteries built from 500,000 random proposals.

## Important distinction

The final Modal `pool.json` is not the ordered strategy space. It recreates the old seeded random generator with native scoring. Its generated digest matches the previous seed-5 random pool. Reusing it would test scorer conformance, not the new proposal method.

The ordered Modal run scored all 12,972,960 ordered candidates, but its shard artifacts retained only counts and digests. They do not contain the leaders needed for PSRO. Do not spend another Modal full-run budget. Re-score the ordered space locally with the verified Rust scorer.

## Ordered pool

- Kingdom: `deep-beam-tuning-009`.
- Candidate space: all 12,972,960 candidates from `createOrderedCandidateSpace`.
- Structure: empty starting build, five unique finite buy rungs, no fallback.
- Quantities: rungs one through three range from 1 through 4; rungs four and five are fixed at 3; total planned quantity is at most 15.
- Traversal: the existing fixed coprime traversal.
- Stage one: score every candidate on goldfish seed 5,200,000 for stationary, chaser, and kiter movement.
- Prefilter: retain the best 50,000 stage-one candidates.
- Tail evidence: retain the best 20,000 deterministic tail ranks across the full ordered space.
- Stage two: score the 50,000 prefilter candidates on seeds 5,200,001 through 5,200,003.
- Reservoir: 18,000 combined four-seed leaders plus the first 2,000 tail candidates that are not leaders.
- Use the existing display-ID collision policy and bounded retention rules.
- Write restart-safe local checkpoints under `.experiments/ordered-reservoir-challenge/`.

## PSRO

- Run the current fixed-reservoir PSRO protocol on the ordered 20,000-strategy reservoir.
- Use evaluation seed 7,100,009, 4 pairing workers, the top 50 goldfish leaders, the 1/2/4/8-block race, 400-block confirmation, and two clean scans.
- Validate and resume the pool and PSRO artifacts independently.

## Comparison

Compare the ordered lottery with each Kingdom 009 seed-1 through seed-5 lottery from the saved five-run random-proposal suite.

- Validate the historical run structure, Kingdom, rules fingerprint, complete matrix, support membership, nonnegative weights, and weight sum before use. The files use the superseded artifact version, so do not claim that they pass the current full validator.
- Use one new held-out schedule of 400 blocks in both directions for each pair.
- Bootstrap each ordered-versus-random result independently.
- Report the ordered lottery's score and 95% interval against each old lottery, the reverse score as a consistency check, support identities and weights, reservoir overlap, runtime, and the aggregate range.
- Call the ordered lottery competitive only if the held-out evidence supports that statement. Do not use PSRO's two clean scans as global closure evidence.

## Verification

- Add public-boundary tests for ordered staged selection, bounded checkpoint validation, historical lottery validation, and weighted cross-play summarization.
- Run focused tests, the full test suite, native verification, typecheck, lint, builds, and `git diff --check`.
- Record the measured result in `.plans/60-ordered-reservoir-lottery-challenge-results.md`.
- Never edit, stage, revert, or clean `.plans/34-strategy-search-results.md`.
