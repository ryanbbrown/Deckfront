# E002 Center vs Flank B

## Strategy

- P1 followed the assigned center-control plan: drafted Silver/Training/Blast, bought Training/Peddler/Blast/Silver, upgraded a guardian and lead marksman, and held the northeast/east plus central centers with a guardian/marksman line.
- P2 followed the assigned flank plan: drafted Village/Potion/Peddler, bought Healer/Village/Potion/Silver/Storm, used scouts to take west-south, center-south, and southeast, and used marksman/druid/raider pressure to punish exposed P1 units.
- The main tension did appear: P1's center economy produced more recruits, but P2's southern flank killed P1's scout, raider, and upgraded guardian before falling behind on the start-of-turn unit count.

## Rules Calls And Ambiguities

- Initial deck draft used the territory-v1 rule text: each player started with 7 Copper plus 12 coin of drafted cards. P1 drafted Silver, Training, Blast. P2 drafted Village, Potion, Peddler. No draft coin carried over.
- Deck phases were advanced through the repo CLI with scripted legal choices. The CLI snapshots are recorded for every completed player turn.
- No Copper was bought. No start-of-turn trashing was used because the generated hands did not have enough spare money to trash Copper while preserving the assigned buys.
- Deck `damage` was treated as extra damage assigned through a legal unit attack, not as free direct spell damage. Unassignable damage was left unused.
- `stormTargets` was interpreted narrowly. On turn 014 there was no second connected occupied enemy hex for the Storm rider, so only the base 2 damage was applied through the legal attack.
- Recruited units entered during recruitment and did not move or attack until that player's next board phase.
- Unit `heal` stats on druid/healer units were not used because the rules file lists the stat but does not define timing or target legality. Healing came only from deck counters.

## Stopping Point

The run stops after 16 completed player turns. The final board has P1 active for round 9 with 9 living units to P2's 6, so P1 wins at the beginning of the next turn under the 3-unit lead start-of-turn rule.

Final center control is P1 4, P2 3, unclaimed 1. P1 has no saved board supply; P2 has 4 saved supply.

## Evidence Quality

Evidence quality: full.

The replay validates with `bun run validate-run -- .games/e002-center-vs-flank-b/timeline.json`. Board movement and attack ranges were checked against the odd-column map while generating the snapshots. The main residual risk is interpretive, not structural: deck damage, Storm, and unit healing need firmer rules text for future runs.
