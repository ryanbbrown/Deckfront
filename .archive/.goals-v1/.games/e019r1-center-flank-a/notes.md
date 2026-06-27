# E019r1 Center-Flank A

Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4`

Map: `sketch-v3-contest`

Starter: `.games/e013-contest-starter.board.json`

## Result

Winner: P2 by confirmed lead-4 response-window unit-count win at the beginning of P2 turn 34, after 33 completed player turns.

Final living units: P1 10, P2 15. Final center split: P1 3, P2 4, neutral 1.

## Legality

This replay was generated with explicit per-turn movement, recruitment, and attack logs. It is intended to pass `bun run validate-run -- --strict .games/e019r1-center-flank-a/timeline.json`. No unit stacking, blocked-hex movement endpoints, same-turn recruit attacks, or off-range attacks are intentionally used.

The win is not represented by an extra board-changing timeline entry. P2 first had a four-unit lead at the start of P2 turn 32, creating a pending threat. P1 turn 33 did not reduce the lead below four, so P2 confirms at the start of P2 turn 34.

## Strategic Observations

P1's balanced center-control plan reached the north/east centers first and used Armory/Training to hold anchors, but the center shell became congested and P1 banked large unused supply because home and lane space were awkward to free.

P2's flank/economy route legally kept lower/east lanes open, converted modest center control into repeated recruits, and won by body count rather than burst damage. Deck damage was modest under the cap; P2's decisive edge came from legal multi-lane board pressure, clearer reinforcement routes, and better supply conversion rather than hidden stacked units or illegal ranged melee attacks.
