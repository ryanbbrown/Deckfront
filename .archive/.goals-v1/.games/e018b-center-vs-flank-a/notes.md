# E018b Center vs Flank A Replay Notes

## Setup

- Ruleset: `territory-v1-cost6-damagecap-responsewin-lead4-no-printheal`.
- Map: `sketch-v3-contest`.
- Starter board: `.games/e018-no-printheal-starter.board.json`.
- Deck setup used the fixed `deck.yaml` starting deck: 5 Copper, Zap, Bandage, and 3 Rest per player. The board-rules prose still mentions an older 7-Copper draft baseline, so this run records the fixed deck-file setup as operative.
- P1 deck strategy: center-control economy/support, buying Silver/Peddler/Village plus selective Zap/Blast, Armory/Training, Potion/Healer deck healing.
- P1 board strategy: claim northeast, center-north, center, and east; recruit guardians, marksmen, druids, and healers as bodies without printed healing loops.
- P2 deck strategy: flank/economy pressure, buying Village/Peddler/Gold with Storm/Blast/Armory/Healer support.
- P2 board strategy: avoid a direct center grind early, flip west/south/east centers with scouts and raiders, then convert extra supply to mobile pressure and bodies.
- E018 rule: druids and healers have no printed unit healing. This replay uses deck-produced healing and upgrade-health healing only.

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
- Removing printed healing shortened the center anchor's survival once P2 reached six centers: P1's druid/healer bodies mattered for count and attacks, but they did not create a repeatable repair loop.
- This run suggests `sketch-v3-contest` still gives P2 flank/economy a strong conversion path in this matchup: P1 could win local center fights but still lost the income race.

## Support And Healing Observations

- Printed unit healing used: none.
- Deck healing used: Bandage healed P1 Guardian-2 for 1 on turn 21; other Bandage/Potion/Healer counters often expired or were tactically secondary.
- Upgrade-health healing used: Armory increased and healed P1 Guardian-1 twice and P1 Guardian-3 once, while P2 used Armory on Guardian-2.
- The no-print-heal safeguard mattered qualitatively: P1 could not stabilize the cracked center after losing Guardian-1, Druid-1, Marksman-1, Marksman-2, and Healer-1 across P2's turns 20-22.

## Rules Calls And Ambiguities

- The board schema has no pending-threat field; pending lead-4 state is recorded in `timeline.json` reasoning and this notes file.
- Deck-produced damage was attached only to legal attacks and capped at 1 deck-produced damage per attacking unit. Excess damage expired.
- Storm used the least expansive interpretation: base attack applied only to the original legal target, and extra storm damage required connected occupied enemy hexes plus available damage-cap capacity.
- Tactical movement, targeting, supply math, and the no-printed-healing constraint were hand-audited; `validate-run` verifies schema, snapshot existence, and continuity, not full combat legality or deck-hand exactness.
- Evidence quality: full for the intended board/rules question, with the standard validator caveat above.
