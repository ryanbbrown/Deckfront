# E003 Center vs Flank B Notes

## Setup

- Ruleset: `territory-v1-locked`
- Map: `sketch-v1`
- Initial board: `.games/e003-locked-starter.board.json`
- Deck seed: `3`
- Starting decks were initialized through the CLI before the first turn snapshot:
  - P1: `copper,copper,copper,copper,copper,copper,copper,silver,training,blast`
  - P2: `copper,copper,copper,copper,copper,copper,copper,village,potion,peddler`

## Strategy

- P1 followed balanced economy into tactical upgrades and damage. Buys were Training, Blast, and Silver; Copper was avoided. The board plan used the upgraded guardian plus marksmen to take center-north, center, northeast, and east.
- P2 followed healing/control and flank pressure. Buys leaned Potion/Healer with some Silver support; Copper was avoided. The board plan used scouts for west-south, center-south, southeast, and later west-south re-flips, with raiders punishing exposed center units.
- Expected tension appeared: P1's center control became strong, but the southeast/east flank forced the compact formation to spread. P2 did not overtake the center, but did keep enough unit count and southern pressure to prevent a clean start-of-turn unit-lead win by turn 16.

## Rules Calls

- Locked timing was used: supply income, movement/captures, upgrades, attacks, healing, then delayed recruitment.
- Recruits did not move, attack, heal, capture, or receive upgrades on the turn they entered.
- Deck damage was only attached to legal attacks. Several generated damage turns had no legal target or were intentionally unused.
- P1's first Training upgrade was applied to `P1-guardian-1`, permanently changing its attack from 4 to 5.
- Printed healing was used when a healer unit was in range and had not attacked. Unused deck healing stayed unused.
- The start-of-turn unit-lead win condition did not resolve. P1 ended turn 16 ahead 7 units to 6, so P1 would not win at the next start-of-turn check.

## Ambiguities

- Friendly units were allowed as pass-through hexes for movement pathing, matching the locked rule's explicit prohibition only on paths through occupied enemy hexes.
- Deck-produced healing was abundant for P2, but most board healing used printed healer support or was omitted because targets were already near max HP. This may understate the healing/control deck's ceiling.
- The deck engine left some produced counters visible on the player after cleanup snapshots; timeline `produced` follows the local replay convention used by existing bundles.

## Stopping Point

- Stopped after 16 completed player turns, with the game unresolved but informative.
- Final board: P1 leads 7 units to 6 and controls 4 centers; P2 controls 3 centers; `center-northwest` remains neutral.
- P1 is the leader, but not the winner. P2's southern flank remains plausible through `P2-raider-1`, `P2-scout-3`, `P2-raider-2`, and `P2-scout-4`.

## Evidence Quality

- Full. The replay bundle validates and the known interpretive calls are recorded here.
- Validation command: `bun run validate-run -- .games/e003-center-vs-flank-b/timeline.json`
- Validation result: `Valid replay bundle: E003 Center vs Flank B (16 entries)`
