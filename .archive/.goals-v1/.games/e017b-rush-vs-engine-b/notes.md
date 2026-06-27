# E017b Rush Vs Engine B

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4-centercontrol-tight`
- Map: `sketch-v3-contest`
- Starter board: `.games/e017-centercontrol-tight-starter.board.json`
- Run directory: `.games/e017b-rush-vs-engine-b/`

## Strategy Assignment

- P1 deck: early damage/rush tempo with enough money and limited terminal clog.
- P1 board: aggressively contest northeast, east, center, and southeast.
- P1 units: raiders, scouts, marksmen, with guardians for center holds.
- P2 deck: engine/healing/economy with action, money, and heal support.
- P2 board: preserve units, contest lower/east centers, and answer center-control and unit-count threats.
- P2 units: guardians, healers, druids, marksmen, scouts.

## Result

- Winner: P1.
- Completed player turns: 18.
- Win type: confirmed tight center-control response-window win at the beginning of P1 round 10, before turn-19 actions.
- Final unit counts after P2 response: P1 11, P2 9.
- Final center split: P1 5, P2 3, neutral 0.

## Threat Handling

- P1 first reached five centers on turn 9, but this was before the center-control gate.
- Turn 17 start check occurred after 16 completed player turns. P1 controlled five centers and led 10 units to 8, so P1 recorded a pending tight center-control threat.
- P2 received turn 18 as a full response turn. P2 recruited one unit and dealt damage, but could not flip a P1 center or reduce the lead below two.
- P1 therefore confirms the center-control win at the next start-of-turn check.

## Evidence Quality

- Evidence quality: full for replay-bundle validation and response-window facts.
- Caveat: board play is hand-authored. Movement, attacks, captures, and deck-counter use were tracked in timeline reasoning, but only the replay structure is mechanically validated.
