# E024 Round 1 Rush Vs Engine A

Result: P2 by confirmed lead-4 unit-count response-window win.

- Completed player turns before confirmation: 33
- Confirmation: P2 confirms a lead-4 unit-count win at start of turn-034 with 7 units to 2.
- Win type: unit-count
- Final unit counts: P1 2, P2 7
- Final center split: P1 1, P2 3, neutral 4
- Ruleset: territory-v1-cost6-damagecap-responsewin-lead4-highmove-center6
- Map: sketch-v5-recenter
- Starter board: .games/e024-highmove-center6-starter.board.json

Legality notes:

- Every timeline entry includes actions.movements, actions.recruits, actions.attacks, actions.heals, and actions.upgrades.
- Movement endpoints, one-unit-per-hex occupancy, blocked/off-map placement, attack range, damage accounting, delayed recruit attacks, damage-cap use, healing, and permanent stat changes are intended to be checked by `bun run validate-run -- --strict .games/e024r1-rush-engine-a/timeline.json`.
- Deck snapshots are intentionally minimal continuity snapshots; this run is evidence for strict board legality and broad strategy shape, not a full deterministic Dominion-style card-sequence audit.
- Druid and healer printed healing are active under the high-movement late-center rules and are logged explicitly when used. Deck-produced healing and Armory-style upgradeHealth are logged explicitly as well. P1 used a sharper tempo deck and prioritized legal attack carriers instead of uncapped burst damage.
- Late six-center dominance threats are checked only at start-of-turn after at least 18 completed player turns have already been recorded. This run records pending/cleared six-center state in each timeline entry's reasoning. In this sample, the game resolved by unit count before any six-center dominance confirmation.

Strategic observations:

- P1's rush prioritized high-movement northeast/east pressure, mobile recruits, Second Wind, and damage cards only when legal attack carriers existed.
- P2's engine/control line used high movement to reposition, with deck-produced healing, upgradeHealth, and center consolidation around the recentered south-middle lane. In this sample, that stabilization converted into the eventual unit-count lead after the rush thinned out.
- Under current strict logging, this is evidence for the E024 high-movement six-center dominance branch.
