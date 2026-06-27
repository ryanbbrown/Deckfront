# E011 Center vs Flank A Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-emergency`
- Map: `sketch-v2-access`
- Starter board: `.games/e011-emergency-starter.board.json`
- P1 strategy: central pressure/control with economy and tactical tempo.
- P2 strategy: flank/economy/support with healing and control tools.

This run follows the validated E010 center-vs-flank A tactical line, retargeted to the emergency ruleset. The emergency ruleset keeps the same cards, units, map, movement, combat, income, recruit cost, damage cap, and response-window win timing; the only added rule is the narrow emergency defender discount.

## Pending Unit-Count Threats

- Turn 17 after P1: P1 reached 8 units to P2's 4, but no pending threat existed yet because the lead is checked only at the start of the leading player's turn.
- Turn 18 after P2: P2 recruited once, changing the next P1 start to P1 8 vs P2 5.
- Turn 19 start: P1 had a 3-unit lead, so P1 recorded a pending unit-count win threat instead of winning immediately.
- Turn 19 after P1: P1 killed P2-healer-1 and recruited P1-marksman-4, leaving P1 9 vs P2 4.
- Turn 20 after P2: P2 killed P1-guardian-1 and recruited P2-scout-4, leaving P1 8 vs P2 5. The lead was still 3, so the pending P1 threat survived.
- Start of round 11: P1 wins before taking another turn because the pending 3-unit lead was confirmed.

## Emergency Defender Handling

No emergency defender was used.

The only legal response-window turn was P2 turn 20. P2 had 8 supply after income and could afford a normal 6-supply recruit. A discounted emergency defender would still add only one delayed unit and would not improve the unit-count result beyond the normal scout recruit. After P2's one kill plus one recruit, P1 still led 8 to 5, so the emergency defender could not clear the pending threat in this position.

## Result

- Completed player turns: 20
- Winner: P1, confirmed at the start of round 11
- Final living units: P1 8, P2 5
- Final supply centers: P1 controls 4, P2 controls 3, 1 uncontrolled
- Final saved supply: P1 2, P2 2

## Ambiguities

- No new rules ambiguity was needed for this run.
- Deck damage continued to use the least-expansive interpretation from the rules: deck-produced damage was attached only to legal unit attacks and respected the per-attacker damage cap.
