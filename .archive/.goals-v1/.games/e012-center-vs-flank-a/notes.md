# E012 Center vs Flank A Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4`
- Map: `sketch-v2-access`
- Starter board: `.games/e012-lead4-starter.board.json`
- P1 deck strategy: central pressure/control with economy and tactical tempo.
- P1 board strategy: contest and hold central centers, protect upgraded central units, and create a pending 4-unit lead only if it can survive response.
- P2 deck strategy: flank/economy/support with healing/control tools.
- P2 board strategy: pressure side lanes, preserve units, and use the lead-4 threshold to stay alive while seeking a flank counter-threat.

This run extends the prior center-vs-flank tactical line under the stricter lead-4 response-window threshold. The first 20 turns show the threshold doing useful work: the position that previously ended on a three-unit pending lead instead continues because P1 is only ahead 8 to 5 at the start of round 11.

## Pending Lead-4 Threat Handling

- Turn 19 start: P1 led 8 units to 5, which is only a three-unit lead. No pending lead-4 threat was recorded.
- Turn 19 after P1: P1 reached 9 units to P2's 4, but pending threats are recorded only at start-of-turn checks, not immediately after a board phase.
- Turn 20 after P2: P2 killed one unit and recruited one unit, reducing the next P1 start to P1 8 vs P2 5. No pending threat existed.
- Turn 21 start: P1 still led by only 3, so no pending threat. P1 killed P2-druid-1 and recruited once, ending P1 9 vs P2 4.
- Turn 22 after P2: P2 recruited but could not kill, so the next P1 start was P1 9 vs P2 5.
- Turn 23 start: P1 had an exact 4-unit lead and no existing pending threat, so P1 recorded a pending lead-4 unit-count win threat instead of winning immediately.
- Turn 23 after P1: P1 removed P2-raider-2 and recruited P1-guardian-5, increasing the count to P1 10 vs P2 4.
- Turn 24 after P2: P2 recruited P2-marksman-3 but could not remove a P1 unit, leaving P1 10 vs P2 5. The lead stayed at 5, so the pending P1 threat survived.
- Start of round 13: P1 wins before taking another turn because the pending 4-unit lead was confirmed.

## Result

- Completed player turns: 24
- Winner: P1, confirmed at the start of round 13
- Final living units: P1 10, P2 5
- Final supply centers: P1 controls 4, P2 controls 3, 1 uncontrolled
- Final saved supply: P1 2, P2 0

## Center/Flank Tension Read

The lead-4 threshold preserved center/flank tension longer than the three-unit response-window line. P2's turn-20 response successfully prevented the old ending, and P1 had to create a larger material swing before the win window opened. The game still did not churn to 40 turns: once P1 held four centers and removed the druid/raider support chain, P2's flank economy could recruit only one response unit per turn and could not both replace losses and finish damaged central units.

## Ambiguities

- No new rules ambiguity was needed for this run.
- Deck-produced damage used the least-expansive interpretation from the rules: it was attached only to legal unit attacks and respected the per-attacker damage cap.
- Pending lead-4 threats are not represented in `board.json`, so they are tracked in `timeline.json` reasoning and these notes.
