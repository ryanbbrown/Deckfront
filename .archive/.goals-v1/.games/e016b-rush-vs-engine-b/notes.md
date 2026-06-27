# E016b Rush Vs Engine B

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4-centercontrol`
- Map: `sketch-v3-contest`
- Starter board: `.games/e016-centercontrol-starter.board.json`
- Run directory: `.games/e016b-rush-vs-engine-b/`

## Strategy Assignment

- P1 deck: early damage/rush tempo with Blast/Zap payload and enough money to avoid terminal clog.
- P1 board: contest northeast, east, center, and southeast aggressively; convert five-center shapes into a response-window threat.
- P1 units: raiders, scouts, marksmen, with guardians used for center holds.
- P2 deck: engine/healing/economy with Village, Potion, Healer, Silver, and Gold.
- P2 board: preserve units, contest lower/east centers, and answer center-control/unit-count threats.
- P2 units: guardians, healers, druids, marksmen, scouts.

## Result

- Winner: P1.
- Completed player turns: 18.
- Win type: confirmed center-control response-window win at the beginning of P1 round 10, before turn 19 actions.
- Final unit counts: P1 9, P2 6.
- Final center split: P1 5, P2 3, neutral 0.

## Threat Handling

- P1 first reached a five-center board phase on turn 7, but P2 flipped southeast on turn 8 before any P1 start-of-turn pending check.
- P1 restored five-center shapes later, and P2 repeatedly cleared them by flipping east, center, or southeast before P1 could start a turn with five centers and unit parity.
- Turn 17 start: P1 controlled five centers and led 8 units to 6, so P1 recorded a pending center-control threat. This was not an immediate win because no prior P1 center threat was pending.
- Turn 18 response: P2 had a full response turn but could not flip a P1 center or move ahead on living units. P1 still controlled five centers and led 9 units to 6 after P2 recruited.
- P1 therefore confirms the center-control win at the next start-of-turn check.

## Evidence Quality

- Evidence quality: full for structural replay validation and useful for E016 pacing/balance.
- Caveat: board play is hand-authored, so exact attack sequencing should be treated as tactical evidence rather than engine-enforced proof. The material response-window facts are explicitly recorded in `timeline.json` and terminal `board.json` notes.
