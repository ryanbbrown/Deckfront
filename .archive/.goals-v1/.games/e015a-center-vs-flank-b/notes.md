# E015a Center vs Flank B Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4-compressed`.
- Map: `sketch-v3-contest`.
- Starter board: `.games/e015-compressed-starter.board.json`.
- P1 strategy: center-control economy with Peddler/Village, selective Armory/Training/Healer, guardian/marksman/healer anchors.
- P2 strategy: flank/economy pressure with scouts/raiders, ranged punish, and enough combat tricks to keep footholds.
- Deck setup used the fixed `deck.yaml` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player.
- Start-of-turn free trashing was used on Rest first, then late Copper when drawn, to keep both decks developing.

## Lead-4 Threat Handling

Turn 28 P2 start: P2 created pending lead-4 threat at 6-2.
Turn 30 P2 start: P2 confirmed pending lead-4 threat at 7-2.

## Income And Pacing Notes

- Compressed center income materially slowed replacement. The most common midgame split was P1 1 / P2 3 / neutral 4, paying P1 2 and P2 4 rather than old-rule 3 and 5.
- P2 never needed runaway center income. The flank plan stabilized on three centers, banked across turns, and converted saved supply into single recruits on turns 8, 12, 16, 20, 22, 26, and 28.
- P1 briefly contested center/east, reaching a 2/2 split by turn 11, but losing the first raider on turn 8 and scout on turn 12 left too few bodies to hold center-north/center/east/southeast simultaneously.
- The compressed table made P1's collapse slower than an old `2 + centers` economy would likely have been: P2's 3-center turns paid 4, so P2 had to save for recruits rather than replacing every turn automatically.

## Final Result
- Winner: P2.
- Completed player turns: 29.
- Unit counts: P1 2, P2 7.
- Center split: P1 1, P2 3, neutral 4.
- Saved supply: P1 5, P2 1.
- Evidence quality: full. The replay bundle validates, and tactical legality was generated with movement, range, occupancy, compressed income, and recruit-cost checks.

## Rules Calls
- Compressed income table used: 0=>1, 1=>2, 2=>3, 3=>4, 4=>5, 5=>6, 6=>6, 7=>7, 8=>7.
- Recruitment cost remained 6 supply per unit.
- Deck damage was attached to legal attacks and capped at 1 deck damage per attacking unit; unused damage expired.
- Pending lead-4 state is logged here and in timeline reasoning because board.json has no field for it.
