# E012c Rush vs Engine C Lead-4 Response-Window Notes

## Strategy

- P1 followed the E010c rush/tempo line through the old exact-3 confirmed-win point, then continued with the same pressure plan under the lead-4 threshold.
- P2 followed the E010c engine/heal/control line and received a full response turn after P1 created the first legal lead-4 pending threat.
- The branch tests whether changing only the response-window threshold from 3 units to 4 units gives the engine/heal side enough time to stabilize.

## Rules Calls

- E012 retargets the validated E010c replay to `territory-v1-cost6-damagecap-responsewin-lead4`.
- Normal recruitment, cost-6 recruits, damage cap, deck state, map, unit stats, and delayed recruited-unit timing were kept unchanged.
- Turns 1-22 are copied from E010c with the board ruleset id changed and timeline reasoning corrected where E010c recorded 3-unit pending threats.
- Recruited units were treated as delayed. The JSON schema has no readiness flag, so delayed activation is documented in timeline reasoning.
- Deck damage was attached only to legal attacks by ready units. Each attacking unit received at most 1 extra deck-produced damage for the whole turn; unassigned damage expired.
- The old E010c endpoint at P1 10 units / P2 6 units is not a confirmed win under E012. It creates the first pending P1 lead-4 threat at the beginning of P1 round 12.

## Lead-4 Threat Handling

- No lead-4 threat existed at P1 round 11 because P1 led only 10-7 at that start-of-turn check.
- P1 ended turn 21 ahead 11-6, but the written win check is at the beginning of the active player's turn. P2's turn 22 reduced the count to 10-6 before the next P1 check.
- At the beginning of P1 round 12, the 10-6 count created a pending P1 lead-4 threat.
- P1 turn 23 widened the position to 11-5 by removing P2-guardian-1 and recruiting P1-raider-8.
- P2 turn 24 was the full response turn. P2 recruited P2-guardian-5 but could not remove a P1 unit, ending at P1 11 units / P2 6 units.
- P1 wins at the beginning of P1 round 13 because the pending lead-4 threat survived P2's full response turn.

## Ambiguities

- The rules prose describes 7 Copper plus up to 12 draft coin, while deck.yaml contains a fixed starter deck. This run preserves the E010c draft setup so the source comparison stays exact.
- Movement and attack legality were resolved manually from the odd-column map rules; validation checks replay continuity but does not independently verify tactical legality.
- On turn 23, P1 used only one of four produced deck damage because P1-raider-3 was the only needed legal capped assignment to remove P2-guardian-1. Remaining deck damage expired.
- On turn 24, P2 produced 8 deck healing but had no wounded living unit after P2-guardian-1 was removed. The healing expired.

## Stopping Point

- Source comparison: `.games/e010c-rush-vs-engine-c/` validates at 22 entries and confirmed P1 at 10 / 6 under a 3-unit response-window threshold.
- E012 continued from that exact 10 / 6 point and stopped after 24 completed player turns.
- Final unit counts: P1 11, P2 6.
- Final supply centers: P1 6, P2 2, neutral 0.
- Final saved supply: P1 5, P2 3.
- Result: P1 confirmed lead-4 response-window win at the beginning of P1 round 13.

## Evidence Quality

- Evidence quality: full for replay-bundle continuity, with tactical-legality caveats recorded above.
- Main observation: increasing the pending/confirmed threshold from 3 to 4 delayed the E010c result by two more completed player turns, but did not let P2 clear the threat in this exact branch.
