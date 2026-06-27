# E019r2 Center-Flank A

Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4`

Map: `sketch-v3-contest`

Starter: `.games/e013-contest-starter.board.json`

## Result

Winner: P2 by confirmed lead-4 response-window unit-count win at the beginning of turn 34, after 33 completed player turns.

Final living units: P1 11, P2 15. Final center split: P1 3, P2 4, neutral 1.

## Legality

This replay was generated with explicit per-turn movement, recruitment, and attack logs. It is intended to pass `bun run validate-run -- --strict .games/e019r2-center-flank-a/timeline.json`. No unit stacking, blocked-hex movement endpoints, same-turn recruit attacks, or off-range attacks are intentionally used.

The win is not represented by an extra board-changing timeline entry. P2 created the pending lead at the beginning of turn 32 with a 14-10 unit lead. P1 recruited on turn 33, but P2 also recruited on turn 32, so the lead remained 15-11 and P2 confirms at the beginning of turn 34.

## Strategic Observations

P1 improved on round 1 by clearing home spaces and adding four legal recruits from turns 23-33, reducing the final banked supply from the prior 39-style congestion pattern to 21. That still was not enough because P2 killed P1's original scout and raider in the midgame, kept the 4-3 center edge, and converted its cleaner lower/east lanes into steady bodies.

P2 keeps the flank/economy plan: lower/east pressure, Village/Peddler/Gold buys, damage cards only when attached to legal attackers, and Armory/Healer support when available. This repeat supports that the P2 flank edge remains robust even when P1 manages congestion better, though the game still runs long at 33 completed player turns.
