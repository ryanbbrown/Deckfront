# E014b Rush vs Engine B Sketch V4 Tempo Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4`.
- Map: `sketch-v4-tempo`.
- Starter board: `.games/e014-tempo-starter.board.json`.
- Deck setup used the fixed `deck.yaml` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player.
- P1 strategy: early damage/rush tempo, avoiding terminal clog by mixing money buys after the first damage payloads.
- P1 board strategy: aggressive northeast/east/center contest with raiders, scouts, and marksmen; guardians only to hold captured center access.
- P2 strategy: engine/healing/economy with Village/Peddler/Gold, then Potion/Healer/Armory-style support.
- P2 board strategy: preserve units, contest relocated east and lower centers, then answer lead-4 threats through kills and recruits.

## Map Correction Handling

- This E014b replay is on `sketch-v4-tempo`, where `center-southeast` is at 9,7.
- The relevant midgame southeast occupation is recorded at 9,7. The old 8,7 coordinate remains a normal hex, not the supply center.
- The correction made the southeast/east cluster slightly less compressed, but did not prevent P2 from reaching and holding the lower-center/east front.

## Lead-4 Threat Handling

- Turn 17 / P1 start: P1 began at 9 units to P2's 5, so P1 recorded a pending lead-4 threat.
- Turn 18 / P2 response: P2 recruited Scout-3 and killed P1 Scout-1 on the corrected southeast lane, dropping the count to 9 / 6 and clearing the pending P1 threat.
- Turn 30 / P2 start: P2 began at 11 units to P1's 6, so P2 recorded a pending lead-4 threat.
- Turn 31 / P1 response: P1 recruited Marksman-5 but did not kill a P2 unit. The lead stayed at P2 12 / P1 7.
- Winner: P2 confirms the pending lead-4 threat at the beginning of turn 32 / round 16.

## Final Result

- Completed player turns: 31.
- Winner: P2 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 7, P2 12.
- Final supply centers: P1 2, P2 5, neutral 1.
- Final saved supply: P1 6, P2 5.

## Pacing And Tension Notes

- P1's rush produced the intended early tension and created a real pending lead-4 threat at turn 17.
- P2 survived because the response turn combined one recruit with a kill, then healing/guardian density made later capped damage inefficient.
- By the late game, P2's lower-center/east economy paid for repeated durable recruits while P1 spent too many turns replacing fragile tempo units.
- The v4 southeast relocation did not break P2 counterplay in this sample.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in `timeline.json` reasoning and this notes file.
- Deck-produced damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit. Excess damage expired.
- Storm targeting used the least expansive interpretation: original legal target plus adjacent occupied enemy storm targets only when the board position supported it, with base unit attack on the original target.
- Tactical movement, targeting, and supply math were hand-audited; `validate-run` verifies schema, snapshot existence, and continuity, not full combat legality.
