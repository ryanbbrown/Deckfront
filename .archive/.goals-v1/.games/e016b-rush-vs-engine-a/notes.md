# E016b Rush vs Engine A

## Setup
- Ruleset: territory-v1-cost6-damagecap-responsewin-lead4-centercontrol
- Map: sketch-v3-contest
- Starter board: .games/e016-centercontrol-starter.board.json
- Normal income used throughout: 2 + controlled centers.
- Center-control threat requires 5+ centers and living-unit parity or better; unit-count threat requires confirmed 4-unit lead.

## Strategy
- P1: early damage and tempo buys, center pressure, raiders/scouts/marksmen first with guardians for holds.
- P2: engine/healing/economy buys, stabilize by flipping centers or pulling ahead on units, guardian/healer/druid core.

## Result
- Winner: P1
- Win type: confirmed center-control response-window
- Completed player turns: 28
- Final centers: P1 5, P2 3
- Final living units: P1 12, P2 11
- Pending threats at stop: unit=none, center=P1
- Win note: P1 began turn-029 with 5 centers and unit parity or better after the pending center-control threat survived the response turn.

## Threat Handling
- Threat checks were performed at the beginning of each active player turn before deck or board actions.
- Pending center and unit threats were tracked in timeline reasoning because the board schema has no pending-threat field.
- P2 responses prioritized flipping P1 centers once P1 reached five centers; if no flip was reachable, P2 attempted to improve unit parity.

## Evidence Quality
- Evidence quality: full. `bun run validate-run -- .games/e016b-rush-vs-engine-a/timeline.json` passed with 28 entries.
- The run used generated legal pathfinding and existing deck-engine actions; no material rules ambiguity was encountered.
- P1 began turn-029 with 5 centers and unit parity or better after the pending center-control threat survived the response turn.
