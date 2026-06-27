# E015b Rush vs Engine B Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4-compressed`.
- Map: `sketch-v3-contest`.
- Starter board: `.games/e015-compressed-starter.board.json`.
- Deck setup used the fixed `deck.yaml` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player.
- P1 strategy: early damage/tempo with Zap, Blast, Storm, and Second Wind only when attached to concrete attacks, plus enough economy to sustain buys.
- P2 strategy: Village/Peddler/Silver/Gold engine with Bandage/Potion/Healer/Armory support as needed, preserving durable units while contesting lower/east economy.

## Lead-4 Threat Handling

- No lead-4 threat existed through turn 18.
- Turn 19 / P1 start: P1 began at 8 units to P2's 4, creating a pending P1 lead-4 threat.
- Turn 19 / P1 board phase: P1 killed P2 Scout-2 and recruited Raider-4, ending at P1 9 / P2 3.
- Turn 20 / P2 response: P2 killed P1 Raider-3 and recruited Guardian-4, but one recruit was not enough. The count changed to P1 8 / P2 4, so the lead stayed exactly four.
- Winner: P1 confirms the pending lead-4 threat at the beginning of turn 21 / round 11, before income, movement, combat, healing, or recruitment.

## Final Result

- Completed player turns: 20.
- Winner: P1 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 8, P2 4.
- Final supply centers: P1 5, P2 2, neutral 1.
- Final saved supply: P1 3, P2 3.

## Income And Pacing Takeaways

- Compressed income delayed P1's first recruit at turn 5 and removed old overflow from several five-center turns, but P1 still converted a 5-2 center split into one recruit per turn often enough to pressure the unit-count clock.
- P2's engine/healing package stabilized damage but lost comeback elasticity. The delayed healer and guardian buys meant P2 could kill and recruit once during the response window, but could not produce the second body needed to drop the lead below four.
- The decisive turn was not a burst-damage spike; it was the turn-20 response where one kill plus one recruit still left P1 at an exact four-unit lead.
- Final center split was P1 5 / P2 2 / neutral 1, which suggests compressed income reduced replacement volume without eliminating a sustained P1 rush lock when P2 loses lower/east scouts.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in `timeline.json` reasoning and this notes file.
- Deck-produced damage was recorded only when attached to concrete attacks and capped at 1 deck-produced damage per attacking unit. Excess produced damage expired.
- Compressed income used the ruleset table: 0-4 centers paid 1-5, 5-6 centers paid 6, and 7-8 centers paid 7. Recruitment still cost 6.
- Board movement and recruitment were script-checked against map coordinates, unit movement values, occupied destinations, and saved supply. Combat targeting and damage assignment remain manually audited in the turn reasoning.
- Evidence quality: full, with the caveat that tactical combat legality is manually audited rather than enforced by `validate-run`.
