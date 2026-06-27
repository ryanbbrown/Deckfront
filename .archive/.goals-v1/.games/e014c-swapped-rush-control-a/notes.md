# E014c Swapped Rush Control A Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4`.
- Map: `sketch-v4-tempo`.
- Starter board: `.games/e014-tempo-starter.board.json`.
- Deck setup used the fixed `deck.yaml` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player. Start-of-turn trashing was used mostly to remove Rest.
- P1 strategy: engine/control/healing/economy with Village/Peddler/Silver/Gold plus healing/upgrades.
- P2 strategy: early damage and tempo from the P2 seat with Zap/Blast/Storm-style pressure and enough money to keep buying attacks.

## Lead-4 Threat Handling

- No lead-4 threat existed through turn 26. P2 had early center pressure but never began its own turn with a 4-unit lead.
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

- P2 rush preserved real agency from the lower seat. P2 reached a five-center high-water mark on turn 12 and killed P1's first scout and healer before P1 stabilized.
- The southeast rollback did not fully remove the lower/east economy spike in this line. It made the flank more committed, but P2 still converted the route into temporary 5-center pressure.
- P1's control/healing plan recovered once the forward P2 scouts and raiders became exposed. Guardians, marksmen, and druids let P1 absorb nonlethal rush damage and convert the board into a unit-count lead.
- Pacing stayed long but not stalled: a legal win appears at the start of turn 29 after 28 completed player turns.

## Rules Calls And Evidence Quality

- The board schema has no pending-threat field; pending lead-4 state is recorded in `timeline.json` reasoning and this notes file.
- Deck-produced damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit. Excess damage expired.
- Evidence quality: partial. The replay bundle validates for schema/snapshot continuity and the deck phase is generated from `deck.yaml`, but tactical movement, targeting, and supply math are hand-authored because `validate-run` does not enforce board legality.
