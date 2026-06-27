# E013c Center vs Flank A Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4`.
- Map: `sketch-v3-contest`.
- Starter board: `.games/e013-contest-starter.board.json`.
- Deck setup used the fixed `deck.yaml` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player. The board-rules prose still mentions an older 7-Copper draft baseline, so this run records the fixed deck-file setup as operative.
- P1 deck strategy: balanced economy/control, buying Silver/Peddler/Village plus Blast/Zap/Armory/Training as center attacks became available.
- P1 board strategy: claim northeast, center-north, center, and east; recruit guardians, marksmen, druids, and healers to keep a durable middle front.
- P2 deck strategy: flank/economy pressure, buying Village/Peddler/Gold with Storm/Blast/Armory/Healer support.
- P2 board strategy: avoid a direct center grind early, flip west/south/east centers with scouts and raiders, then convert extra supply to bodies.

## Lead-4 Threat Handling

- No pending lead-4 threat existed through turn 23. Several end-of-turn leads appeared, but the active start-of-turn checks did not yet find the active player leading by 4.
- Turn 24 / P2 start: P2 began at 8 units to P1's 4, so P2 recorded a pending lead-4 threat.
- Turn 25 / P1 response: P1 recruited Healer-2 and killed P2 Scout-3, but P2 still led 8 to 4.
- Winner: P2 confirms the pending lead-4 threat at the beginning of turn 26 / round 13, before income, movement, combat, healing, or recruitment.

## Final Result

- Completed player turns: 25.
- Winner: P2 by confirmed lead-4 response-window unit-count win.
- Final living units: P1 4, P2 8.
- Final supply centers: P1 2, P2 6, neutral 0.
- Final saved supply: P1 8, P2 3.

## Map And Strategy Takeaways

- P1's center-control plan worked tactically in the midgame: it killed three P2 mobile units and held northeast/center-north for most of the game.
- P2's lower and east flips were more economically important than the lost raiders. Once P2 held six centers, the recruit tempo overcame P1's durable central line.
- This run suggests `sketch-v3-contest` may over-correct toward P2 flank economy in this matchup: P1 could win local center fights but still lost the income conversion race.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in `timeline.json` reasoning and this notes file.
- Deck-produced damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit. Excess damage expired.
- Storm used the least expansive interpretation: base attack applied only to the original legal target, and extra storm damage required connected occupied enemy hexes plus available damage-cap capacity.
- Tactical movement, targeting, and supply math were hand-audited; `validate-run` verifies schema, snapshot existence, and continuity, not full combat legality.
