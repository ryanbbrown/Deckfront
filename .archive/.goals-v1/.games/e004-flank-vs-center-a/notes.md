# E004 Flank vs Center A Notes

## Strategy

- P1 used the fixed flank/control deck: `copper,copper,copper,copper,copper,copper,copper,village,potion,peddler`.
- P2 used the fixed center/upgrade-damage deck: `copper,copper,copper,copper,copper,copper,copper,silver,training,blast`.
- P1 prioritized east and southeast pressure from the top-right seat, then used scouts and raiders to force P2's center group to turn around.
- P2 prioritized a guardian/marksman center block from the bottom-left seat. The bottom-left start delayed access to the exact middle, so P2 claimed center-south before contesting center.

## Rules Calls

- Recruits were delayed: no recruited unit moved, attacked, healed, captured, or reattacked on its entry turn.
- Deck damage was attached only to legal attacks by ready units. Unused damage and upgrade counters lapsed at end of turn.
- P1 deck healing was often assigned as deck-produced healing, not printed unit healing, when support units were out of printed healing range.
- P2 used the least expansive interpretation for Blast and Training: Blast damage rode on legal attacks, and Training upgrades were applied only when `upgradeDamage` was actually produced that turn.
- The prompt-mandated fixed starting decks replace the locked ruleset's normal draft baseline. This is intentional for E004, but it should be considered when comparing against draft-start runs.

## Stopping Point

- Stopped after 16 completed player turns, with the next active player as P1 in round 9.
- No formal win condition resolved. P1 led 9 living units to 7, short of the 3-unit lead needed at the beginning of P1's next turn.
- Final supply centers: P1 controlled 5, P2 controlled 2, and center-northwest remained neutral.
- Saved board supply: P1 had 4, P2 had 5.

## Findings

- P1's seat advantage mattered. The top-right flank path let P1 claim northeast, east, and southeast quickly, then convert east pressure into center and center-north control.
- P2's center plan still produced real tactical counterplay. Blast turns killed exposed P1 scouts/raiders, and the guardian/marksman block repeatedly stabilized center-south.
- P2 struggled to turn central kills into center-count parity because the compact formation was slow to reach east/southeast recaptures.
- The run supports the expected tension: center pressure assigned to P2 remained dangerous, but P1's first-player/side access appeared to lead at the stop point.

## Evidence Quality

- Evidence quality: full for replay-bundle continuity and snapshot validation.
- The local generator additionally checked map movement, occupied hexes, recruit supply/home legality, attack range, and deck-counter spending while producing the replay.
- Remaining caveat: this is one scripted playthrough with fixed starting decks, so it should not be treated as a batch-level balance conclusion.
