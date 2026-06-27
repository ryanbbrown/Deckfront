# E011c Rush vs Engine C Emergency-Response Notes

## Strategy

- P1 followed the E010 rush/tempo line through the P1 round 11 response-window pressure turn.
- P2 followed the E010 engine/heal/control line, then used the E011 emergency defender option at the response turn where normal cost-6 recruitment had failed.
- The branch tests whether a 3-supply defender can keep the engine player alive after falling behind on centers and unit count.

## Rules Calls

- E011 retargets the validated E010c replay to `territory-v1-cost6-damagecap-responsewin-emergency`.
- Turns 1-21 are copied from E010c with the board ruleset id changed only. Deck state, map, damage-cap handling, response-window timing, and normal recruitment are otherwise unchanged.
- Recruited units were treated as delayed. The JSON schema has no readiness flag, so delayed activation is documented in timeline reasoning.
- Deck damage was attached only to legal attacks by ready units. Each attacking unit received at most 1 extra deck-produced damage for the whole turn; unassigned damage expired.
- The P1 10-7 unit lead at the beginning of P1 round 11 created a pending P1 unit-count win threat rather than an immediate win.
- P1 widened that pending threat to 11-6 on turn 21 by killing P2-scout-2 and recruiting delayed P1-raider-7.
- On turn 22, P2 was responding to the pending P1 threat. P2 killed wounded P1-raider-1, gained enough supply for the E011 discount, and recruited one delayed emergency defender.
- The emergency defender chosen was `P2-guardian-5` at P2 home hex `1,7`. Guardian was chosen over scout/healer because P2 needed durable body count and a future screen if play continued.
- P2 paid 3 supply for the emergency defender, ending at 2 saved supply instead of the E010 endpoint of 5 saved supply with no recruit.

## Ambiguities

- The emergency recruit changed the response endpoint from P1 10 units / P2 6 units to P1 10 units / P2 7 units.
- Under the written win condition, a pending threat is cleared only if the lead is reduced below 3 before the next start-of-turn check. P1 still leads by exactly 3 at P1 round 12, so the strict reading still confirms P1's win.
- The emergency-defender legality text says the recruit must be able to "help reduce or prevent" the pending lead. This run treats the defender as worth recording because it reduces the lead and directly tests the E011 rule, but it does not prevent the confirmed win under the stricter "below 3" threat-clearing language.
- Movement and attack legality were resolved manually from the odd-column map rules; validation checks replay continuity but does not independently verify tactical legality.

## Stopping Point

- Source comparison: `.games/e010c-rush-vs-engine-c/` validates at 22 entries and ended with P1 10 units / P2 6 units, P1 6 centers / P2 2 centers, and P2 at 5 saved supply.
- E011 branch: P2 used the emergency defender on turn 22 and ended with P1 10 units / P2 7 units.
- Final supply centers: P1 6, P2 2, neutral 0.
- Final saved supply: P1 3, P2 2.
- Result: P1 confirmed win at the beginning of P1 round 12 under the strict response-window rule.
- Continued beyond the 16-turn checkpoint and stopped after 22 completed player turns because the next start-of-turn check produces a legal confirmed winner.

## Evidence Quality

- Evidence quality: full for replay-bundle continuity, with the tactical-legality and emergency-clearing ambiguity recorded above.
- Main observation: the emergency defender softened the failed response but did not change the winner in this exact branch because P1's turn-21 kill plus recruit created too large a unit-count swing for one delayed defender to overcome.
