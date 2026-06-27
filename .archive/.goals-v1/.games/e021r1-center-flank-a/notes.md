# E021r1 Center-Flank A

Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4-no-printheal`

Map: `sketch-v5-recenter`

Starter: `.games/e021-recenter-no-printheal-starter.board.json`

Branch note: druid and healer printed healing are 0 and are not used as printed unit actions. Deck-produced heal and upgradeHealth are still used normally.

## Result

Winner: P2 by confirmed lead-4 response-window unit-count win at the beginning of turn 34, after 33 completed player turns.

Final living units: P1 11, P2 15. Final center split: P1 4, P2 3, neutral 1.

## Legality

This replay was generated with explicit per-turn movement, recruitment, and attack logs. It is intended to pass `bun run validate-run -- --strict .games/e021r1-center-flank-a/timeline.json`. No unit stacking, blocked-hex movement endpoints, same-turn recruit attacks, or off-range attacks are intentionally used.

The win is not represented by an extra board-changing timeline entry. P2 created the pending lead at the beginning of turn 32 with a 14-10 unit lead. P1 recruited on turn 33, but P2 also recruited on turn 32, so the lead remained 15-11 and P2 confirms at the beginning of turn 34.

## Strategic Observations

The recentered map moves the contested center-south hex from (5,7) to (7,5). In this scripted center-control versus flank/economy line, that makes P1's central hold stronger on centers, but P2 still converts flank pressure and recruitment cadence into a confirmed unit-count lead.

P2 keeps the flank/economy plan: lower/east pressure, Village/Peddler/Gold buys, damage cards only when attached to legal attackers, and deck Healer support when available. Removing printed druid/healer healing does not change this line because no printed unit-heal action was used; P2 still converts flank pressure and recruitment cadence into a confirmed lead.
