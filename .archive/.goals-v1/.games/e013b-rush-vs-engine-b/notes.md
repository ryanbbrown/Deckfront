# E013b Rush vs Engine B Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4`.
- Map: `sketch-v3-contest`.
- Starter board: `.games/e013-contest-starter.board.json`.
- Deck setup used the fixed `deck.yaml` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player.
- P1 strategy: early damage/tempo with Zap/Blast/Storm, enough treasure to keep buying, and aggressive raider/scout/marksman pressure.
- P2 strategy: Village/Peddler/Silver/Gold economy with Bandage/Potion/Healer/Armory support, preserving guardians and healers while contesting lower/east economy.

## Lead-4 Threat Handling

- Turn 17 / P1 start: P1 began at 9 units to P2's 5, so P1 recorded a pending lead-4 threat.
- Turn 18 / P2 response: P2 recruited Scout-3 and killed P1 Scout-1, dropping the count from 10-5 after P1's turn to 9-6. The P1 lead fell below 4, clearing the pending threat.
- Turn 30 / P2 start: P2 began at 11 units to P1's 6, so P2 recorded a pending lead-4 threat.
- Turn 31 / P1 response: P1 recruited Marksman-5 but did not kill a P2 unit, ending at P1 7 / P2 12. The P2 lead stayed at 5.
- Winner: P2 confirms the pending lead-4 threat at the beginning of turn 32 / round 16.

## Final Result

- Completed player turns: 31.
- Winner: P2 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 7, P2 12.
- Final supply centers: P1 2, P2 5, neutral 1.
- Final saved supply: P1 6, P2 5.

## Map And Strategy Takeaways

- This repeat again let P2 stabilize after P1's first serious unit-count threat. P1 held a 5-center peak briefly, but P2's early west-south and center-south control prevented a permanent lock.
- The decisive swing differed from run A: P1 pushed harder on recruits and reached a 10-5 midgame count, but P2 cleared the pending threat on turn 18 and later turned the map into a 5-2 center split.
- P2's healing and guardian density made capped deck damage less lethal once P1's fragile scouts and raiders were already damaged.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in `timeline.json` reasoning and this notes file.
- Deck-produced damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit. Excess damage expired.
- Storm targeting used the least expansive interpretation: original legal target plus adjacent occupied enemy storm targets only when the board position supported it, with base unit attack on the original target.
- Tactical movement, targeting, and supply math were hand-audited; `validate-run` verifies schema, snapshot existence, and continuity, not full combat legality.
