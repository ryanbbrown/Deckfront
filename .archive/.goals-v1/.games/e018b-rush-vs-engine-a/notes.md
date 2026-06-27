# E018b Rush vs Engine A Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4-no-printheal`.
- Map: `sketch-v3-contest`.
- Starter board: `.games/e018-no-printheal-starter.board.json`.
- Deck setup used `deck.yaml`: each player starts with 5 Copper, 1 Zap, 1 Bandage, and 3 Rest.
- P1 strategy: early damage and tempo buys, with raiders/scouts/marksmen pressing northeast, east, and center.
- P2 strategy: engine/economy/healing buys, with guardian/druid/healer bodies trying to stabilize through positioning, recruits, and deck healing.

## Lead-4 Threat Handling

- No lead-4 threat existed through turn 16.
- Turn 17 / P1 start: P1 began at 9 units to P2's 5, so P1 recorded a pending lead-4 threat.
- Turn 18 / P2 response: P2 recruited Druid-3 and used deck healing, but did not kill a P1 unit. The final count was P1 10 / P2 6, leaving the lead exactly 4.
- Winner: P1 confirms the pending lead-4 threat at the beginning of turn 19 / round 10.

## Final Result

- Completed player turns: 18.
- Winner: P1 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 10, P2 6.
- Final supply centers: P1 4, P2 4, neutral 0.
- Final saved supply: P1 0, P2 1.

## Support And Healing Observations

- No printed unit healing was used. Druids and healers acted only as bodies or attackers.
- P2 deck healing still mattered: Bandage/Potion/Healer buys and draws kept guardians alive on several key turns.
- The missing printed healing made chip damage stick between deck-heal turns. P1's turn-15 burst converted earlier damage into three kills and forced a lead-4 response window.
- P2's engine preserved center economy for much of the game, but deck healing alone could not both recover damaged bodies and replace losses during the response turn.

## Rules Calls And Ambiguities

- Pending lead-4 state is tracked in timeline reasoning and this notes file because the board schema has no pending-threat field.
- Deck-produced damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit. Excess damage expired.
- Deck-produced healing and Armory upgrade-health healing remained legal; printed druid/healer unit healing was never used.
- Tactical movement, targeting, and supply math were hand-audited. `validate-run` verifies schema, snapshot existence, and continuity, not full combat legality.
- Evidence quality: partial. The replay is mechanically continuous and validates, but tactical legality is hand-authored rather than enforced by tooling.
