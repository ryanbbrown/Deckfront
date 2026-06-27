# E021 Round 1 Rush Vs Engine A

Result: P1 by confirmed lead-4 response-window unit-count win.

- Completed player turns before confirmation: 28
- Confirmation: P1 confirms a lead-4 unit-count win at start of turn-029 with 8 units to 3.
- Final unit counts: P1 8, P2 3
- Final center split: P1 2, P2 1, neutral 5
- Ruleset: territory-v1-cost6-damagecap-responsewin-lead4-no-printheal
- Map: sketch-v5-recenter
- Starter board: .games/e021-recenter-no-printheal-starter.board.json

Legality notes:

- Every timeline entry includes actions.movements, actions.recruits, and actions.attacks.
- Movement endpoints, one-unit-per-hex occupancy, blocked/off-map placement, attack range, damage accounting, delayed recruit attacks, and damage-cap use are intended to be checked by `bun run validate-run -- --strict .games/e021r1-rush-engine-a/timeline.json`.
- Deck snapshots are intentionally minimal continuity snapshots; this run is evidence for strict board legality and broad strategy shape, not a full deterministic Dominion-style card-sequence audit.
- Druid and healer printed healing were treated as 0. Deck-produced healing and Armory-style upgradeHealth remained legal stabilization tools. P1 used a sharper tempo deck and prioritized legal attack carriers instead of uncapped burst damage.

Strategic observations:

- P1's sharper rush prioritized northeast/east pressure, mobile recruits, Second Wind, and damage cards only when legal attack carriers existed.
- P2's engine/control line used only deck-produced healing, upgradeHealth, and center consolidation around the recentered south-middle lane. In this sample, P2's response was not enough to prevent the eventual unit-count lead.
- Under strict logging, this is evidence for the recentered no-printed-healing E021 branch rather than the legacy E013 layout.
