# E003 Center vs Flank A Notes

## Strategy

- P1 deck: balanced economy into tactical damage/upgrades. P1 opened by thinning Copper, buying Training, then adding Blast/Silver as hands allowed while avoiding Copper buys.
- P1 board: compact center pressure with guardian/marksman support. Scouts and raider took early nearby centers, then the formation broadened only when P2's southeast flank forced an east response.
- P1 unit priorities: guardian/marksman core. Training upgrades landed on the lead guardian, original marksman, second marksman, second guardian, and final east guardian.
- P2 deck: healing/control support. P2 emphasized Potion/Healer with some Silver, and did not reach a coherent Storm buy in this draw sequence.
- P2 board: south/southeast flank. Scouts captured west-south, center-south, southeast, and later east, forcing P1 to split from the center.
- P2 unit priorities: scouts for captures, raiders for isolated-unit punishment, druid/healer support where healing targets existed.

## Rules Calls

- Used the locked start-of-turn unit lead win check. No player had a 3-unit lead at the beginning of a recorded turn.
- Used delayed recruits: recruited units did not move, attack, heal, capture, or reattack until their controller's next board phase.
- Applied supply income before movement and captures.
- Applied permanent Training upgrades after movement and before combat.
- Treated deck damage as attachable only to legal attacks by ready friendly units. P2 produced healing but no damage, so P2 attacks used printed damage only.
- Used printed and deck healing only on living friendly units, capped at max HP.

## Ambiguities

- The validator checks snapshot continuity and active player/round consistency, not full board legality. The run-local generator checks movement distance, occupied endpoints, attack range, home-base recruitment, and supply spend.
- Unused deck-produced damage/healing was allowed to expire at end of turn when no useful legal assignment existed.
- Storm targeting did not come up because P2 never bought or played Storm.

## Stopping Point

Stopped after 15 completed player turns, with `board.json` ready for P2 round 8.

- Units: P1 6, P2 5.
- Centers: P1 4, P2 3, uncontrolled 1.
- Saved supply: P1 17, P2 10.
- Winner: none. P1 is the leader, but the locked start-of-turn win condition has not resolved.

## Evidence Quality

Evidence quality: full.

The replay bundle validates with `bun run validate-run -- .games/e003-center-vs-flank-a/timeline.json`, includes before/after deck and board snapshots for every completed turn, and records final `board.json` and `deck.json`. The main residual risk is that board legality is enforced by the run-local generator rather than the official validator.
