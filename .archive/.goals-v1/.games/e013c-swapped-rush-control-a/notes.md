# E013c Swapped Rush Control A Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4`.
- Map: `sketch-v3-contest`.
- Starter board: `.games/e013-contest-starter.board.json`.
- Deck setup used the fixed `deck.yaml` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player. The rules prose still mentions an older 7-Copper draft baseline, so this run records the fixed deck-file setup as the operative setup.
- P1 strategy: engine/control/healing/economy with Village/Peddler/Silver/Gold and support/upgrades.
- P2 strategy: early damage and tempo from the P2 seat with Zap/Blast/Storm pressure and enough money to keep buying attacks.

## Lead-4 Threat Handling

- No lead-4 threat existed through turn 26. P2 led the early center race but never began its own turn with a 4-unit lead.
- Turn 27 / P1 start: P1 began at 10 units to P2's 6, so P1 recorded a pending lead-4 threat before taking the turn.
- Turn 27 / P1 board phase: P1 recruited Druid-2 and preserved the center/east shell, ending at 11 units to 6.
- Turn 28 / P2 response: P2 had only 5 supply, one short of a recruit. P2 did not kill a P1 unit, so the P1 lead stayed above the 4-unit threshold.
- Winner: P1 confirms the pending lead-4 threat at the beginning of turn 29 / round 15, before income, movement, combat, healing, or recruitment.

## Final Result

- Completed player turns: 28.
- Winner: P1 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 11, P2 6.
- Final supply centers: P1 4, P2 3, neutral 1.
- Final saved supply: P1 1, P2 5.

## Map And Strategy Takeaways

- P2 rush was meaningfully dangerous from the swapped seat. P2 reached a five-center high-water mark on turn 12 and killed P1's first scout and healer before P1 stabilized.
- The pressure was not symmetrical with the strongest P1 rush lines. P2 needed scouts and raiders to maintain reach; once P1's support shell killed the raiders, P2's later guardian recruits held lower centers but stopped creating new pressure.
- The contest map appears to improve P2 agency more than it creates a fully mirrored rush seat. P2 can become the aggressor, but P1's northeast/control side still had enough defensive geometry to convert engine scaling into a late lead.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in `timeline.json` reasoning and this notes file.
- Deck-produced damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit. Excess damage expired.
- Tactical movement, targeting, and supply math were hand-audited; `validate-run` verifies schema, snapshot existence, and continuity, not full combat legality.
