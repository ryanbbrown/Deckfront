# E018b Center vs Flank B Notes

Independent full-game repeat using `territory-v1-cost6-damagecap-responsewin-lead4-no-printheal` and `sketch-v3-contest`.

## Strategy Assignment

- P1: center/east anchor plan with guardians, marksmen, druid/healer bodies, economy/support buys, selective upgrades, and deck healing.
- P2: flank and lower-center pressure with scouts/raiders early, then marksmen/guardians, economy pressure, trades, and flips.

## Rules Calls

- Normal income used: 2 + controlled centers. Recruitment cost remained 6 supply.
- Printed unit healing was never applied. Druid/healer bodies could move and attack only.
- Deck healing and `upgradeHealth` healing remained legal and were applied after attacks.
- Deck damage was attached to legal attacks and capped at 1 deck-produced damage per attacking unit; unused deck damage expired.
- Pending lead-4 state is logged in notes and turn reasoning because board.json has no field for it.

Turn 28 P2 start: P2 created pending lead-4 unit-count threat at 11-7.
Turn 30 P2 start: P2 confirmed pending lead-4 unit-count win at 12-7.

## Final Result

- Winner: P2.
- Completed player turns: 29.
- Win type: confirmed lead-4 unit-count response-window win.
- Unit counts: P1 7, P2 12.
- Center split: P1 2, P2 6, neutral 0.
- Saved supply: P1 3, P2 5.
- Support/healing observations: P1 used support bodies mainly as anchors/screens; no printed healing occurred. Deck Bandage/Potion/Healer and Armory healing mattered tactically but did not recreate repeatable board-healing loops.
- Evidence quality: full if validator passes; movement, range, occupancy, income, recruit cost, no-print-heal, and lead-4 response-window checks were generated with run-local legality checks.
