# Goldfish random pilot

## Goal

Test whether solo deck execution is a useful cheap filter for random Kingdom 009 strategies.

## Run

1. Generate up to 200,000 unique unrestricted draft-off purchase policies.
2. Run each policy against a passive stationary 50-health dummy on four shared shuffle seeds. Keep the goldfish stage under five minutes.
3. Rank policies lexicographically by: most kills, fewest total turns to kill, largest cumulative damage area, most money spent, then stable strategy ID.
4. Confirm the top five against each saved Kingdom 009 lottery from random PSRO versions 4, 5, and 6 on fresh held-out seeds.

The dummy never acts, buys, moves, or attacks. The candidate still uses the normal simulator purchase, shuffle, tactical-action, movement, range, and damage rules.

## Verification

Tests must show that damage plans outrank economy-only plans, melee without movement cannot deal fictitious damage, ranking is deterministic, and weighted lottery evaluation uses the complete lottery. Run focused tests, the full test suite, typecheck, and lint before recording results.
