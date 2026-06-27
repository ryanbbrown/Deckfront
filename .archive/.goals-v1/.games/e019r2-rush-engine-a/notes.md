# E019 Round 2 Rush Vs Engine A

Result: P2 by confirmed lead-4 response-window unit-count win.

- Completed player turns before confirmation: 55
- Confirmation: P2 confirms a lead-4 unit-count win at start of turn-056 with 7 units to 3.
- Final unit counts: P1 3, P2 7
- Final center split: P1 2, P2 3, neutral 3
- Ruleset: territory-v1-cost6-damagecap-responsewin-lead4
- Map: sketch-v3-contest
- Starter board: .games/e013-contest-starter.board.json

Legality notes:

- Every timeline entry includes actions.movements, actions.recruits, and actions.attacks.
- Movement endpoints, one-unit-per-hex occupancy, blocked/off-map placement, attack range, damage accounting, delayed recruit attacks, and damage-cap use are intended to be checked by `bun run validate-run -- --strict .games/e019r2-rush-engine-a/timeline.json`.
- Deck snapshots are intentionally minimal continuity snapshots; this run is evidence for strict board legality and broad strategy shape, not a full deterministic Dominion-style card-sequence audit.
- Deck healing and Armory-style upgradeHealth were used by P2 as stabilization tools. P1 used a sharper tempo deck and prioritized legal attack carriers instead of uncapped burst damage.

Strategic observations:

- P1's sharper rush prioritized northeast/east pressure, mobile recruits, Second Wind, and damage cards only when legal attack carriers existed.
- P2's engine/control line used healing, upgradeHealth, and center consolidation to stabilize. In this sample, that stabilization converted into the eventual unit-count lead after the rush thinned out.
- Under strict logging, the game still shows the same core E013 tension: rush is real, but the evidence should now be weighed through strict validator output rather than legacy structural validation.
