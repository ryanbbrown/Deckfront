# E007 Damage-Cap Audit

## Purpose

E007 was planned as a four-run damage-cap batch, but two original workers and two replacement workers failed with rate-limit errors before producing bundles. This audit records what can be learned from the completed E007 evidence and the closest E006 comparisons without pretending the missing runs exist.

## Compared Runs

- `.games/e006-rush-vs-engine-a`: cost 6, no damage cap, valid 16-entry replay.
- `.games/e006-rush-vs-engine-b`: cost 6, no damage cap, valid 16-entry replay.
- `.games/e007-rush-vs-engine-b`: cost 6 plus damage cap, valid 16-entry replay.

## Final-State Comparison

| Run | Units | Centers | Saved supply | Result |
| --- | --- | --- | --- | --- |
| `e006-rush-vs-engine-a` | P1 8, P2 5 | P1 5, P2 2, neutral 1 | P1 5, P2 5 | P1 wins on pending start-turn check. |
| `e006-rush-vs-engine-b` | P1 8, P2 7 | P1 5, P2 2, neutral 1 | P1 5, P2 5 | Unresolved, P1 clear leader. |
| `e007-rush-vs-engine-b` | P1 7, P2 7 | P1 5, P2 2, neutral 1 | P1 5, P2 5 | Unresolved, P1 positional leader. |

## Damage Pattern

The E006 rush runs repeatedly produced large P1 damage turns:

- `e006-rush-vs-engine-a`: P1 produced 6 damage on turn 5, 5 on turn 9, 8 on turns 11, 13, and 15.
- `e006-rush-vs-engine-b`: P1 produced 6 damage on turn 5, 7 on turn 9, 8 on turn 13, and 5 on turn 11.

In `e007-rush-vs-engine-b`, P1 still produced large damage hands, including 7-damage turns on turns 9, 11, 13, and 15. The difference is that the cap forced most of that damage to expire unless P1 had multiple legal attackers. The replay notes explicitly call out three important cap effects:

- Turn 7: one scout attack could carry only 1 extra deck damage, so most of the burst expired.
- Turn 9: the forward scout again carried only 1 extra deck damage, and P2 got a response window.
- Turn 13: a guardian attack carried 1 extra deck damage, leaving the support marksman alive.

## Design Signal

The damage cap appears to address the rush lethality problem more directly than recruit cost alone. It does not solve board economy: P1 still controls 5 centers to P2's 2 in the completed E007 rush run. But it does prevent the same center lead from becoming an immediate unit-count win by turn 16.

## Evidence Limits

This is audit evidence, not a replacement for the missing playthroughs.

- It compares one completed E007 rush run against two E006 rush runs.
- It does not provide the missing `e007-rush-vs-engine-a` or `e007-center-vs-flank-b` bundles.
- It should support the decision to deepen E007, not close the E007 batch as complete.
