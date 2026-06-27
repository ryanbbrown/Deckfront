# E015b Rush vs Engine A Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4-compressed`.
- Map: `sketch-v3-contest`.
- Starter board: `.games/e015-compressed-starter.board.json`.
- Deck setup used the fixed `deck.yaml` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player.
- P1 strategy: early damage/tempo with Zap, Blast, Storm, and Second Wind only when attached to concrete attacks, plus enough economy to keep buying.
- P1 board strategy: pressure centers and P2 lanes with raiders, scouts, and marksmen; guardians only hold center space.
- P2 strategy: Village/Peddler/Silver/Gold engine with Bandage/Potion/Healer/Armory support.
- P2 board strategy: preserve units with guardian/druid/healer core, marksmen for safe damage, and scouts for flips.

## Compressed Income Notes

- Income used the E015 table: 0 centers = 1, 1 = 2, 2 = 3, 3 = 4, 4 = 5, 5 = 6, 6 = 6, 7 = 7, 8 = 7.
- Recruitment still cost 6 supply.
- Turn 5 showed the intended compression: P1 reached only 5 saved supply and could not recruit. The first P1 recruit came on turn 7 after starting from three controlled centers.
- P2 repeatedly hit the opposite side of the rule: at two to three centers, it could answer some threats with saved supply, but not recruit every response turn.

## Lead-4 Threat Handling

- Turn 13: P1 killed P2 Scout-2 and recruited Marksman-2, ending at P1 8 / P2 4 and recording a pending P1 lead-4 threat.
- Turn 14: P2 killed P1 Raider-1 and recruited Guardian-3, reducing the count to P1 7 / P2 5 and clearing the threat.
- Turn 15: P1 killed P2 Healer-1 and recruited Scout-3, ending at P1 8 / P2 4 and recording another pending threat.
- Turn 16: P2 killed P1 Raider-2 but could not recruit, reducing the count to P1 7 / P2 4 and clearing the threat by one unit.
- Turn 17: P1 killed P2 Marksman-1 and recruited Raider-4, ending at P1 8 / P2 3 and recording a third threat.
- Turn 18: P2 killed P1 Scout-3 and recruited Scout-3, reducing the count to P1 7 / P2 4 and clearing the threat.
- Turn 19: P1 killed P2 Guardian-2 and recruited Marksman-3, ending at P1 8 / P2 3 and recording the final pending threat.
- Turn 20: P2 killed P1 Scout-2 but had only 3 board supply after compressed income, so it could not recruit. The count stayed P1 7 / P2 3.
- Winner: P1 confirms the pending lead-4 threat at the beginning of turn 21 / round 11, before income, movement, combat, healing, or recruitment.

## Final Result

- Completed player turns: 20.
- Winner: P1 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 7, P2 3.
- Final supply centers: P1 5, P2 2, neutral 1.
- Final saved supply: P1 3, P2 3.

## Pacing And Tension Notes

- Compressed income slowed both players, but it hurt P2 replacement more once P1 established five centers and began chaining kills.
- P2 still had meaningful counterplay: it cleared three separate lead-4 threats by combining kills, healing, and saved-supply recruits.
- The decisive failure was not lack of healing text; it was replacement timing. On turn 20, P2 could kill one unit but could not also buy the body needed to drop P1 below a four-unit lead.
- This run suggests E015 may restore some P1 rush dominance in original seats, though the game still had multiple response windows and did not collapse immediately.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in `timeline.json` reasoning and this notes file.
- Deck-produced damage was recorded only when attached to concrete attacks and capped at 1 deck-produced damage per attacking unit. Excess produced damage expired.
- Storm targeting used the least expansive interpretation; it did not materially affect this run because clustered legal targets rarely lined up.
- Board movement and recruitment were script-checked against map coordinates, blocked hexes, unit movement values, occupied destinations, and saved supply. Combat targeting remains manually audited in the turn reasoning.
- Evidence quality: full, with the standard caveat that `validate-run` checks schema/snapshot continuity rather than proving every tactical attack assignment.
