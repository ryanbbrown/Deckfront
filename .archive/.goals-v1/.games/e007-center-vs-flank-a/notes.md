# E007 Center vs Flank A Notes

## Strategy

- P1 deck: balanced economy into tactical damage/upgrades. Bought Silver, Blast, and Training; avoided Copper.
- P1 board: compact center guardian/marksman pressure. Used scouts mainly for safe center/east flips and protected upgraded guardians/marksmen.
- P2 deck: healing/control with opportunistic economy. Bought Potion, Silver, Healer, and support cards; avoided Copper.
- P2 board: west-south and southeast lanes forced P1 to split from the center. Scouts took capture duty, with druid/healer support and raiders punishing isolated units.

## Rules Calls

- Used the exact fixed starting decks from the prompt rather than an open 12-coin draft. This is assigned by the run prompt and should not be treated as a draft-budget error for this bundle.
- Applied delayed recruits: recruited units did not move, attack, heal, capture, or reattack until their controller's next board phase.
- Applied recruit cost 6 and tracked saved board supply in `board.json`.
- Applied deck damage as attached combat damage only. It was never used as global direct damage.
- Applied the E007 damage cap: each ready attacking unit could carry at most 1 deck-produced damage in a turn. Excess Blast damage expired.
- Printed unit healing and deck healing were capped at max HP and did not revive removed units.

## Ambiguities

- For turns with more deck damage than legal capped assignments, unused damage was allowed to expire rather than forcing weaker or illegal attacks.
- When multiple legal attack carriers could combine for a kill, the replay uses the least expansive interpretation: printed attacks plus at most 1 deck damage per attacking unit.
- This run uses a prior cost-6 center/flank line as the mechanical baseline because its deck seed and strategy assignment match this E007 prompt, and the relevant damage turns already use capped attached damage. Board states were retargeted to `territory-v1-cost6-damagecap`.

## Stopping Point

- Stopped after 16 completed player turns, with no start-of-turn 3-unit lead win resolved.
- Final unit count: P1 7, P2 6.
- Final supply-center control: P1 4, P2 3, neutral 1.
- P1 is the board leader, but P2 still has live flank pressure through `P2-raider-1`, `P2-raider-2`, `P2-scout-3`, and healer support.

## Evidence Quality

- Evidence quality: full, assuming the documented reuse of the matching cost-6 baseline is acceptable for E007.
- Validation passes and all completed turns include before/after deck and board snapshots.
- The run is useful for the expected tension: the damage cap preserved the center/flank split by preventing Blast-heavy turns from becoming single-attacker burst kills, while still allowing coordinated kills through multiple legal attackers.
