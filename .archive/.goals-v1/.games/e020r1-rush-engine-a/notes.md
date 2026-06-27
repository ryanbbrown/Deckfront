# E020 Round 1 Rush Vs Engine A

Result: P1 by confirmed lead-4 response-window unit-count win.

- Completed player turns before confirmation: 34
- Confirmation: P1 confirms a lead-4 unit-count win at start of turn-035 with 7 units to 3.
- Final unit counts: P1 7, P2 3
- Final center split: P1 3, P2 1, neutral 4
- Ruleset: territory-v1-cost6-damagecap-responsewin-lead4
- Map: sketch-v5-recenter
- Starter board: .games/e020-recenter-starter.board.json

Legality notes:

- Every timeline entry includes actions.movements, actions.recruits, and actions.attacks.
- Movement endpoints, one-unit-per-hex occupancy, blocked/off-map placement, attack range, damage accounting, delayed recruit attacks, and damage-cap use are intended to be checked by `bun run validate-run -- --strict .games/e020r1-rush-engine-a/timeline.json`.
- Deck snapshots are intentionally minimal continuity snapshots; this run is evidence for strict board legality and broad strategy shape, not a full deterministic Dominion-style card-sequence audit.
- Deck healing and Armory-style upgradeHealth were used by P2 as stabilization tools. P1 used a sharper tempo deck and prioritized legal attack carriers instead of uncapped burst damage.

Strategic observations:

- P1's sharper rush prioritized northeast/east pressure, mobile recruits, Second Wind, and damage cards only when legal attack carriers existed.
- P2's engine/control line used healing, upgradeHealth, and center consolidation around the recentered south-middle lane. In this sample, P2's response was not enough to prevent the eventual unit-count lead.
- Under strict logging, this is evidence for the recentered E020 map rather than the legacy E013 layout.
