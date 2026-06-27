# E014b Rush vs Engine A Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4`.
- Map: `sketch-v4-tempo`.
- Starter board: `.games/e014-tempo-starter.board.json`.
- Deck setup used the fixed `deck.yaml` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player.
- P1 strategy: early damage/tempo with Zap, Blast, Storm, and Second Wind only when attached to concrete attacks, plus enough economy to sustain buys.
- P2 strategy: Village/Peddler/Silver/Gold engine with Bandage/Potion/Healer/Armory support as needed, preserving durable units while contesting lower/east economy.

## Lead-4 Threat Handling

- Turn 19 / P1 start: P1 began at 9 units to P2's 5, creating a pending P1 lead-4 threat.
- Turn 19 / P1 board phase: P1 killed P2 Scout-2 and recruited Raider-4, ending at P1 10 / P2 4.
- Turn 20 / P2 response: P2 killed P1 Raider-3 and recruited Scout-4 plus Guardian-4, changing the count to P1 9 / P2 6 and clearing the threat.
- Turn 21 / P1 board phase: P1 killed P2 Guardian-2 and recruited Marksman-4, ending at P1 10 / P2 5 and creating a new pending P1 lead-4 threat.
- Turn 22 / P2 response: P2 recruited Marksman-2 but did not kill a P1 unit, ending at P1 10 / P2 6.
- Winner: P1 confirms the pending lead-4 threat at the beginning of turn 23 / round 12, before income, movement, combat, healing, or recruitment.

## Final Result

- Completed player turns: 22.
- Winner: P1 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 10, P2 6.
- Final supply centers: P1 5, P2 3, neutral 0.
- Final saved supply: P1 8, P2 0.

## Pacing And Map Takeaways

- The tempo rollback made southeast easier for P1 to fold into the early east route. P1 reached a practical five-center shape by turn 7 and converted it into a unit-count threat by turn 19.
- P2's engine and healing still mattered: it killed P1's upgraded raider on turn 12 and cleared the first pending threat on turn 20.
- The second threat stuck because P2 lost Guardian-2 on turn 21 and had too few safe attacks to both kill and recruit during the response window.
- Compared with the more contested southeast location, this line suggests the rollback revived a stronger P1 rush lock, though not an immediate or interaction-free one.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in `timeline.json` reasoning and this notes file.
- Deck-produced damage was recorded only when attached to concrete attacks and capped at 1 deck-produced damage per attacking unit. Excess produced damage expired.
- Storm targeting used the least expansive interpretation: it only mattered when an occupied enemy target cluster was present, and base attack damage applied only to the original legal target.
- Board movement and recruitment were script-checked against map coordinates, unit movement values, occupied destinations, and saved supply. Combat targeting remains manually audited in the turn reasoning.
- Evidence quality: full, with the caveat that tactical combat legality is manually audited rather than enforced by `validate-run`.
