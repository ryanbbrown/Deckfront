# E002 Swarm vs Upgrade A Notes

## Strategy Execution

- P1 followed the swarm/economy assignment: trashed Rest/Copper when it did not block payload, bought Silver, Gold, Peddler, then Storm once the front was contested.
- P1 spent board supply aggressively on scouts and raiders, usually ending below the 3-unit start-turn win threshold so P2 had a response window.
- P2 followed the quality/support assignment: bought Armory, Training, Silver, and Healer; applied upgrades to the guardian line and used heal/support recruits to preserve the smaller formation.
- P2 avoided Copper and used elite attacks to kill exposed scouts rather than trying to match P1 recruit-for-recruit immediately.

## Rules Calls

- Recruited units were placed during the board phase but did not move or attack on the same turn. The rules do not explicitly say whether same-turn movement is allowed, so this used the conservative interpretation.
- Deck damage was assigned only alongside plausible legal attacks by active-player units. It was not treated as free global spell damage.
- Storm on turn 013 used the least expansive interpretation: the damage was attached to central attacks and splashed only across connected occupied enemy hexes.
- Armory upgrades were recorded directly on the target unit's `maxHp` and current `hp`; Training upgrades were recorded directly on `attack`.
- The start-turn unit-count win condition was checked narratively before each player turn. No check reached a 3-unit lead.

## Ambiguities

- The exact timing of recruitment versus movement remains important. Allowing recruits to move immediately would materially strengthen P1's quantity plan.
- Storm's "connected occupied enemy hexes" wording needs a tighter definition for whether the original attack target counts as one of the two storm targets.
- The replay validator checks schema and snapshot continuity, not tactical legality. Movement paths and combats were checked manually during play.

## Stopping Point

- Stopped after 14 completed player turns, within the requested 12-16 turn range.
- No winner resolved. Final unit count was 8 P1 units to 8 P2 units.
- P1 led on centers, 5 to 2, with 1 neutral center. P1 also held 5 saved board supply to P2's 0.
- Board state still had useful tension, but the central dynamic was clear: P1's supply income and deck payload were ahead, while P2's upgraded guardian line prevented a clean unit-count win.

## Evidence Quality

- Evidence quality: full for replay structure and deck phases; medium-high for tactical board evidence because board legality is manual.
- `bun run validate-run -- .games/e002-swarm-vs-upgrade-a/timeline.json` passed with 14 entries.
- Additional coordinate sanity check found no duplicate occupied hexes, blocked hex occupation, or off-map units after final generation.
