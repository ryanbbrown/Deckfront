# Random PSRO archive revision

## Goal

Make random-first PSRO retain useful search evidence and test it again as the target mixture changes.

## Implementation

1. Bump the suite and artifact schema versions so prior results cannot resume as current evidence.
2. Normalize response policies before identity: finite counts are cumulative acquisition targets, so remove a later buy for a card when its target is not higher than the highest earlier target, remove buys after that card's infinite target, preserve later higher targets, and compact active slots.
3. Keep every unique confirmed fresh finalist in an unbounded per-run archive. Persist the archive and each round's archive racing and confirmation evidence.
4. Reconsider archived candidates that are not in the matrix against each later mixture with the same successive-halving race and held-out confirmation discipline. This work is additional to the 20,000 fresh proposals.
5. Combine unique confirmed fresh and archive finalists, admit every candidate whose 95% CI lower bound is greater than 0.50, add the full batch to the payoff matrix, and solve one equilibrium after all additions.
6. Require five consecutive rounds with no admissions. Run the independent final attack at the same strict greater-than-0.50 threshold; a confirmed attack makes the artifact incomplete rather than converged.
7. Extend artifact validation for archive provenance, deduplication, schedule namespaces, batched matrix growth, clean-streak state, and the final attack gate.

## Verification

Add focused tests for policy normalization, archive deduplication and persistence, later-mixture reconsideration, batched admission, one post-batch equilibrium result, five-clean stopping, artifact validation, and the strict attack threshold. Run focused tests, the full test suite, typecheck, lint, and `git diff --check`. Do not run the 10-kingdom suite.
