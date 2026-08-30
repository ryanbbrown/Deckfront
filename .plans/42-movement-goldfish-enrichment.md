# Movement-aware goldfish enrichment

## Goal

Test whether solo execution across stationary, chasing, and kiting targets selects stronger Kingdom 009 strategies than ordinary random sampling.

## Run

1. Generate the same 200,000 unrestricted random policies used by the first goldfish pilot.
2. Goldfish each policy on four shared shuffle seeds under three target movement profiles.
3. Rank by worst-profile kills, total kills, worst-profile penalized turns, total penalized turns, worst-profile early-damage area, total early-damage area, money spent, then strategy ID.
4. Compare the top 100 with 100 deterministic random controls from the same pool.
5. Race both groups against all saved V4–V6 Kingdom 009 lotteries on common seeds. Confirm each group’s five best candidates on fresh held-out seeds.

## Decision

Goldfish selection is useful only if its group has better competitive mean, median, maximum, threshold counts, and confirmed finalists than the random-control group. This experiment tests enrichment only; it does not replace competitive evaluation.
